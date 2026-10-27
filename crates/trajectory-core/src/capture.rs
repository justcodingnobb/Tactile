use crate::keys::{KeyId, classify_key_press};
use crate::models::{
    CaptureState, CaptureStatus, InputEvent, ModifierSet, PointerButton, RawInputEvent,
};
use std::collections::HashSet;
use std::time::Duration;
use thiserror::Error;

pub trait CaptureSource: Send {
    fn start(&mut self) -> Result<(), CaptureError>;
    fn stop(&mut self) -> Result<(), CaptureError>;
    fn poll(&mut self, timeout: Duration) -> Result<Vec<RawInputEvent>, CaptureError>;
    fn permission_granted(&self) -> bool;
    fn platform_name(&self) -> &'static str;
}

#[derive(Debug, Error)]
pub enum CaptureError {
    #[error("input permission has not been granted")]
    PermissionDenied,
    #[error("the input hook could not be started: {0}")]
    HookUnavailable(String),
    #[error("capture stream disconnected")]
    Disconnected,
}

#[derive(Clone)]
pub struct EventNormalizer {
    held_modifiers: HashSet<KeyId>,
    pressed_keys: HashSet<KeyId>,
    secure_input: bool,
}

impl EventNormalizer {
    pub fn new() -> Self {
        Self {
            held_modifiers: HashSet::new(),
            pressed_keys: HashSet::new(),
            secure_input: false,
        }
    }

    pub fn normalize(&mut self, event: RawInputEvent) -> Option<InputEvent> {
        match event {
            RawInputEvent::SecureInputChanged { active } => {
                self.secure_input = active;
                if active {
                    self.held_modifiers.clear();
                    self.pressed_keys.clear();
                }
                Some(InputEvent::SecureInputChanged { active })
            }
            RawInputEvent::KeyDown {
                code,
                key,
                modifiers,
                is_repeat,
            } => {
                let key_id = KeyId(code);
                let was_pressed = !self.pressed_keys.insert(key_id);
                if self.secure_input || is_repeat || was_pressed {
                    return None;
                }
                if crate::keys::is_modifier(code) {
                    self.held_modifiers.insert(key_id);
                    return None;
                }
                let effective = self.effective_modifiers(modifiers);
                classify_key_press(key_id, key, effective).map(|press| InputEvent::KeyPress {
                    key: press.identity,
                    modifiers: effective,
                    shortcut: press.shortcut,
                })
            }
            RawInputEvent::KeyUp { code } => {
                let key_id = KeyId(code);
                self.held_modifiers.remove(&key_id);
                self.pressed_keys.remove(&key_id);
                None
            }
            RawInputEvent::PointerMove { dx_dip, dy_dip } => {
                if !dx_dip.is_finite() || !dy_dip.is_finite() {
                    return None;
                }
                Some(InputEvent::PointerMove { dx_dip, dy_dip })
            }
            RawInputEvent::ButtonDown { button, point } => {
                let button = match button {
                    1 => PointerButton::Left,
                    2 => PointerButton::Right,
                    3 => PointerButton::Middle,
                    4 => PointerButton::Side1,
                    5 => PointerButton::Side2,
                    6..=255 => PointerButton::OtherSide,
                    _ => PointerButton::OtherSide,
                };
                Some(InputEvent::ButtonDown { button, point })
            }
            RawInputEvent::Wheel { delta_y } => {
                if !delta_y.is_finite() {
                    return None;
                }
                Some(InputEvent::Wheel { delta_y })
            }
            RawInputEvent::HookError { .. } => None,
        }
    }

    pub fn is_secure_input(&self) -> bool {
        self.secure_input
    }

    pub fn set_secure_input(&mut self, active: bool) {
        self.secure_input = active;
        if active {
            self.reset_key_state();
        }
    }

    pub fn reset_key_state(&mut self) {
        self.held_modifiers.clear();
        self.pressed_keys.clear();
    }

    fn effective_modifiers(&self, explicit: ModifierSet) -> ModifierSet {
        let mut effective = explicit;
        for key in &self.held_modifiers {
            match key.0 {
                0x0010 | 0x00a1 => effective.shift = true,
                0x0011 | 0x00a3 => effective.control = true,
                0x0012 | 0x00a5 => effective.alt = true,
                0x0014 | 0x00a7 | 0x005b | 0x005c => effective.meta = true,
                _ => {}
            }
        }
        effective
    }
}

impl Default for EventNormalizer {
    fn default() -> Self {
        Self::new()
    }
}

pub fn normalize_event(
    normalizer: &mut EventNormalizer,
    event: RawInputEvent,
) -> Option<InputEvent> {
    normalizer.normalize(event)
}

pub fn status_for_state(paused: bool, normalizer: &EventNormalizer, demo: bool) -> CaptureState {
    CaptureState {
        status: if paused {
            CaptureStatus::Paused
        } else if normalizer.is_secure_input() {
            CaptureStatus::SecureInput
        } else {
            CaptureStatus::Active
        },
        message: None,
        secure_input: normalizer.is_secure_input(),
        demo_mode: demo,
        shortcut_error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_button_falls_back_to_other_side() {
        let mut normalizer = EventNormalizer::new();
        let event = normalizer.normalize(RawInputEvent::ButtonDown {
            button: 99,
            point: None,
        });
        assert_eq!(
            event,
            Some(InputEvent::ButtonDown {
                button: PointerButton::OtherSide,
                point: None
            })
        );
    }

    #[test]
    fn key_repeat_is_ignored() {
        let mut normalizer = EventNormalizer::new();
        assert_eq!(
            normalizer.normalize(RawInputEvent::KeyDown {
                code: 0x41,
                key: Some('a'),
                modifiers: ModifierSet::default(),
                is_repeat: true,
            }),
            None
        );
    }

    #[test]
    fn duplicate_keydown_without_keyup_is_ignored() {
        let mut normalizer = EventNormalizer::new();
        let keydown = RawInputEvent::KeyDown {
            code: 0x41,
            key: Some('a'),
            modifiers: ModifierSet::default(),
            is_repeat: false,
        };
        assert!(normalizer.normalize(keydown.clone()).is_some());
        assert_eq!(normalizer.normalize(keydown), None);
    }

    #[test]
    fn keydown_after_keyup_is_counted_again() {
        let mut normalizer = EventNormalizer::new();
        let keydown = RawInputEvent::KeyDown {
            code: 0x41,
            key: Some('a'),
            modifiers: ModifierSet::default(),
            is_repeat: false,
        };
        assert!(normalizer.normalize(keydown.clone()).is_some());
        assert_eq!(
            normalizer.normalize(RawInputEvent::KeyUp { code: 0x41 }),
            None
        );
        assert!(normalizer.normalize(keydown).is_some());
    }

    #[test]
    fn secure_input_clears_held_modifiers() {
        let mut normalizer = EventNormalizer::new();
        normalizer.normalize(RawInputEvent::KeyDown {
            code: 0x11,
            key: None,
            modifiers: ModifierSet::default(),
            is_repeat: false,
        });
        normalizer.normalize(RawInputEvent::SecureInputChanged { active: true });
        assert_eq!(
            normalizer.normalize(RawInputEvent::KeyDown {
                code: 0x43,
                key: Some('c'),
                modifiers: ModifierSet::default(),
                is_repeat: false,
            }),
            None
        );
    }

    #[test]
    fn reset_after_pause_allows_next_physical_press() {
        let mut normalizer = EventNormalizer::new();
        let keydown = RawInputEvent::KeyDown {
            code: 0x41,
            key: Some('a'),
            modifiers: ModifierSet::default(),
            is_repeat: false,
        };
        assert!(normalizer.normalize(keydown.clone()).is_some());

        normalizer.reset_key_state();

        assert!(normalizer.normalize(keydown).is_some());
    }
}
