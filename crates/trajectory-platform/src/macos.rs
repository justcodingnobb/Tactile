//! macOS Core Graphics event taps.
//!
//! Each tap runs on its own thread with its own run loop. `shutdown` ends the
//! loop and releases the tap; `paused` only drops events so the taps survive
//! pause/resume cycles.

use crate::Shared;
use crate::keymap::{rdev_key_character, rdev_key_code};
use objc2_core_foundation::{
    CFMachPort, CFRetained, CFRunLoop, CFRunLoopRunResult, kCFRunLoopCommonModes,
    kCFRunLoopDefaultMode,
};
use objc2_core_graphics::{
    CGEvent, CGEventField, CGEventFlags, CGEventTapLocation, CGEventTapOptions,
    CGEventTapPlacement, CGEventTapProxy, CGEventType,
};
use std::collections::HashSet;
use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr::NonNull;
use std::sync::Mutex;
use std::sync::atomic::Ordering;
use trajectory_core::models::{ModifierSet, Point, RawInputEvent};

const RUN_LOOP_SLICE_SECONDS: f64 = 0.25;
const CAPS_LOCK_CODE: u32 = 0x00a0;

pub(crate) trait TapHandler: Send + 'static {
    const NAME: &'static str;
    fn mask() -> u64;
    fn handle(&mut self, kind: CGEventType, event: &CGEvent, out: &mut Vec<RawInputEvent>);
    /// Called for events that arrive while paused (no output allowed).
    fn observe_paused(&mut self, _kind: CGEventType, _event: &CGEvent) {}
}

struct TapContext<H> {
    shared: Shared,
    handler: Mutex<H>,
    tap: Mutex<Option<CFRetained<CFMachPort>>>,
}

unsafe extern "C-unwind" fn tap_callback<H: TapHandler>(
    _proxy: CGEventTapProxy,
    kind: CGEventType,
    event: NonNull<CGEvent>,
    user_info: *mut c_void,
) -> *mut CGEvent {
    if !user_info.is_null() {
        // SAFETY: `user_info` is the `TapContext<H>` owned by `run_tap`, which
        // invalidates the tap before freeing the context.
        let context = unsafe { &*user_info.cast::<TapContext<H>>() };
        // SAFETY: Core Graphics passes a valid event for the callback's duration.
        let event_ref = unsafe { event.as_ref() };
        // A panic must never unwind into Core Graphics; drop the event instead.
        let _ = catch_unwind(AssertUnwindSafe(|| dispatch(context, kind, event_ref)));
    }
    event.as_ptr()
}

fn dispatch<H: TapHandler>(context: &TapContext<H>, kind: CGEventType, event: &CGEvent) {
    if matches!(
        kind,
        CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput
    ) {
        if let Ok(tap) = context.tap.lock()
            && let Some(tap) = tap.as_ref()
        {
            CGEvent::tap_enable(tap, true);
        }
        return;
    }
    let Ok(mut handler) = context.handler.lock() else {
        return;
    };
    if !context.shared.control.accepts_events() {
        handler.observe_paused(kind, event);
        return;
    }
    let mut out = Vec::new();
    handler.handle(kind, event, &mut out);
    for raw in out {
        let _ = context.shared.sender.send(raw);
    }
}

/// Installs a listen-only tap and pumps its run loop until `shutdown` is set.
/// Blocks the calling thread; spawn it on a dedicated thread.
pub(crate) fn run_tap<H: TapHandler>(shared: Shared, handler: H) {
    let context = Box::into_raw(Box::new(TapContext {
        shared: shared.clone(),
        handler: Mutex::new(handler),
        tap: Mutex::new(None),
    }));
    // SAFETY: `context` stays alive until after the tap is invalidated below.
    let tap = unsafe {
        CGEvent::tap_create(
            CGEventTapLocation::HIDEventTap,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            H::mask(),
            Some(tap_callback::<H>),
            context.cast(),
        )
    };
    let result = tap.ok_or("event tap unavailable").and_then(|tap| {
        // SAFETY: no callback can observe the context before the tap is enabled.
        if let Ok(mut slot) = unsafe { &*context }.tap.lock() {
            *slot = Some(tap.clone());
        }
        pump(&shared, &tap)
    });
    if let Ok(mut slot) = unsafe { &*context }.tap.lock() {
        slot.take();
    }
    // SAFETY: the tap was invalidated (or never created), so no callback can
    // reference the context after this point.
    drop(unsafe { Box::from_raw(context) });
    if let Err(message) = result {
        let _ = shared.sender.send(RawInputEvent::HookError {
            message: format!("macOS {} {message}", H::NAME),
        });
    }
}

fn pump(shared: &Shared, tap: &CFMachPort) -> Result<(), &'static str> {
    let source =
        CFMachPort::new_run_loop_source(None, Some(tap), 0).ok_or("run loop source unavailable");
    let run_loop = CFRunLoop::current().ok_or("run loop unavailable");
    let (source, run_loop) = match (source, run_loop) {
        (Ok(source), Ok(run_loop)) => (source, run_loop),
        (Err(error), _) | (_, Err(error)) => {
            tap.invalidate();
            return Err(error);
        }
    };
    // SAFETY: the mode constants are immutable CF globals.
    let common = unsafe { kCFRunLoopCommonModes };
    run_loop.add_source(Some(&source), common);
    CGEvent::tap_enable(tap, true);
    while !shared.control.shutdown.load(Ordering::SeqCst) {
        // SAFETY: as above.
        let mode = unsafe { kCFRunLoopDefaultMode };
        let result = CFRunLoop::run_in_mode(mode, RUN_LOOP_SLICE_SECONDS, false);
        if matches!(result, CFRunLoopRunResult::Finished) {
            // No sources left (tap removed by the system); avoid a busy loop.
            std::thread::sleep(std::time::Duration::from_secs_f64(RUN_LOOP_SLICE_SECONDS));
        }
    }
    run_loop.remove_source(Some(&source), common);
    CGEvent::tap_enable(tap, false);
    tap.invalidate();
    Ok(())
}

#[derive(Default)]
pub(crate) struct KeyboardTap {
    pressed: HashSet<u32>,
}

impl TapHandler for KeyboardTap {
    const NAME: &'static str = "keyboard tap";

    fn mask() -> u64 {
        (1 << CGEventType::KeyDown.0)
            | (1 << CGEventType::KeyUp.0)
            | (1 << CGEventType::FlagsChanged.0)
    }

    fn handle(&mut self, kind: CGEventType, event: &CGEvent, out: &mut Vec<RawInputEvent>) {
        if let Some(raw) = self.map(kind, event) {
            // Caps Lock reports one FlagsChanged per physical press and no
            // release; pair it with a release so downstream state never sticks.
            let caps =
                matches!(&raw, RawInputEvent::KeyDown { code, .. } if *code == CAPS_LOCK_CODE);
            out.push(raw);
            if caps {
                out.push(RawInputEvent::KeyUp {
                    code: CAPS_LOCK_CODE,
                });
            }
        }
    }

    fn observe_paused(&mut self, kind: CGEventType, event: &CGEvent) {
        // Keep key-up state in sync so a key held across resume is not stuck.
        let _ = self.map(kind, event);
    }
}

impl KeyboardTap {
    fn map(&mut self, kind: CGEventType, event: &CGEvent) -> Option<RawInputEvent> {
        let mac_code =
            CGEvent::integer_value_field(Some(event), CGEventField::KeyboardEventKeycode);
        let mac_code = u32::try_from(mac_code).ok()?;
        let key = rdev_key_from_macos_code(mac_code);
        let code = rdev_key_code(key);
        let flags = CGEvent::flags(Some(event));
        let modifiers = modifier_set_from_flags(flags);
        let down = |pressed: &mut HashSet<u32>, is_repeat: bool| {
            let is_repeat = is_repeat || !pressed.insert(code);
            RawInputEvent::KeyDown {
                code,
                key: rdev_key_character(key),
                modifiers,
                is_repeat,
            }
        };
        match kind {
            CGEventType::KeyDown => {
                let autorepeat = CGEvent::integer_value_field(
                    Some(event),
                    CGEventField::KeyboardEventAutorepeat,
                );
                Some(down(&mut self.pressed, autorepeat != 0))
            }
            CGEventType::KeyUp => {
                self.pressed.remove(&code);
                Some(RawInputEvent::KeyUp { code })
            }
            CGEventType::FlagsChanged => {
                // Decide direction from the flag that belongs to this key rather
                // than comparing whole flag words, which misfires when two
                // modifiers overlap (e.g. release Shift while holding Cmd).
                if code == CAPS_LOCK_CODE {
                    return Some(RawInputEvent::KeyDown {
                        code,
                        key: None,
                        modifiers,
                        is_repeat: false,
                    });
                }
                let is_down = match modifier_flag_for_macos_code(mac_code) {
                    Some(flag) => flags.contains(flag) && !self.pressed.contains(&code),
                    None => !self.pressed.contains(&code),
                };
                if is_down {
                    Some(down(&mut self.pressed, false))
                } else {
                    self.pressed.remove(&code);
                    Some(RawInputEvent::KeyUp { code })
                }
            }
            _ => None,
        }
    }
}

fn modifier_flag_for_macos_code(code: u32) -> Option<CGEventFlags> {
    match code {
        54 | 55 => Some(CGEventFlags::MaskCommand),
        56 | 60 => Some(CGEventFlags::MaskShift),
        58 | 61 => Some(CGEventFlags::MaskAlternate),
        59 | 62 => Some(CGEventFlags::MaskControl),
        63 | 179 => Some(CGEventFlags::MaskSecondaryFn),
        _ => None,
    }
}

#[derive(Default)]
pub(crate) struct PointerTap {
    position: Option<Point>,
}

impl TapHandler for PointerTap {
    const NAME: &'static str = "pointer tap";

    fn mask() -> u64 {
        [
            CGEventType::MouseMoved,
            CGEventType::LeftMouseDown,
            CGEventType::RightMouseDown,
            CGEventType::OtherMouseDown,
            CGEventType::LeftMouseDragged,
            CGEventType::RightMouseDragged,
            CGEventType::OtherMouseDragged,
            CGEventType::ScrollWheel,
        ]
        .iter()
        .fold(0, |mask, kind| mask | (1 << kind.0))
    }

    fn handle(&mut self, kind: CGEventType, event: &CGEvent, out: &mut Vec<RawInputEvent>) {
        out.extend(self.map(kind, event));
    }

    fn observe_paused(&mut self, kind: CGEventType, event: &CGEvent) {
        // Track position silently so resume does not count a jump as travel.
        if is_motion(kind) {
            self.position = Some(location(event));
        }
    }
}

impl PointerTap {
    fn map(&mut self, kind: CGEventType, event: &CGEvent) -> Option<RawInputEvent> {
        if is_motion(kind) {
            let point = location(event);
            let previous = self.position.replace(point);
            return previous.map(|last| RawInputEvent::PointerMove {
                dx_dip: point.x - last.x,
                dy_dip: point.y - last.y,
            });
        }
        let button = match kind {
            CGEventType::LeftMouseDown => 1,
            CGEventType::RightMouseDown => 2,
            CGEventType::OtherMouseDown => {
                let number =
                    CGEvent::integer_value_field(Some(event), CGEventField::MouseEventButtonNumber);
                // Core Graphics numbers buttons from 0; extra buttons map to 4+.
                u8::try_from(number.saturating_add(1))
                    .unwrap_or(u8::MAX)
                    .max(3)
            }
            CGEventType::ScrollWheel => {
                let delta = CGEvent::double_value_field(
                    Some(event),
                    CGEventField::ScrollWheelEventPointDeltaAxis1,
                );
                return Some(RawInputEvent::Wheel { delta_y: delta });
            }
            _ => return None,
        };
        // Clicks carry their own location, which stays correct even if a move
        // event was coalesced away.
        let point = location(event);
        self.position = Some(point);
        Some(RawInputEvent::ButtonDown {
            button,
            point: Some(point),
        })
    }
}

fn is_motion(kind: CGEventType) -> bool {
    matches!(
        kind,
        CGEventType::MouseMoved
            | CGEventType::LeftMouseDragged
            | CGEventType::RightMouseDragged
            | CGEventType::OtherMouseDragged
    )
}

fn location(event: &CGEvent) -> Point {
    let location = CGEvent::location(Some(event));
    Point {
        x: location.x,
        y: location.y,
    }
}

pub(crate) fn modifier_set_from_flags(flags: CGEventFlags) -> ModifierSet {
    ModifierSet {
        shift: flags.contains(CGEventFlags::MaskShift),
        control: flags.contains(CGEventFlags::MaskControl),
        alt: flags.contains(CGEventFlags::MaskAlternate),
        meta: flags.contains(CGEventFlags::MaskCommand),
        caps_lock: flags.contains(CGEventFlags::MaskAlphaShift),
    }
}

pub(crate) fn rdev_key_from_macos_code(code: u32) -> rdev::Key {
    use rdev::Key;
    match code {
        0 => Key::KeyA,
        1 => Key::KeyS,
        2 => Key::KeyD,
        3 => Key::KeyF,
        4 => Key::KeyH,
        5 => Key::KeyG,
        6 => Key::KeyZ,
        7 => Key::KeyX,
        8 => Key::KeyC,
        9 => Key::KeyV,
        11 => Key::KeyB,
        12 => Key::KeyQ,
        13 => Key::KeyW,
        14 => Key::KeyE,
        15 => Key::KeyR,
        16 => Key::KeyY,
        17 => Key::KeyT,
        18 => Key::Num1,
        19 => Key::Num2,
        20 => Key::Num3,
        21 => Key::Num4,
        22 => Key::Num6,
        23 => Key::Num5,
        24 => Key::Equal,
        25 => Key::Num9,
        26 => Key::Num7,
        27 => Key::Minus,
        28 => Key::Num8,
        29 => Key::Num0,
        30 => Key::RightBracket,
        31 => Key::KeyO,
        32 => Key::KeyU,
        33 => Key::LeftBracket,
        34 => Key::KeyI,
        35 => Key::KeyP,
        36 => Key::Return,
        37 => Key::KeyL,
        38 => Key::KeyJ,
        39 => Key::Quote,
        40 => Key::KeyK,
        41 => Key::SemiColon,
        42 => Key::BackSlash,
        43 => Key::Comma,
        44 => Key::Slash,
        45 => Key::KeyN,
        46 => Key::KeyM,
        47 => Key::Dot,
        48 => Key::Tab,
        49 => Key::Space,
        50 => Key::BackQuote,
        51 => Key::Backspace,
        53 => Key::Escape,
        54 => Key::MetaRight,
        55 => Key::MetaLeft,
        56 => Key::ShiftLeft,
        57 => Key::CapsLock,
        58 => Key::Alt,
        59 => Key::ControlLeft,
        60 => Key::ShiftRight,
        61 => Key::AltGr,
        62 => Key::ControlRight,
        // 63 is the classic Fn key; 179 is the globe/Fn key on newer keyboards.
        63 | 179 => Key::Function,
        96 => Key::F5,
        97 => Key::F6,
        98 => Key::F7,
        99 => Key::F3,
        100 => Key::F8,
        101 => Key::F9,
        103 => Key::F11,
        109 => Key::F10,
        111 => Key::F12,
        118 => Key::F4,
        120 => Key::F2,
        122 => Key::F1,
        123 => Key::LeftArrow,
        124 => Key::RightArrow,
        125 => Key::DownArrow,
        126 => Key::UpArrow,
        10 => Key::IntlBackslash,
        65 => Key::KpDelete,
        67 => Key::KpMultiply,
        69 => Key::KpPlus,
        71 => Key::NumLock,
        75 => Key::KpDivide,
        76 => Key::KpReturn,
        78 => Key::KpMinus,
        82 => Key::Kp0,
        83 => Key::Kp1,
        84 => Key::Kp2,
        85 => Key::Kp3,
        86 => Key::Kp4,
        87 => Key::Kp5,
        88 => Key::Kp6,
        89 => Key::Kp7,
        91 => Key::Kp8,
        92 => Key::Kp9,
        114 => Key::Insert,
        115 => Key::Home,
        116 => Key::PageUp,
        117 => Key::Delete,
        119 => Key::End,
        121 => Key::PageDown,
        _ => Key::Unknown(code),
    }
}
