mod database;

use chrono::{Local, NaiveDate, Utc};
use database::Store;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use trajectory_core::aggregation::AggregationState;
use trajectory_core::capture::{CaptureSource, EventNormalizer};
use trajectory_core::export::{build_csv_bundle, build_json_export, demo_snapshot};
use trajectory_core::models::{
    AppSettings, CaptureState, CaptureStatus, ExportBundle, Heatmap, RangePreset, RawInputEvent,
    TimeRange,
};
use trajectory_core::stats::range_for_preset;
use trajectory_platform::secure_input::is_secure_input_enabled;
use trajectory_platform::{
    PlatformCapture, main_display_size, permission_granted, request_permission,
};
use zip::write::SimpleFileOptions;

const SETTLE_INTERVAL: Duration = Duration::from_secs(5);
const BATTERY_INTERVAL: Duration = Duration::from_secs(15);
const DEMO_HEATMAP_SCALE: u64 = 3;
struct RuntimeState {
    app: AppHandle,
    store: Mutex<Store>,
    capture: Mutex<CaptureRuntime>,
    settings: Mutex<AppSettings>,
    paused: AtomicBool,
    demo_mode: AtomicBool,
    status: Mutex<CaptureState>,
}

struct CaptureRuntime {
    source: PlatformCapture,
    normalizer: EventNormalizer,
    aggregation: AggregationState,
    retry_buckets: Vec<trajectory_core::models::AggregatedBucket>,
    last_flush: Instant,
    last_screen_poll: Instant,
    last_battery_poll: Instant,
    last_retry_attempt: Instant,
    on_battery: bool,
    consecutive_failures: u32,
}

impl RuntimeState {
    fn new(app: AppHandle, store: Store) -> Self {
        let settings = store.settings().unwrap_or_default();
        let size = main_display_size();
        let normalizer = EventNormalizer::new();
        let status = CaptureState {
            status: if permission_granted() {
                CaptureStatus::Active
            } else {
                CaptureStatus::PermissionRequired
            },
            message: None,
            secure_input: false,
            demo_mode: false,
        };
        Self {
            app,
            store: Mutex::new(store),
            capture: Mutex::new(CaptureRuntime {
                source: PlatformCapture::new(),
                normalizer,
                aggregation: AggregationState::new(size.0, size.1, wheel_unit()),
                retry_buckets: Vec::new(),
                last_flush: Instant::now(),
                last_screen_poll: Instant::now(),
                last_battery_poll: Instant::now() - Duration::from_secs(60),
                last_retry_attempt: Instant::now() - Duration::from_secs(60),
                on_battery: false,
                consecutive_failures: 0,
            }),
            settings: Mutex::new(settings),
            paused: AtomicBool::new(false),
            demo_mode: AtomicBool::new(false),
            status: Mutex::new(status),
        }
    }

    fn current_status(&self) -> CaptureState {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or(CaptureState {
                status: CaptureStatus::HookError,
                message: Some("capture state lock poisoned".into()),
                secure_input: false,
                demo_mode: false,
            })
    }

    fn set_status(&self, status: CaptureStatus, message: Option<String>) {
        if let Ok(mut current) = self.status.lock() {
            let secure_input = is_secure_input_enabled();
            let demo_mode = self.demo_mode.load(Ordering::Relaxed);
            if current.status == status
                && current.message == message
                && current.secure_input == secure_input
                && current.demo_mode == demo_mode
            {
                return;
            }
            current.status = status;
            current.message = message;
            current.secure_input = secure_input;
            current.demo_mode = demo_mode;
            let _ = self.app.emit("capture-status-changed", current.clone());
        }
    }

    fn toggle_pause(&self) -> CaptureState {
        let next = !self.paused.load(Ordering::Relaxed);
        self.paused.store(next, Ordering::Relaxed);
        self.set_status(
            if next {
                CaptureStatus::Paused
            } else if permission_granted() {
                CaptureStatus::Active
            } else {
                CaptureStatus::PermissionRequired
            },
            None,
        );
        self.current_status()
    }

    fn effective_range(&self, request: StatsRequest) -> TimeRange {
        if let (Some(start), Some(end)) = (request.start, request.end) {
            return TimeRange {
                start_local_day: start,
                end_local_day: end,
            };
        }
        range_for_preset(
            request.preset.unwrap_or(RangePreset::Week),
            Local::now().date_naive(),
        )
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatsRequest {
    preset: Option<RangePreset>,
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionState {
    granted: bool,
    platform: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    path: String,
    format: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    preset: Option<RangePreset>,
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
    format: String,
    output_path: String,
}

#[tauri::command]
fn get_capture_status(state: State<RuntimeState>) -> CaptureState {
    state.current_status()
}

#[tauri::command]
fn request_input_permission(state: State<RuntimeState>) -> PermissionState {
    let granted = request_permission();
    state.set_status(
        if granted {
            CaptureStatus::Active
        } else {
            CaptureStatus::PermissionRequired
        },
        None,
    );
    PermissionState {
        granted,
        platform: std::env::consts::OS,
    }
}

#[tauri::command]
fn pause_capture(state: State<RuntimeState>, paused: bool) -> CaptureState {
    state.paused.store(paused, Ordering::Relaxed);
    state.set_status(
        if paused {
            CaptureStatus::Paused
        } else if permission_granted() {
            CaptureStatus::Active
        } else {
            CaptureStatus::PermissionRequired
        },
        None,
    );
    state.current_status()
}

#[tauri::command]
fn get_stats(
    state: State<RuntimeState>,
    request: StatsRequest,
) -> Result<serde_json::Value, String> {
    if state.demo_mode.load(Ordering::Relaxed) {
        return serde_json::to_value(demo_snapshot()).map_err(|error| error.to_string());
    }
    let range = state.effective_range(request);
    let snapshot = {
        let store = state.store.lock().map_err(|_| "database lock poisoned")?;
        store.stats(&range).map_err(|error| error.to_string())?
    };
    serde_json::to_value(snapshot).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_click_heatmap(state: State<RuntimeState>, request: StatsRequest) -> Result<Heatmap, String> {
    if state.demo_mode.load(Ordering::Relaxed) {
        return Ok(demo_heatmap());
    }
    let range = state.effective_range(request);
    let store = state.store.lock().map_err(|_| "database lock poisoned")?;
    store
        .click_heatmap(&range)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_settings(state: State<RuntimeState>) -> AppSettings {
    state
        .settings
        .lock()
        .map(|settings| settings.clone())
        .unwrap_or_default()
}

#[tauri::command]
fn update_settings(
    app: AppHandle,
    state: State<RuntimeState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let store = state.store.lock().map_err(|_| "database lock poisoned")?;
    store
        .save_settings(&settings)
        .map_err(|error| error.to_string())?;
    drop(store);
    if let Ok(mut current) = state.settings.lock() {
        *current = settings.clone();
    }
    let autostart = app.autolaunch();
    let _ = if settings.launch_at_login {
        autostart.enable()
    } else {
        autostart.disable()
    };
    if settings.shortcuts_enabled {
        if let Err(error) = register_shortcuts(&app) {
            state.set_status(CaptureStatus::HookError, Some(error));
        }
    } else {
        let _ = app.global_shortcut().unregister_all();
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("settings-changed", &settings);
    }
    Ok(settings)
}

#[tauri::command]
fn set_demo_mode(app: AppHandle, state: State<RuntimeState>, enabled: bool) -> CaptureState {
    state.demo_mode.store(enabled, Ordering::Relaxed);
    if enabled {
        state.set_status(CaptureStatus::Paused, Some("demo".into()));
    } else {
        state.set_status(
            if state.paused.load(Ordering::Relaxed) {
                CaptureStatus::Paused
            } else {
                CaptureStatus::Active
            },
            None,
        );
    }
    let _ = app.emit("demo-mode-changed", enabled);
    state.current_status()
}

#[tauri::command]
fn clear_data(
    state: State<RuntimeState>,
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
) -> Result<(), String> {
    if state.demo_mode.load(Ordering::Relaxed) {
        return Ok(());
    }
    let range = match (start, end) {
        (Some(start), Some(end)) => Some(TimeRange {
            start_local_day: start,
            end_local_day: end,
        }),
        _ => None,
    };
    let mut store = state.store.lock().map_err(|_| "database lock poisoned")?;
    store
        .clear_range(range.as_ref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn export_data(state: State<RuntimeState>, request: ExportRequest) -> Result<ExportResult, String> {
    let range = state.effective_range(StatsRequest {
        preset: request.preset,
        start: request.start,
        end: request.end,
    });
    let output_path = PathBuf::from(request.output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let demo = state.demo_mode.load(Ordering::Relaxed);
    let stats = if demo {
        demo_snapshot()
    } else {
        let store = state.store.lock().map_err(|_| "database lock poisoned")?;
        store.stats(&range).map_err(|error| error.to_string())?
    };
    let bundle = ExportBundle {
        schema_version: 1,
        exported_at: Utc::now(),
        app_version: if demo {
            format!("{}-DEMO", env!("CARGO_PKG_VERSION"))
        } else {
            env!("CARGO_PKG_VERSION").into()
        },
        range: range.clone(),
        timezone: Local::now().offset().to_string(),
        totals: stats.totals,
        daily: stats.series,
        keys: stats.keys,
        buttons: stats.buttons,
        click_grid: if demo {
            demo_heatmap()
        } else {
            let store = state.store.lock().map_err(|_| "database lock poisoned")?;
            store
                .click_heatmap(&range)
                .map_err(|error| error.to_string())?
        },
    };
    match request.format.as_str() {
        "json" => {
            let json = build_json_export(&bundle).map_err(|error| error.to_string())?;
            fs::write(&output_path, json).map_err(|error| error.to_string())?;
        }
        "zip" => {
            let files = build_csv_bundle(&bundle, &bundle.click_grid);
            let file = fs::File::create(&output_path).map_err(|error| error.to_string())?;
            let mut zip = zip::ZipWriter::new(file);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            for (name, body) in files {
                zip.start_file(name, options)
                    .map_err(|error| error.to_string())?;
                zip.write_all(body.as_bytes())
                    .map_err(|error| error.to_string())?;
            }
            zip.finish().map_err(|error| error.to_string())?;
        }
        _ => return Err("unsupported export format".into()),
    }
    Ok(ExportResult {
        path: output_path.display().to_string(),
        format: request.format,
    })
}

fn demo_heatmap() -> Heatmap {
    let mut cells = vec![0u64; 24 * 16];
    for (index, cell) in cells.iter_mut().enumerate() {
        let column = (index % 24) as i64;
        let row = (index / 24) as i64;
        let distance = (((column - 9).pow(2) + (row - 7).pow(2)) as f64).sqrt();
        *cell = (180.0 - distance * 19.0).max(0.0).round() as u64 * DEMO_HEATMAP_SCALE;
    }
    let filtered_total = cells.iter().sum();
    let max_value = cells.iter().copied().max().unwrap_or(0);
    Heatmap {
        columns: 24,
        rows: 16,
        cells,
        max_value,
        filtered_total,
    }
}

#[tauri::command]
fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<ExportResult, String> {
    let output_path = PathBuf::from(path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&output_path, bytes).map_err(|error| error.to_string())?;
    Ok(ExportResult {
        path: output_path.display().to_string(),
        format: "binary".into(),
    })
}

#[tauri::command]
fn create_diagnostics(
    state: State<RuntimeState>,
    output_path: String,
) -> Result<ExportResult, String> {
    let path = PathBuf::from(&output_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let status = state.current_status();
    let database_bytes = state
        .store
        .lock()
        .map(|store| store.database_size())
        .unwrap_or(0);
    let report = serde_json::json!({
        "generatedAt": Utc::now(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "status": status,
        "databaseBytes": database_bytes,
        "permission": permission_granted(),
        "secureInput": is_secure_input_enabled(),
        "deviceId": "redacted",
    });
    fs::write(
        &path,
        serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(ExportResult {
        path: path.display().to_string(),
        format: "json".into(),
    })
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window unavailable".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn open_system_settings(app: AppHandle, section: String) -> Result<(), String> {
    let url = match section.as_str() {
        "privacy" => "x-apple.systempreferences:com.apple.preference.security?Privacy",
        "input_monitoring" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
        }
        _ => "x-apple.systempreferences:com.apple.preference.security",
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

fn wheel_unit() -> f64 {
    if cfg!(target_os = "macos") {
        1.0
    } else {
        120.0
    }
}

fn data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn spawn_capture_worker(app: AppHandle) {
    let retention_state = app.state::<RuntimeState>();
    {
        let mut store = match retention_state.store.lock() {
            Ok(store) => store,
            Err(_) => return,
        };
        let now = Utc::now();
        let _ = store.purge_minute_buckets(now - chrono::Duration::hours(48));
        let _ = store.purge_hour_buckets(now - chrono::Duration::days(90));
    }
    thread::Builder::new()
        .name("trajectory-worker".into())
        .spawn(move || {
            let state = app.state::<RuntimeState>();
            {
                let mut capture = match state.capture.lock() {
                    Ok(capture) => capture,
                    Err(_) => return,
                };
                if permission_granted() {
                    if let Err(error) = capture.source.start() {
                        state.set_status(CaptureStatus::HookError, Some(error.to_string()));
                    }
                } else {
                    state.set_status(CaptureStatus::PermissionRequired, None);
                }
            }
            loop {
                thread::sleep(Duration::from_millis(250));
                let paused = state.paused.load(Ordering::Relaxed);
                let demo = state.demo_mode.load(Ordering::Relaxed);
                let secure = is_secure_input_enabled();
                let mut capture = match state.capture.lock() {
                    Ok(capture) => capture,
                    Err(_) => break,
                };
                if capture.normalizer.is_secure_input() != secure {
                    capture.normalizer.set_secure_input(secure);
                    let _ = capture
                        .normalizer
                        .normalize(RawInputEvent::SecureInputChanged { active: secure });
                }
                if !paused && !demo && !capture.source.is_running() {
                    if permission_granted() {
                        if let Err(error) = capture.source.start() {
                            state.set_status(CaptureStatus::HookError, Some(error.to_string()));
                        }
                    } else if state.current_status().status != CaptureStatus::PermissionRequired {
                        state.set_status(CaptureStatus::PermissionRequired, None);
                    }
                }
                if (paused || demo) && capture.source.is_running() {
                    // Keep draining while paused so private input cannot wait in the
                    // channel and be replayed when capture resumes.
                    let _ = capture.source.poll(Duration::ZERO);
                    capture.aggregation.reset_position();
                }
                if !paused && !demo && capture.source.is_running() {
                    match capture.source.poll(Duration::from_millis(25)) {
                        Ok(events) => {
                            let now = Utc::now();
                            for raw in events {
                                match raw {
                                    RawInputEvent::HookError { message } => {
                                        state.set_status(CaptureStatus::HookError, Some(message));
                                    }
                                    event => {
                                        if let Some(normalized) =
                                            capture.normalizer.normalize(event)
                                        {
                                            capture.aggregation.ingest(normalized, now);
                                        }
                                    }
                                }
                            }
                        }
                        Err(error) => {
                            let _ = capture.source.stop();
                            state.set_status(CaptureStatus::HookError, Some(error.to_string()));
                        }
                    }
                    if capture.last_screen_poll.elapsed() > Duration::from_secs(10) {
                        let size = main_display_size();
                        capture.aggregation.set_screen_size(size.0, size.1);
                        capture.last_screen_poll = Instant::now();
                    }
                }
                #[cfg(target_os = "macos")]
                if capture.last_battery_poll.elapsed() >= Duration::from_secs(60) {
                    capture.on_battery = on_battery();
                    capture.last_battery_poll = Instant::now();
                }
                let interval = if capture.on_battery {
                    BATTERY_INTERVAL
                } else {
                    SETTLE_INTERVAL
                };
                let retry_delay = Duration::from_secs(
                    interval
                        .as_secs()
                        .saturating_mul(1_u64 << capture.consecutive_failures.min(4)),
                )
                .min(Duration::from_secs(60));
                let should_flush = capture.last_flush.elapsed() >= interval;
                let should_retry = !capture.retry_buckets.is_empty()
                    && capture.last_retry_attempt.elapsed() >= retry_delay;
                if should_flush || should_retry {
                    capture.aggregation.flush_current();
                    let mut buckets = std::mem::take(&mut capture.retry_buckets);
                    buckets.extend(capture.aggregation.drain());
                    drop(capture);
                    if !buckets.is_empty() {
                        let write_result = state
                            .store
                            .lock()
                            .map_err(|_| "database lock poisoned".to_string())
                            .and_then(|mut store| {
                                store
                                    .write_buckets(&buckets)
                                    .map_err(|error| error.to_string())
                            });
                        if let Ok(mut capture) = state.capture.lock() {
                            match write_result {
                                Ok(()) => {
                                    capture.consecutive_failures = 0;
                                    capture.retry_buckets.clear();
                                    capture.last_retry_attempt = Instant::now();
                                    capture.last_flush = Instant::now();
                                    state.set_status(
                                        if state.paused.load(Ordering::Relaxed) {
                                            CaptureStatus::Paused
                                        } else {
                                            CaptureStatus::Active
                                        },
                                        None,
                                    );
                                }
                                Err(error) => {
                                    capture.retry_buckets = buckets;
                                    capture.consecutive_failures += 1;
                                    capture.last_retry_attempt = Instant::now();
                                    state.set_status(CaptureStatus::StorageError, Some(error));
                                }
                            }
                        }
                    } else if let Ok(mut capture) = state.capture.lock() {
                        capture.last_flush = Instant::now();
                        capture.last_retry_attempt = Instant::now();
                    }
                } else {
                    drop(capture);
                }
            }
        })
        .ok();
}

fn on_battery() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("pmset")
            .args(["-g", "ps"])
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|value| value.contains("Battery Power"))
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Trajectory", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause capture", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &pause,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    TrayIconBuilder::with_id("trajectory-tray")
        .tooltip("Trajectory / 轨迹")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                let _ = show_main_window(app.clone());
            }
            "pause" => {
                let state = app.state::<RuntimeState>();
                state.toggle_pause();
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn register_shortcuts(app: &AppHandle) -> Result<(), String> {
    let modifier = if cfg!(target_os = "macos") {
        Modifiers::SUPER
    } else {
        Modifiers::CONTROL
    };
    let toggle = Shortcut::new(Some(modifier | Modifiers::SHIFT), Code::KeyP);
    let open = Shortcut::new(Some(modifier | Modifiers::SHIFT), Code::KeyT);
    if app.global_shortcut().is_registered(toggle) || app.global_shortcut().is_registered(open) {
        app.global_shortcut()
            .unregister_all()
            .map_err(|error| error.to_string())?;
    }
    let app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(toggle, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                app_handle.state::<RuntimeState>().toggle_pause();
            }
        })
        .map_err(|error| error.to_string())?;
    let app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(open, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = show_main_window(app_handle.clone());
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn initial_store(app: &AppHandle) -> Result<Store, String> {
    let path = data_directory(app)?.join("trajectory.db");
    Store::open(path).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = show_main_window(app.clone());
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let store = initial_store(&handle).map_err(|error| {
                tauri::Error::Setup(
                    Box::<dyn std::error::Error>::from(std::io::Error::other(error)).into(),
                )
            })?;
            let state = RuntimeState::new(handle.clone(), store);
            app.manage(state);
            create_tray(&handle)?;
            let settings = handle
                .state::<RuntimeState>()
                .settings
                .lock()
                .map_err(|_| std::io::Error::other("settings lock poisoned"))?
                .clone();
            if settings.shortcuts_enabled
                && let Err(error) = register_shortcuts(&handle)
            {
                handle
                    .state::<RuntimeState>()
                    .set_status(CaptureStatus::HookError, Some(error));
            }
            spawn_capture_worker(handle.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_capture_status,
            request_input_permission,
            pause_capture,
            get_stats,
            get_click_heatmap,
            get_settings,
            update_settings,
            set_demo_mode,
            clear_data,
            export_data,
            write_binary_file,
            create_diagnostics,
            show_main_window,
            open_system_settings,
        ]);
    builder
        .run(tauri::generate_context!())
        .expect("error while running Trajectory");
}
