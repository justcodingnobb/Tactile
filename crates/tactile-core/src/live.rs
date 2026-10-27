//! Collects real-time deltas between dashboard refreshes.
//!
//! The tracker mirrors what [`crate::aggregation::AggregationState`] ingests so
//! the UI can animate and count input without re-querying the database. When
//! buckets are flushed to storage, [`LiveTracker::confirm_flushed`] records the
//! last pulse already contained in the stored data so the UI never counts an
//! event twice.
//!
//! Flush protocol: under one lock, call [`LiveTracker::take`] (and send the
//! pulse), drain the aggregation buckets and read [`LiveTracker::last_seq`];
//! after the write succeeds, pass that sequence to `confirm_flushed`.

use crate::keys::key_id_string;
use crate::models::{ButtonCount, InputEvent, KeyCount, LivePulse, RawInputEvent};
use chrono::NaiveDate;

#[derive(Debug, Default)]
pub struct LiveTracker {
    pending: LivePulse,
    last_seq: u64,
    flushed_seq: u64,
}

impl LiveTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records the physical key transition for animation. Call before
    /// normalization and skip while secure input is active.
    pub fn observe_raw(&mut self, raw: &RawInputEvent) {
        match raw {
            RawInputEvent::KeyDown {
                code,
                is_repeat: false,
                ..
            } => push_unique(&mut self.pending.down, key_id_string(*code)),
            RawInputEvent::KeyUp { code } => {
                push_unique(&mut self.pending.up, key_id_string(*code));
            }
            _ => {}
        }
    }

    /// Records an event that was ingested into aggregation.
    pub fn observe_counted(
        &mut self,
        event: &InputEvent,
        date: NaiveDate,
        click_cell: Option<usize>,
        wheel_unit: f64,
    ) {
        if self.pending.date != Some(date) {
            // Day rollover: counts for the previous day must not leak into today.
            self.pending.clear_counts();
            self.pending.date = Some(date);
        }
        let pulse = &mut self.pending;
        match event {
            InputEvent::KeyPress { key, shortcut, .. } => {
                match pulse
                    .presses
                    .iter_mut()
                    .find(|entry| entry.key_id == key.id)
                {
                    Some(entry) => entry.count += 1,
                    None => pulse.presses.push(KeyCount {
                        key_id: key.id.clone(),
                        label: key.label.clone(),
                        count: 1,
                    }),
                }
                if *shortcut {
                    pulse.shortcut_presses += 1;
                }
            }
            InputEvent::PointerMove { dx_dip, dy_dip } => {
                let distance = dx_dip.hypot(*dy_dip);
                if distance.is_finite() {
                    pulse.distance_px += distance;
                }
            }
            InputEvent::ButtonDown { button, .. } => {
                match pulse
                    .buttons
                    .iter_mut()
                    .find(|entry| entry.button == *button)
                {
                    Some(entry) => entry.count += 1,
                    None => pulse.buttons.push(ButtonCount {
                        button: *button,
                        count: 1,
                    }),
                }
                pulse.click_cells.extend(click_cell);
            }
            InputEvent::Wheel { delta_y } => {
                let steps = delta_y.abs() / wheel_unit.max(f64::EPSILON);
                if *delta_y > 0.0 {
                    pulse.wheel_up += steps;
                } else {
                    pulse.wheel_down += steps;
                }
            }
            InputEvent::SecureInputChanged { .. } => {}
        }
    }

    /// Returns the accumulated pulse, if any, and starts a new one.
    pub fn take(&mut self) -> Option<LivePulse> {
        if self.pending.is_empty() {
            return None;
        }
        self.last_seq += 1;
        let date = self.pending.date;
        let mut pulse = std::mem::take(&mut self.pending);
        pulse.seq = self.last_seq;
        self.pending.date = date;
        Some(pulse)
    }

    pub fn last_seq(&self) -> u64 {
        self.last_seq
    }

    /// Pulses up to `seq` are now part of stored statistics.
    pub fn confirm_flushed(&mut self, seq: u64) {
        self.flushed_seq = self.flushed_seq.max(seq.min(self.last_seq));
    }

    pub fn flushed_seq(&self) -> u64 {
        self.flushed_seq
    }

    /// Forgets unsent counts, e.g. after statistics were cleared.
    pub fn discard_counts(&mut self) {
        self.pending.clear_counts();
        self.flushed_seq = self.last_seq;
    }
}

fn push_unique(list: &mut Vec<String>, id: String) {
    if !list.contains(&id) {
        list.push(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{KeyIdentity, ModifierSet, PointerButton};

    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 27).unwrap()
    }

    fn press(id: &str) -> InputEvent {
        InputEvent::KeyPress {
            key: KeyIdentity {
                id: id.into(),
                label: id.to_uppercase(),
                is_modifier: false,
            },
            modifiers: ModifierSet::default(),
            shortcut: false,
        }
    }

    #[test]
    fn empty_tracker_emits_nothing() {
        assert!(LiveTracker::new().take().is_none());
    }

    #[test]
    fn counts_accumulate_per_key_and_sequence_advances() {
        let mut tracker = LiveTracker::new();
        tracker.observe_counted(&press("a"), day(), None, 1.0);
        tracker.observe_counted(&press("a"), day(), None, 1.0);
        let first = tracker.take().unwrap();
        assert_eq!(first.seq, 1);
        assert_eq!(first.presses[0].count, 2);
        tracker.observe_counted(&press("b"), day(), None, 1.0);
        assert_eq!(tracker.take().unwrap().seq, 2);
    }

    #[test]
    fn confirmed_sequence_never_moves_backwards() {
        let mut tracker = LiveTracker::new();
        tracker.observe_raw(&RawInputEvent::KeyDown {
            code: 0x41,
            key: Some('a'),
            modifiers: ModifierSet::default(),
            is_repeat: false,
        });
        tracker.observe_counted(&press("a"), day(), None, 1.0);
        let pulse = tracker.take().unwrap();
        assert_eq!(pulse.down, vec!["a".to_string()]);
        tracker.confirm_flushed(tracker.last_seq());
        assert_eq!(tracker.flushed_seq(), 1);
        tracker.confirm_flushed(0);
        assert_eq!(tracker.flushed_seq(), 1);
        tracker.confirm_flushed(99);
        assert_eq!(tracker.flushed_seq(), 1);
    }

    #[test]
    fn discard_ignores_already_sent_pulses() {
        let mut tracker = LiveTracker::new();
        tracker.observe_counted(&press("a"), day(), None, 1.0);
        tracker.take();
        tracker.observe_counted(&press("a"), day(), None, 1.0);
        tracker.discard_counts();
        assert_eq!(tracker.flushed_seq(), 1);
        assert!(tracker.take().is_none());
    }

    #[test]
    fn day_rollover_drops_previous_day_counts() {
        let mut tracker = LiveTracker::new();
        tracker.observe_counted(&press("a"), day(), None, 1.0);
        let next = day().succ_opt().unwrap();
        tracker.observe_counted(&press("b"), next, None, 1.0);
        let pulse = tracker.take().unwrap();
        assert_eq!(pulse.date, Some(next));
        assert_eq!(pulse.presses.len(), 1);
        assert_eq!(pulse.presses[0].key_id, "b");
    }

    #[test]
    fn modifier_down_is_reported_for_animation() {
        let mut tracker = LiveTracker::new();
        tracker.observe_raw(&RawInputEvent::KeyDown {
            code: 0x10,
            key: None,
            modifiers: ModifierSet::default(),
            is_repeat: false,
        });
        let pulse = tracker.take().unwrap();
        assert_eq!(pulse.down, vec!["shift".to_string()]);
        assert!(!pulse.has_counts());
    }

    #[test]
    fn clicks_record_button_and_cell() {
        let mut tracker = LiveTracker::new();
        let click = InputEvent::ButtonDown {
            button: PointerButton::Left,
            point: None,
        };
        tracker.observe_counted(&click, day(), Some(7), 1.0);
        let pulse = tracker.take().unwrap();
        assert_eq!(pulse.buttons[0].count, 1);
        assert_eq!(pulse.click_cells, vec![7]);
    }
}
