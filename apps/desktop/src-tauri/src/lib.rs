mod commands;
mod database;
mod export;
mod flush;
mod runtime;
mod shortcuts;
mod worker;

use database::Store;
use runtime::{RuntimeState, lock};
use std::panic::{AssertUnwindSafe, catch_unwind};
use tactile_platform::main_display_size;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

/// The Windows updater calls `cleanup_before_exit` directly before exiting,
/// so dropping this app resource provides the final flush on that path.
struct FinalizeOnCleanup(AppHandle);

impl tauri::Resource for FinalizeOnCleanup {}

impl Drop for FinalizeOnCleanup {
    fn drop(&mut self) {
        on_exit(&self.0);
    }
}

/// Opens the database, falling back to an in-memory store so a broken or
/// locked file degrades to "not saved" instead of a crash on launch.
fn open_store(app: &AppHandle) -> (Store, Option<String>) {
    let opened = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .and_then(|dir| Store::open(dir.join("tactile.db")).map_err(|error| error.to_string()));
    match opened {
        Ok(store) => (store, None),
        Err(error) => match Store::open_in_memory() {
            Ok(store) => (store, Some(format!("data is not being saved: {error}"))),
            // SQLite in-memory databases only fail if the process is out of memory.
            Err(memory_error) => panic!("no usable database: {error}; {memory_error}"),
        },
    }
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let (store, volatile) = open_store(&handle);
    app.manage(RuntimeState::new(
        handle.clone(),
        store,
        volatile,
        main_display_size(),
    ));
    let _ = handle
        .resources_table()
        .add(FinalizeOnCleanup(handle.clone()));
    let state = handle.state::<RuntimeState>();
    // The tray is a convenience; the app still works if it cannot be created.
    if let Err(error) = shortcuts::create_tray(&handle) {
        eprintln!("tactile: tray unavailable: {error}");
    }
    let settings = lock(&state.settings).clone();
    if let Err(error) = commands::set_autostart(&handle, settings.launch_at_login) {
        eprintln!("tactile: autostart: {error}");
    }
    if let Err(error) = shortcuts::apply_shortcuts(&handle, settings.shortcuts_enabled) {
        state.set_shortcut_error(Some(error));
    }
    state.publish_status();
    worker::spawn(handle);
    Ok(())
}

fn on_exit(app: &AppHandle) {
    let result = catch_unwind(AssertUnwindSafe(|| {
        if let Some(state) = app.try_state::<RuntimeState>() {
            state.finalize();
        }
    }));
    if result.is_err() {
        use std::io::Write;
        let _ = writeln!(std::io::stderr(), "tactile: finalization panicked");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = commands::show_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(setup)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_capture_status,
            commands::request_input_permission,
            commands::pause_capture,
            commands::set_live_enabled,
            commands::get_dashboard,
            commands::get_click_heatmap,
            commands::get_settings,
            commands::update_settings,
            commands::set_demo_mode,
            commands::clear_data,
            commands::export_data,
            commands::save_share_card,
            commands::create_diagnostics,
            commands::show_main_window,
            commands::open_system_settings,
        ])
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(error) => {
            eprintln!("tactile: failed to start: {error}");
            std::process::exit(1);
        }
    };
    app.run(|app, event| match event {
        // Closing the last window keeps the tray app alive; explicit exits
        // (tray Quit, `app.exit`) carry a code and are honored.
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            let _ = commands::show_window(app);
        }
        RunEvent::Exit => on_exit(app),
        _ => {}
    });
}
