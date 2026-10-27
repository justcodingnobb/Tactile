//! Tauri commands. Anything that touches the database, the filesystem or a
//! dialog runs on the async pool (`async` attribute) so the main thread, which
//! drives the UI and the event loop, never blocks on it.

use crate::export::{self, SaveTarget};
use crate::flush::clear_all;
use crate::runtime::{EVENT_SETTINGS, FaultSource, RuntimeState, StatsRequest, lock};
use crate::shortcuts::apply_shortcuts;
use serde::Serialize;
use std::sync::atomic::Ordering;
use tactile_core::export::demo_snapshot;
use tactile_core::models::{AppSettings, CaptureState, CaptureStatus, Dashboard, Heatmap};
use tactile_platform::{permission_granted, request_permission};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionState {
    granted: bool,
    platform: &'static str,
}

#[tauri::command]
pub fn get_capture_status(state: State<RuntimeState>) -> CaptureState {
    state.current_status()
}

#[tauri::command(async)]
pub fn request_input_permission(state: State<RuntimeState>) -> PermissionState {
    let granted = request_permission() || permission_granted();
    if granted {
        state.clear_fault(FaultSource::Permission);
    } else {
        state.set_fault(
            FaultSource::Permission,
            CaptureStatus::PermissionRequired,
            None,
        );
    }
    PermissionState {
        granted,
        platform: std::env::consts::OS,
    }
}

#[tauri::command]
pub fn pause_capture(state: State<RuntimeState>, paused: bool) -> CaptureState {
    state.set_paused(paused);
    state.current_status()
}

#[tauri::command]
pub fn set_live_enabled(state: State<RuntimeState>, enabled: bool) {
    state.live_enabled.store(enabled, Ordering::SeqCst);
}

/// Statistics and click heatmap for one range, plus the live sequence they
/// already include. Read under the flush lock so the sequence and the stored
/// data describe the same moment.
#[tauri::command(async)]
pub fn get_dashboard(
    state: State<RuntimeState>,
    request: StatsRequest,
) -> Result<Dashboard, String> {
    if state.is_demo() {
        return Ok(Dashboard {
            stats: demo_snapshot(),
            heatmap: export::demo_heatmap(),
            live_seq: 0,
        });
    }
    let range = state.effective_range(&request);
    let _flush = lock(&state.flush_lock);
    let live_seq = lock(&state.capture).live.flushed_seq();
    let store = lock(&state.store);
    let stats = store.stats(&range).map_err(|error| error.to_string())?;
    let heatmap = store
        .click_heatmap(&range)
        .map_err(|error| error.to_string())?;
    Ok(Dashboard {
        stats,
        heatmap,
        live_seq,
    })
}

#[tauri::command(async)]
pub fn get_click_heatmap(
    state: State<RuntimeState>,
    request: StatsRequest,
) -> Result<Heatmap, String> {
    if state.is_demo() {
        return Ok(export::demo_heatmap());
    }
    let range = state.effective_range(&request);
    lock(&state.store)
        .click_heatmap(&range)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<RuntimeState>) -> AppSettings {
    lock(&state.settings).clone()
}

#[tauri::command(async)]
pub fn update_settings(
    app: AppHandle,
    state: State<RuntimeState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let previous = lock(&state.settings).clone();
    if settings.launch_at_login != previous.launch_at_login {
        set_autostart(&app, settings.launch_at_login)?;
    }
    if settings.shortcuts_enabled != previous.shortcuts_enabled {
        // Shortcut conflicts are reported, not fatal: the setting is still saved.
        let error = apply_shortcuts(&app, settings.shortcuts_enabled).err();
        state.set_shortcut_error(error);
    }
    if let Err(error) = lock(&state.store).save_settings(&settings) {
        if settings.launch_at_login != previous.launch_at_login {
            let _ = set_autostart(&app, previous.launch_at_login);
        }
        if settings.shortcuts_enabled != previous.shortcuts_enabled {
            let error = apply_shortcuts(&app, previous.shortcuts_enabled).err();
            state.set_shortcut_error(error);
        }
        return Err(error.to_string());
    }
    *lock(&state.settings) = settings.clone();
    let _ = app.emit(EVENT_SETTINGS, &settings);
    Ok(settings)
}

pub fn set_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let autostart = app.autolaunch();
    let result = if enabled {
        autostart.enable()
    } else if autostart.is_enabled().unwrap_or(false) {
        autostart.disable()
    } else {
        Ok(())
    };
    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_demo_mode(state: State<RuntimeState>, enabled: bool) -> CaptureState {
    state.set_demo(enabled);
    state.current_status()
}

#[tauri::command(async)]
pub fn clear_data(state: State<RuntimeState>) -> Result<(), String> {
    if state.is_demo() {
        return Err("demo mode does not modify real data".into());
    }
    clear_all(&state)
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_window(&app)
}

pub fn show_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window unavailable".to_string())?;
    let _ = window.unminimize();
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_system_settings(app: AppHandle, section: String) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    let url = match section.as_str() {
        "input_monitoring" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
        }
        _ => "x-apple.systempreferences:com.apple.preference.security?Privacy",
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn export_data(
    app: AppHandle,
    state: State<RuntimeState>,
    request: StatsRequest,
    format: String,
) -> Result<Option<String>, String> {
    let format = export::DataFormat::parse(&format)?;
    let Some(path) = export::choose_path(&app, SaveTarget::Data(format))? else {
        return Ok(None);
    };
    export::write_data(&state, &request, format, &path)?;
    Ok(Some(path.display().to_string()))
}

/// Receives PNG bytes as a raw IPC body (no JSON number array) and saves them.
#[tauri::command(async)]
pub fn save_share_card(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected PNG bytes".into());
    };
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("share card is not a PNG image".into());
    }
    let Some(path) = export::choose_path(&app, SaveTarget::ShareCard)? else {
        return Ok(None);
    };
    export::write_atomic(&path, bytes)?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command(async)]
pub fn create_diagnostics(
    app: AppHandle,
    state: State<RuntimeState>,
) -> Result<Option<String>, String> {
    let Some(path) = export::choose_path(&app, SaveTarget::Diagnostics)? else {
        return Ok(None);
    };
    export::write_diagnostics(&state, &path)?;
    Ok(Some(path.display().to_string()))
}
