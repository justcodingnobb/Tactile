//! rdev-based capture for Windows and Linux.
//!
//! `rdev::listen` installs a process-wide hook and never returns, so it can
//! only be started once. A single listener thread forwards events to whichever
//! capture session is currently attached; detaching just stops forwarding.

use crate::Shared;
use crate::keymap::{is_windows_right_meta, rdev_key_character, rdev_key_code};
use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use trajectory_core::capture::CaptureError;
use trajectory_core::models::{ModifierSet, Point, RawInputEvent};

static SESSION: Mutex<Option<Shared>> = Mutex::new(None);
static STARTED: AtomicBool = AtomicBool::new(false);
static FAILED: AtomicBool = AtomicBool::new(false);

/// False once the global hook has failed; a failed hook is not retried in-process.
pub(crate) fn is_alive() -> bool {
    !FAILED.load(Ordering::SeqCst)
}

pub(crate) fn detach() {
    if let Ok(mut session) = SESSION.lock() {
        session.take();
    }
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) fn attach(shared: Shared) -> Result<(), CaptureError> {
    if FAILED.load(Ordering::SeqCst) {
        return Err(CaptureError::HookUnavailable(
            "input hook failed earlier; restart Tactile".into(),
        ));
    }
    *SESSION
        .lock()
        .map_err(|_| CaptureError::HookUnavailable("capture session poisoned".into()))? =
        Some(shared);
    if STARTED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    std::thread::Builder::new()
        .name("trajectory-input".into())
        .spawn(listen_forever)
        .map(|_| ())
        .map_err(|error| {
            STARTED.store(false, Ordering::SeqCst);
            CaptureError::HookUnavailable(error.to_string())
        })
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn listen_forever() {
    let mut held_modifiers = ModifierSet::default();
    let mut pressed_keys = HashSet::new();
    let mut last_position: Option<Point> = None;
    let result = rdev::listen(move |event| {
        // Always track state so modifiers and position stay correct across pauses.
        let raw = map_rdev_event(
            event,
            &mut held_modifiers,
            &mut pressed_keys,
            &mut last_position,
        );
        let Some(raw) = raw else { return };
        if let Ok(session) = SESSION.lock()
            && let Some(shared) = session.as_ref()
            && shared.control.accepts_events()
        {
            let _ = shared.sender.send(raw);
        }
    });
    FAILED.store(true, Ordering::SeqCst);
    if let Err(error) = result
        && let Ok(session) = SESSION.lock()
        && let Some(shared) = session.as_ref()
    {
        let _ = shared.sender.send(RawInputEvent::HookError {
            message: format!("{error:?}"),
        });
    }
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) fn map_rdev_event(
    event: rdev::Event,
    held_modifiers: &mut ModifierSet,
    pressed_keys: &mut HashSet<rdev::Key>,
    last_position: &mut Option<Point>,
) -> Option<RawInputEvent> {
    use rdev::EventType;
    match event.event_type {
        EventType::MouseMove { x, y } => {
            let point = Point { x, y };
            let delta = if let Some(last) = *last_position {
                RawInputEvent::PointerMove {
                    dx_dip: point.x - last.x,
                    dy_dip: point.y - last.y,
                }
            } else {
                *last_position = Some(point);
                return None;
            };
            *last_position = Some(point);
            Some(delta)
        }
        EventType::ButtonPress(button) => Some(RawInputEvent::ButtonDown {
            button: rdev_button_code(button),
            point: *last_position,
        }),
        EventType::Wheel {
            delta_x: _,
            delta_y,
        } => Some(RawInputEvent::Wheel {
            delta_y: delta_y as f64,
        }),
        EventType::KeyPress(key) => {
            let is_repeat = !pressed_keys.insert(key);
            update_modifiers(key, true, held_modifiers);
            let key_name = event.name.as_deref().and_then(key_character);
            Some(RawInputEvent::KeyDown {
                code: rdev_key_code(key),
                key: key_name.or_else(|| rdev_key_character(key)),
                modifiers: *held_modifiers,
                is_repeat,
            })
        }
        EventType::KeyRelease(key) => {
            pressed_keys.remove(&key);
            update_modifiers(key, false, held_modifiers);
            Some(RawInputEvent::KeyUp {
                code: rdev_key_code(key),
            })
        }
        _ => None,
    }
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) fn key_character(name: &str) -> Option<char> {
    let mut characters = name.chars();
    let first = characters.next()?;
    if characters.next().is_none() {
        return Some(first);
    }
    None
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) fn update_modifiers(key: rdev::Key, pressed: bool, modifiers: &mut ModifierSet) {
    update_modifiers_for_platform(key, pressed, modifiers, cfg!(target_os = "windows"));
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) fn update_modifiers_for_platform(
    key: rdev::Key,
    pressed: bool,
    modifiers: &mut ModifierSet,
    windows: bool,
) {
    use rdev::Key;
    if is_windows_right_meta(key, windows) {
        modifiers.meta = pressed;
        return;
    }
    let target = match key {
        Key::ShiftLeft | Key::ShiftRight => &mut modifiers.shift,
        Key::ControlLeft | Key::ControlRight => &mut modifiers.control,
        Key::Alt | Key::AltGr => &mut modifiers.alt,
        Key::MetaLeft | Key::MetaRight => &mut modifiers.meta,
        Key::CapsLock => return,
        _ => return,
    };
    *target = pressed;
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) fn rdev_button_code(button: rdev::Button) -> u8 {
    use rdev::Button;
    match button {
        Button::Left => 1,
        Button::Right => 2,
        Button::Middle => 3,
        // Windows reports XBUTTON1/XBUTTON2 and macOS reports its extra mouse
        // buttons through Unknown. Keep them distinct instead of folding them
        // into one generic side-button count.
        Button::Unknown(1) | Button::Unknown(4) => 4,
        Button::Unknown(2) | Button::Unknown(5) => 5,
        Button::Unknown(code) => code,
    }
}
