use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::thread::JoinHandle;
use std::time::Duration;
use tactile_core::capture::{CaptureError, CaptureSource};
use tactile_core::models::RawInputEvent;

mod keymap;
#[cfg(target_os = "macos")]
mod macos;
mod rdev_listener;
pub mod secure_input;

const FALLBACK_DISPLAY: (f64, f64) = (1920.0, 1080.0);

/// Flags shared by the capture owner and every listener thread of one session.
#[derive(Default)]
pub(crate) struct Control {
    /// Events are dropped while set; listeners stay installed.
    pub paused: AtomicBool,
    /// Listeners exit and release their hooks once set.
    pub shutdown: AtomicBool,
}

impl Control {
    pub fn accepts_events(&self) -> bool {
        !self.paused.load(Ordering::SeqCst) && !self.shutdown.load(Ordering::SeqCst)
    }
}

#[derive(Clone)]
pub(crate) struct Shared {
    pub sender: Sender<RawInputEvent>,
    pub control: Arc<Control>,
}

/// One capture session. `start` installs the OS hooks, `stop` releases them.
/// Pausing keeps the hooks installed and only drops events, so resume is
/// instant and cannot fail.
pub struct PlatformCapture {
    receiver: Option<Receiver<RawInputEvent>>,
    control: Option<Arc<Control>>,
    threads: Vec<JoinHandle<()>>,
}

impl PlatformCapture {
    pub fn new() -> Self {
        Self {
            receiver: None,
            control: None,
            threads: Vec::new(),
        }
    }

    pub fn is_running(&self) -> bool {
        self.control.is_some()
            && self.threads.iter().all(|thread| !thread.is_finished())
            && rdev_listener::is_alive()
    }

    pub fn set_paused(&mut self, paused: bool) -> Result<(), CaptureError> {
        if let Some(control) = &self.control {
            control.paused.store(paused, Ordering::SeqCst);
        }
        Ok(())
    }
}

impl CaptureSource for PlatformCapture {
    fn start(&mut self) -> Result<(), CaptureError> {
        if self.is_running() {
            return Ok(());
        }
        self.stop()?;
        let (sender, receiver) = channel();
        let control = Arc::new(Control::default());
        let shared = Shared {
            sender,
            control: control.clone(),
        };
        self.threads = spawn_listeners(shared)?;
        self.receiver = Some(receiver);
        self.control = Some(control);
        Ok(())
    }

    fn stop(&mut self) -> Result<(), CaptureError> {
        if let Some(control) = self.control.take() {
            control.shutdown.store(true, Ordering::SeqCst);
        }
        rdev_listener::detach();
        // Listener threads notice `shutdown` within one run-loop slice and
        // release their hooks; joining here would block the caller.
        self.threads.clear();
        self.receiver = None;
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
        events.extend(receiver.try_iter());
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

impl Drop for PlatformCapture {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(target_os = "macos")]
fn spawn_listeners(shared: Shared) -> Result<Vec<JoinHandle<()>>, CaptureError> {
    let spawn = |name: &str, job: Box<dyn FnOnce() + Send>| {
        std::thread::Builder::new()
            .name(name.into())
            .spawn(job)
            .map_err(|error| CaptureError::HookUnavailable(error.to_string()))
    };
    let keyboard = shared.clone();
    let pointer = shared;
    Ok(vec![
        spawn(
            "tactile-keyboard",
            Box::new(move || macos::run_tap(keyboard, macos::KeyboardTap::default())),
        )?,
        spawn(
            "tactile-pointer",
            Box::new(move || macos::run_tap(pointer, macos::PointerTap::default())),
        )?,
    ])
}

#[cfg(not(target_os = "macos"))]
fn spawn_listeners(shared: Shared) -> Result<Vec<JoinHandle<()>>, CaptureError> {
    rdev_listener::attach(shared)?;
    Ok(Vec::new())
}

pub fn main_display_size() -> (f64, f64) {
    #[cfg(target_os = "macos")]
    {
        use objc2_core_graphics::{CGDisplayBounds, CGMainDisplayID};
        let bounds = CGDisplayBounds(CGMainDisplayID());
        if bounds.size.width > 0.0 && bounds.size.height > 0.0 {
            return (bounds.size.width, bounds.size.height);
        }
        FALLBACK_DISPLAY
    }
    #[cfg(not(target_os = "macos"))]
    {
        rdev::display_size()
            .ok()
            .filter(|(width, height)| *width > 0 && *height > 0)
            .map(|(width, height)| (width as f64, height as f64))
            .unwrap_or(FALLBACK_DISPLAY)
    }
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
#[cfg(test)]
mod tests {
    use super::*;
    use crate::keymap::{rdev_key_code, rdev_key_code_for_platform};
    use crate::rdev_listener::{map_rdev_event, update_modifiers_for_platform};
    use std::collections::HashSet;
    use std::time::SystemTime;
    use tactile_core::models::ModifierSet;

    fn event(event_type: rdev::EventType) -> rdev::Event {
        rdev::Event {
            time: SystemTime::UNIX_EPOCH,
            name: None,
            event_type,
        }
    }

    #[test]
    fn second_keypress_before_release_is_marked_repeat() {
        let mut modifiers = ModifierSet::default();
        let mut pressed = HashSet::new();
        let mut position = None;
        let press = rdev::EventType::KeyPress(rdev::Key::KeyA);

        assert!(matches!(
            map_rdev_event(event(press), &mut modifiers, &mut pressed, &mut position),
            Some(RawInputEvent::KeyDown {
                is_repeat: false,
                ..
            })
        ));
        assert!(matches!(
            map_rdev_event(event(press), &mut modifiers, &mut pressed, &mut position),
            Some(RawInputEvent::KeyDown {
                is_repeat: true,
                ..
            })
        ));
    }

    #[test]
    fn windows_right_meta_is_a_modifier() {
        let mut modifiers = ModifierSet::default();
        update_modifiers_for_platform(rdev::Key::Unknown(0x5c), true, &mut modifiers, true);
        assert!(modifiers.meta);
        assert_eq!(
            rdev_key_code_for_platform(rdev::Key::Unknown(0x5c), true),
            0xa7
        );
    }

    #[test]
    fn right_meta_unknown_value_is_not_remapped_on_macos() {
        let mut modifiers = ModifierSet::default();
        update_modifiers_for_platform(rdev::Key::Unknown(0x5c), true, &mut modifiers, false);
        assert!(!modifiers.meta);
    }

    #[test]
    fn pause_keeps_session_but_blocks_events() {
        let control = Control::default();
        assert!(control.accepts_events());
        control.paused.store(true, Ordering::SeqCst);
        assert!(!control.accepts_events());
        control.paused.store(false, Ordering::SeqCst);
        assert!(control.accepts_events());
        control.shutdown.store(true, Ordering::SeqCst);
        assert!(!control.accepts_events());
    }

    #[test]
    fn stop_without_start_is_harmless() {
        let mut capture = PlatformCapture::new();
        assert!(capture.stop().is_ok());
        assert!(capture.set_paused(true).is_ok());
        assert!(!capture.is_running());
        assert!(matches!(
            capture.poll(Duration::from_millis(1)),
            Err(CaptureError::Disconnected)
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_keycode_maps_to_physical_id() {
        use crate::macos::{modifier_set_from_flags, rdev_key_from_macos_code};
        use objc2_core_graphics::CGEventFlags;

        assert_eq!(
            rdev_key_code(rdev_key_from_macos_code(0)),
            rdev_key_code(rdev::Key::KeyA)
        );
        assert_eq!(
            rdev_key_code(rdev_key_from_macos_code(55)),
            rdev_key_code(rdev::Key::MetaLeft)
        );
        let modifiers = modifier_set_from_flags(
            CGEventFlags::MaskShift | CGEventFlags::MaskCommand | CGEventFlags::MaskAlphaShift,
        );
        assert!(modifiers.shift);
        assert!(modifiers.meta);
        assert!(modifiers.caps_lock);
        assert!(!modifiers.control);
    }
}
