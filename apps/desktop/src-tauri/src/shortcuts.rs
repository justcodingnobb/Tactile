//! Tray menu and global shortcuts.

use crate::commands::show_window;
use crate::runtime::RuntimeState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Tactile", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause capture", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Tactile", true, None::<&str>)?;
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
    app.state::<RuntimeState>().attach_tray_pause(pause);
    let mut builder = TrayIconBuilder::with_id("trajectory-tray")
        .tooltip("指痕 Tactile")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                let _ = show_window(app);
            }
            "pause" => app.state::<RuntimeState>().toggle_pause(),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn shortcut_pair() -> (Shortcut, Shortcut) {
    let modifier = if cfg!(target_os = "macos") {
        Modifiers::SUPER
    } else {
        Modifiers::CONTROL
    };
    (
        Shortcut::new(Some(modifier | Modifiers::SHIFT), Code::KeyP),
        Shortcut::new(Some(modifier | Modifiers::SHIFT), Code::KeyT),
    )
}

/// Registers or removes both shortcuts. Registration of one shortcut failing
/// (another app owns it) does not prevent the other from working.
pub fn apply_shortcuts(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.global_shortcut();
    let (toggle, open) = shortcut_pair();
    let _ = manager.unregister_all();
    if !enabled {
        return Ok(());
    }
    let mut errors = Vec::new();
    if let Err(error) = manager.on_shortcut(toggle, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            app.state::<RuntimeState>().toggle_pause();
        }
    }) {
        errors.push(format!("pause shortcut: {error}"));
    }
    if let Err(error) = manager.on_shortcut(open, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            let _ = show_window(app);
        }
    }) {
        errors.push(format!("show shortcut: {error}"));
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}
