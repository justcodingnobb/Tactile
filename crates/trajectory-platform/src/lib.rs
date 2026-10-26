use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::thread;
use std::time::Duration;
use trajectory_core::capture::{CaptureError, CaptureSource};
use trajectory_core::models::{ModifierSet, Point, RawInputEvent};

pub mod secure_input;

pub struct PlatformCapture {
    receiver: Option<Receiver<RawInputEvent>>,
    stop_tx: Option<Sender<()>>,
    running: bool,
}

impl PlatformCapture {
    pub fn new() -> Self {
        Self {
            receiver: None,
            stop_tx: None,
            running: false,
        }
    }

    pub fn is_running(&self) -> bool {
        self.running
    }
}

impl CaptureSource for PlatformCapture {
    fn start(&mut self) -> Result<(), CaptureError> {
        if self.running {
            return Ok(());
        }
        let (event_tx, event_rx) = channel();
        let (stop_tx, stop_rx) = channel();
        thread::Builder::new()
            .name("trajectory-input".into())
            .spawn(move || run_rdev_listener(event_tx, stop_rx))
            .map_err(|error| CaptureError::HookUnavailable(error.to_string()))?;
        self.receiver = Some(event_rx);
        self.stop_tx = Some(stop_tx);
        self.running = true;
        Ok(())
    }

    fn stop(&mut self) -> Result<(), CaptureError> {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        self.receiver = None;
        self.running = false;
        Ok(())
    }

    fn poll(&mut self, timeout: Duration) -> Result<Vec<RawInputEvent>, CaptureError> {
        let receiver = self.receiver.as_ref().ok_or(CaptureError::Disconnected)?;
        let mut events = Vec::new();
        match receiver.recv_timeout(timeout) {
            Ok(event) => events.push(event),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err(CaptureError::Disconnected),
        }
        while let Ok(event) = receiver.try_recv() {
            events.push(event);
        }
        Ok(events)
    }

    fn permission_granted(&self) -> bool {
        permission_granted()
    }

    fn platform_name(&self) -> &'static str {
        std::env::consts::OS
    }
}

impl Default for PlatformCapture {
    fn default() -> Self {
        Self::new()
    }
}

fn run_rdev_listener(event_tx: Sender<RawInputEvent>, stop_rx: Receiver<()>) {
    #[cfg(target_os = "macos")]
    {
        let keyboard_tx = event_tx.clone();
        let paused = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let keyboard_paused = paused.clone();
        let _keyboard_thread = thread::Builder::new()
            .name("trajectory-keyboard".into())
            .spawn(move || run_rdev_keyboard_listener(keyboard_tx, keyboard_paused))
            .ok();
        let pointer_paused = paused.clone();
        let pointer_thread = thread::Builder::new()
            .name("trajectory-pointer".into())
            .spawn(move || run_macos_pointer_listener(event_tx, pointer_paused))
            .ok();
        while pointer_thread.is_some() {
            if stop_rx.recv_timeout(Duration::from_millis(250)).is_ok() {
                paused.store(true, std::sync::atomic::Ordering::Relaxed);
                break;
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        run_rdev_listener_platform(event_tx, stop_rx);
    }
}

#[cfg(not(target_os = "macos"))]
fn run_rdev_listener_platform(event_tx: Sender<RawInputEvent>, stop_rx: Receiver<()>) {
    let mut held_modifiers = ModifierSet::default();
    let mut last_position: Option<Point> = None;
    let error_tx = event_tx.clone();
    let result = rdev::listen(move |event| {
        if stop_rx.try_recv().is_ok() {
            return;
        }
        if let Some(raw) = map_rdev_event(event, &mut held_modifiers, &mut last_position) {
            let _ = event_tx.send(raw);
        }
    });
    if let Err(error) = result {
        let _ = error_tx.send(RawInputEvent::HookError {
            message: format!("{error:?}"),
        });
    }
}

#[cfg(target_os = "macos")]
fn run_rdev_keyboard_listener(
    event_tx: Sender<RawInputEvent>,
    paused: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    let mut held_modifiers = ModifierSet::default();
    let error_tx = event_tx.clone();
    let result = rdev::listen(move |event| {
        if paused.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        if !matches!(
            event.event_type,
            rdev::EventType::KeyPress(_) | rdev::EventType::KeyRelease(_)
        ) {
            return;
        }
        let mut ignored_position = None;
        if let Some(raw) = map_rdev_event(event, &mut held_modifiers, &mut ignored_position) {
            let _ = event_tx.send(raw);
        }
    });
    if let Err(error) = result {
        let _ = error_tx.send(RawInputEvent::HookError {
            message: format!("{error:?}"),
        });
    }
}

#[cfg(target_os = "macos")]
fn run_macos_pointer_listener(
    event_tx: Sender<RawInputEvent>,
    paused: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    use objc2_core_foundation::{
        CFMachPort, CFRetained, CFRunLoop, CFRunLoopRunResult, kCFRunLoopCommonModes,
        kCFRunLoopDefaultMode,
    };
    use objc2_core_graphics::{
        CGEvent, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
    };
    use std::ffi::c_void;
    use std::ptr::NonNull;
    use std::sync::Mutex;

    struct PointerState {
        sender: Sender<RawInputEvent>,
        position: Mutex<Option<Point>>,
        paused: std::sync::Arc<std::sync::atomic::AtomicBool>,
        tap: Mutex<Option<CFRetained<CFMachPort>>>,
    }

    unsafe extern "C-unwind" fn callback(
        _proxy: objc2_core_graphics::CGEventTapProxy,
        event_type: CGEventType,
        event: NonNull<CGEvent>,
        user_info: *mut c_void,
    ) -> *mut CGEvent {
        if user_info.is_null() {
            return event.as_ptr();
        }
        let event_ref = unsafe { event.as_ref() };
        let state = unsafe { &*(user_info.cast::<PointerState>()) };
        if state.paused.load(std::sync::atomic::Ordering::Relaxed) {
            return event.as_ptr();
        }
        if matches!(
            event_type,
            CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput
        ) {
            if let Ok(tap) = state.tap.lock()
                && let Some(tap) = tap.as_ref()
            {
                CGEvent::tap_enable(tap, true);
            }
            return event.as_ptr();
        }
        if let Ok(mut position) = state.position.lock()
            && let Some(raw) = map_macos_pointer_event(event_type, event_ref, &mut position)
        {
            let _ = state.sender.send(raw);
        }
        event.as_ptr()
    }

    let state = Box::new(PointerState {
        sender: event_tx,
        position: Mutex::new(None),
        paused: paused.clone(),
        tap: Mutex::new(None),
    });
    let state_ptr = Box::into_raw(state);
    let event_mask = (1_u64 << CGEventType::MouseMoved.0)
        | (1_u64 << CGEventType::LeftMouseDown.0)
        | (1_u64 << CGEventType::RightMouseDown.0)
        | (1_u64 << CGEventType::OtherMouseDown.0)
        | (1_u64 << CGEventType::LeftMouseDragged.0)
        | (1_u64 << CGEventType::RightMouseDragged.0)
        | (1_u64 << CGEventType::OtherMouseDragged.0)
        | (1_u64 << CGEventType::ScrollWheel.0);
    let Some(tap) = (unsafe {
        CGEvent::tap_create(
            CGEventTapLocation::HIDEventTap,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            event_mask,
            Some(callback),
            state_ptr.cast(),
        )
    }) else {
        let state = unsafe { Box::from_raw(state_ptr) };
        let _ = state.sender.send(RawInputEvent::HookError {
            message: "macOS pointer event tap unavailable".into(),
        });
        paused.store(true, std::sync::atomic::Ordering::Relaxed);
        return;
    };
    if let Ok(mut slot) = unsafe { &*state_ptr }.tap.lock() {
        *slot = Some(tap.clone());
    }
    let Some(source) = CFMachPort::new_run_loop_source(None, Some(&tap), 0) else {
        CGEvent::tap_enable(&tap, false);
        tap.invalidate();
        let state = unsafe { Box::from_raw(state_ptr) };
        let _ = state.sender.send(RawInputEvent::HookError {
            message: "macOS pointer run loop source unavailable".into(),
        });
        paused.store(true, std::sync::atomic::Ordering::Relaxed);
        return;
    };
    let Some(run_loop) = CFRunLoop::current() else {
        CGEvent::tap_enable(&tap, false);
        tap.invalidate();
        let state = unsafe { Box::from_raw(state_ptr) };
        let _ = state.sender.send(RawInputEvent::HookError {
            message: "macOS pointer run loop unavailable".into(),
        });
        paused.store(true, std::sync::atomic::Ordering::Relaxed);
        return;
    };
    run_loop.add_source(Some(&source), unsafe { kCFRunLoopCommonModes });
    CGEvent::tap_enable(&tap, true);
    while !paused.load(std::sync::atomic::Ordering::Relaxed) {
        let result = CFRunLoop::run_in_mode(unsafe { kCFRunLoopDefaultMode }, 0.25, false);
        if matches!(
            result,
            CFRunLoopRunResult::Finished | CFRunLoopRunResult::Stopped
        ) {
            break;
        }
    }
    run_loop.remove_source(Some(&source), unsafe { kCFRunLoopCommonModes });
    CGEvent::tap_enable(&tap, false);
    tap.invalidate();
    if let Ok(mut slot) = unsafe { &*state_ptr }.tap.lock() {
        *slot = None;
    }
    drop(unsafe { Box::from_raw(state_ptr) });
}

pub fn main_display_size() -> (f64, f64) {
    #[cfg(target_os = "macos")]
    {
        use objc2_core_graphics::{CGDisplayBounds, CGMainDisplayID};
        let bounds = CGDisplayBounds(CGMainDisplayID());
        if bounds.size.width > 0.0 && bounds.size.height > 0.0 {
            return (bounds.size.width, bounds.size.height);
        }
        (1920.0, 1080.0)
    }
    #[cfg(not(target_os = "macos"))]
    {
        rdev::display_size()
            .map(|(width, height)| (width as f64, height as f64))
            .unwrap_or((1920.0, 1080.0))
    }
}

#[cfg(target_os = "macos")]
fn map_macos_pointer_event(
    event_type: objc2_core_graphics::CGEventType,
    event: &objc2_core_graphics::CGEvent,
    last_position: &mut Option<Point>,
) -> Option<RawInputEvent> {
    use objc2_core_graphics::{CGEvent, CGEventField, CGEventType};
    match event_type {
        CGEventType::MouseMoved
        | CGEventType::LeftMouseDragged
        | CGEventType::RightMouseDragged
        | CGEventType::OtherMouseDragged => {
            let location = CGEvent::location(Some(event));
            let point = Point {
                x: location.x,
                y: location.y,
            };
            let delta = last_position.map(|last| RawInputEvent::PointerMove {
                dx_dip: point.x - last.x,
                dy_dip: point.y - last.y,
            });
            *last_position = Some(point);
            delta
        }
        CGEventType::LeftMouseDown => Some(RawInputEvent::ButtonDown {
            button: 1,
            point: *last_position,
        }),
        CGEventType::RightMouseDown => Some(RawInputEvent::ButtonDown {
            button: 2,
            point: *last_position,
        }),
        CGEventType::OtherMouseDown => {
            let number =
                CGEvent::integer_value_field(Some(event), CGEventField::MouseEventButtonNumber);
            let button = match number {
                0 => 1,
                1 => 2,
                2 => 3,
                other => 4_u8.saturating_add(other.saturating_sub(3) as u8),
            };
            Some(RawInputEvent::ButtonDown {
                button,
                point: *last_position,
            })
        }
        CGEventType::ScrollWheel => {
            let delta = CGEvent::double_value_field(
                Some(event),
                CGEventField::ScrollWheelEventPointDeltaAxis1,
            );
            Some(RawInputEvent::Wheel { delta_y: delta })
        }
        _ => None,
    }
}

fn map_rdev_event(
    event: rdev::Event,
    held_modifiers: &mut ModifierSet,
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
            update_modifiers(key, true, held_modifiers);
            let key_name = event.name.as_deref().and_then(key_character);
            Some(RawInputEvent::KeyDown {
                code: rdev_key_code(key),
                key: key_name.or_else(|| rdev_key_character(key)),
                modifiers: *held_modifiers,
                is_repeat: false,
            })
        }
        EventType::KeyRelease(key) => {
            update_modifiers(key, false, held_modifiers);
            Some(RawInputEvent::KeyUp {
                code: rdev_key_code(key),
            })
        }
        _ => None,
    }
}

fn key_character(name: &str) -> Option<char> {
    let mut characters = name.chars();
    let first = characters.next()?;
    if characters.next().is_none() {
        return Some(first);
    }
    None
}

fn update_modifiers(key: rdev::Key, pressed: bool, modifiers: &mut ModifierSet) {
    use rdev::Key;
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

fn rdev_button_code(button: rdev::Button) -> u8 {
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

fn rdev_key_code(key: rdev::Key) -> u32 {
    use rdev::Key;
    match key {
        Key::KeyA => 0x41,
        Key::KeyB => 0x42,
        Key::KeyC => 0x43,
        Key::KeyD => 0x44,
        Key::KeyE => 0x45,
        Key::KeyF => 0x46,
        Key::KeyG => 0x47,
        Key::KeyH => 0x48,
        Key::KeyI => 0x49,
        Key::KeyJ => 0x4a,
        Key::KeyK => 0x4b,
        Key::KeyL => 0x4c,
        Key::KeyM => 0x4d,
        Key::KeyN => 0x4e,
        Key::KeyO => 0x4f,
        Key::KeyP => 0x50,
        Key::KeyQ => 0x51,
        Key::KeyR => 0x52,
        Key::KeyS => 0x53,
        Key::KeyT => 0x54,
        Key::KeyU => 0x55,
        Key::KeyV => 0x56,
        Key::KeyW => 0x57,
        Key::KeyX => 0x58,
        Key::KeyY => 0x59,
        Key::KeyZ => 0x5a,
        Key::Num0 => 0x30,
        Key::Num1 => 0x31,
        Key::Num2 => 0x32,
        Key::Num3 => 0x33,
        Key::Num4 => 0x34,
        Key::Num5 => 0x35,
        Key::Num6 => 0x36,
        Key::Num7 => 0x37,
        Key::Num8 => 0x38,
        Key::Num9 => 0x39,
        Key::Space => 0x20,
        Key::Return => 0x0d,
        Key::Tab => 0x09,
        Key::Escape => 0x1b,
        Key::Backspace => 0x08,
        Key::Delete => 0x7f,
        Key::UpArrow => 0x26,
        Key::DownArrow => 0x28,
        Key::LeftArrow => 0x25,
        Key::RightArrow => 0x27,
        Key::ShiftLeft => 0x10,
        Key::ControlLeft => 0x11,
        Key::Alt => 0x12,
        Key::MetaLeft => 0x14,
        Key::ShiftRight => 0x10,
        Key::ControlRight => 0x11,
        Key::AltGr => 0x12,
        Key::MetaRight => 0x14,
        Key::F1 => 0xf704,
        Key::F2 => 0xf705,
        Key::F3 => 0xf706,
        Key::F4 => 0xf707,
        Key::F5 => 0xf708,
        Key::F6 => 0xf709,
        Key::F7 => 0xf70a,
        Key::F8 => 0xf70b,
        Key::F9 => 0xf70c,
        Key::F10 => 0xf70d,
        Key::F11 => 0xf70e,
        Key::F12 => 0xf70f,
        Key::BackQuote => 0x00c0,
        Key::Minus => 0x00bd,
        Key::Equal => 0x00bb,
        Key::LeftBracket => 0x00db,
        Key::RightBracket => 0x00dd,
        Key::SemiColon => 0x00ba,
        Key::Quote => 0x00de,
        Key::BackSlash => 0x00dc,
        Key::IntlBackslash => 0x00e2,
        Key::Comma => 0x00bc,
        Key::Dot => 0x00be,
        Key::Slash => 0x00bf,
        Key::CapsLock => 0x00a0,
        Key::Insert => 0x002d,
        Key::Home => 0x0024,
        Key::PageUp => 0x0021,
        Key::End => 0x0023,
        Key::PageDown => 0x0022,
        Key::PrintScreen => 0x002c,
        Key::ScrollLock => 0x0091,
        Key::Pause => 0x0013,
        Key::NumLock => 0x0090,
        Key::KpReturn => 0x000d,
        Key::KpDivide => 0x006f,
        Key::KpMultiply => 0x006a,
        Key::KpMinus => 0x006d,
        Key::KpPlus => 0x006b,
        Key::Kp0 => 0x0060,
        Key::Kp1 => 0x0061,
        Key::Kp2 => 0x0062,
        Key::Kp3 => 0x0063,
        Key::Kp4 => 0x0064,
        Key::Kp5 => 0x0065,
        Key::Kp6 => 0x0066,
        Key::Kp7 => 0x0067,
        Key::Kp8 => 0x0068,
        Key::Kp9 => 0x0069,
        Key::KpDelete => 0x006e,
        Key::Function => 0x00a8,
        Key::Unknown(code) => 0x1000 + code,
    }
}

fn rdev_key_character(key: rdev::Key) -> Option<char> {
    use rdev::Key;
    let ch = match key {
        Key::KeyA => 'a',
        Key::KeyB => 'b',
        Key::KeyC => 'c',
        Key::KeyD => 'd',
        Key::KeyE => 'e',
        Key::KeyF => 'f',
        Key::KeyG => 'g',
        Key::KeyH => 'h',
        Key::KeyI => 'i',
        Key::KeyJ => 'j',
        Key::KeyK => 'k',
        Key::KeyL => 'l',
        Key::KeyM => 'm',
        Key::KeyN => 'n',
        Key::KeyO => 'o',
        Key::KeyP => 'p',
        Key::KeyQ => 'q',
        Key::KeyR => 'r',
        Key::KeyS => 's',
        Key::KeyT => 't',
        Key::KeyU => 'u',
        Key::KeyV => 'v',
        Key::KeyW => 'w',
        Key::KeyX => 'x',
        Key::KeyY => 'y',
        Key::KeyZ => 'z',
        Key::Num0 => '0',
        Key::Num1 => '1',
        Key::Num2 => '2',
        Key::Num3 => '3',
        Key::Num4 => '4',
        Key::Num5 => '5',
        Key::Num6 => '6',
        Key::Num7 => '7',
        Key::Num8 => '8',
        Key::Num9 => '9',
        Key::BackQuote => '`',
        Key::Minus => '-',
        Key::Equal => '=',
        Key::LeftBracket => '[',
        Key::RightBracket => ']',
        Key::SemiColon => ';',
        Key::Quote => '\'',
        Key::BackSlash => '\\',
        Key::IntlBackslash => '\\',
        Key::Comma => ',',
        Key::Dot => '.',
        Key::Slash => '/',
        Key::KpReturn => '\r',
        Key::KpDivide => '/',
        Key::KpMultiply => '*',
        Key::KpMinus => '-',
        Key::KpPlus => '+',
        Key::Kp0 => '0',
        Key::Kp1 => '1',
        Key::Kp2 => '2',
        Key::Kp3 => '3',
        Key::Kp4 => '4',
        Key::Kp5 => '5',
        Key::Kp6 => '6',
        Key::Kp7 => '7',
        Key::Kp8 => '8',
        Key::Kp9 => '9',
        Key::KpDelete => '.',
        _ => return None,
    };
    Some(ch)
}

pub fn permission_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2_core_graphics::CGPreflightListenEventAccess;
        CGPreflightListenEventAccess()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub fn request_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2_core_graphics::{CGPreflightListenEventAccess, CGRequestListenEventAccess};
        if CGPreflightListenEventAccess() {
            return true;
        }
        CGRequestListenEventAccess()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}
