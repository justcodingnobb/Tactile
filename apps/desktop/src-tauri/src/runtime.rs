//! Shared application state.
//!
//! Lock order (never acquire in the opposite direction):
//! `flush_lock` → `capture` → `store`. `faults`, `status`, `settings`,
//! `shortcut_error` and `tray_pause` are leaf locks: nothing else is locked
//! while one of them is held. Status publishing only touches leaf locks and
//! atomics, so it is safe to call from anywhere.

use crate::database::Store;
use chrono::{Local, NaiveDate};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use tactile_core::aggregation::AggregationState;
use tactile_core::capture::EventNormalizer;
use tactile_core::live::LiveTracker;
use tactile_core::models::{
    AggregatedBucket, AppSettings, CaptureState, CaptureStatus, RangePreset, TimeRange,
};
use tactile_core::stats::range_for_preset;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Wry};

pub const EVENT_STATUS: &str = "capture-status-changed";
pub const EVENT_LIVE: &str = "input-live";
pub const EVENT_FLUSHED: &str = "stats-flushed";
pub const EVENT_SETTINGS: &str = "settings-changed";
/// Wheel deltas from both platforms are already normalized to line steps.
pub const WHEEL_UNIT: f64 = 1.0;
/// Upper bound for custom ranges so a typo cannot trigger a decades-long scan.
const MAX_RANGE_DAYS: i64 = 366 * 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum FaultSource {
    // Highest priority first; the first active fault is surfaced.
    Permission,
    Storage,
    Capture,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Fault {
    status: CaptureStatus,
    message: Option<String>,
}

/// Capture data shared between the worker and commands. The platform hook
/// itself is owned by the worker thread and never locked.
pub struct CaptureData {
    pub normalizer: EventNormalizer,
    pub aggregation: AggregationState,
    pub live: LiveTracker,
    pub retry_buckets: Vec<AggregatedBucket>,
}

pub struct RuntimeState {
    pub app: AppHandle,
    pub store: Mutex<Store>,
    pub capture: Mutex<CaptureData>,
    pub settings: Mutex<AppSettings>,
    pub flush_lock: Mutex<()>,
    pub paused: AtomicBool,
    pub demo_mode: AtomicBool,
    /// Dashboard visible: live pulses are only emitted while true.
    pub live_enabled: AtomicBool,
    pub secure_input: AtomicBool,
    /// Set when the app is quitting; the worker exits its loop.
    pub exiting: AtomicBool,
    /// Set if the database file could not be opened and data is kept in memory.
    pub storage_volatile: Option<String>,
    faults: Mutex<BTreeMap<FaultSource, Fault>>,
    status: Mutex<CaptureState>,
    shortcut_error: Mutex<Option<String>>,
    tray_pause: Mutex<Option<MenuItem<Wry>>>,
}

/// Recover a poisoned lock instead of propagating the poison forever. The
/// guarded data is plain counters, so continuing is always safe.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsRequest {
    pub preset: Option<RangePreset>,
    pub start: Option<NaiveDate>,
    pub end: Option<NaiveDate>,
}

impl RuntimeState {
    pub fn new(
        app: AppHandle,
        store: Store,
        storage_volatile: Option<String>,
        screen: (f64, f64),
    ) -> Self {
        let settings = store.settings().unwrap_or_default();
        Self {
            app,
            store: Mutex::new(store),
            capture: Mutex::new(CaptureData {
                normalizer: EventNormalizer::new(),
                aggregation: AggregationState::new(screen.0, screen.1, WHEEL_UNIT),
                live: LiveTracker::new(),
                retry_buckets: Vec::new(),
            }),
            settings: Mutex::new(settings),
            flush_lock: Mutex::new(()),
            paused: AtomicBool::new(false),
            demo_mode: AtomicBool::new(false),
            live_enabled: AtomicBool::new(false),
            secure_input: AtomicBool::new(false),
            exiting: AtomicBool::new(false),
            storage_volatile,
            faults: Mutex::new(BTreeMap::new()),
            status: Mutex::new(CaptureState {
                status: CaptureStatus::Active,
                message: None,
                secure_input: false,
                demo_mode: false,
                shortcut_error: None,
            }),
            shortcut_error: Mutex::new(None),
            tray_pause: Mutex::new(None),
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    pub fn is_demo(&self) -> bool {
        self.demo_mode.load(Ordering::SeqCst)
    }

    pub fn current_status(&self) -> CaptureState {
        lock(&self.status).clone()
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::SeqCst);
        self.publish_status();
    }

    pub fn toggle_pause(&self) {
        self.set_paused(!self.is_paused());
    }

    pub fn set_demo(&self, enabled: bool) {
        self.demo_mode.store(enabled, Ordering::SeqCst);
        self.publish_status();
    }

    pub fn set_secure_input(&self, active: bool) {
        if self.secure_input.swap(active, Ordering::SeqCst) != active {
            self.publish_status();
        }
    }

    pub fn set_fault(&self, source: FaultSource, status: CaptureStatus, message: Option<String>) {
        let next = Fault { status, message };
        let changed = lock(&self.faults).insert(source, next.clone()) != Some(next);
        if changed {
            self.publish_status();
        }
    }

    pub fn clear_fault(&self, source: FaultSource) {
        if lock(&self.faults).remove(&source).is_some() {
            self.publish_status();
        }
    }

    pub fn set_shortcut_error(&self, error: Option<String>) {
        let changed = {
            let mut current = lock(&self.shortcut_error);
            let changed = *current != error;
            *current = error;
            changed
        };
        if changed {
            self.publish_status();
        }
    }

    /// Stops the worker and writes pending aggregates exactly once.
    pub fn finalize(&self) {
        if self.exiting.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Err(error) = crate::flush::flush(self) {
            use std::io::Write;
            let _ = writeln!(std::io::stderr(), "tactile: final flush failed: {error}");
        }
    }

    pub fn attach_tray_pause(&self, item: MenuItem<Wry>) {
        *lock(&self.tray_pause) = Some(item);
    }

    /// Recomputes the visible status from flags and faults and emits it if it
    /// changed. Touches only leaf locks.
    pub fn publish_status(&self) {
        let next = self.compute_status();
        let changed = {
            let mut current = lock(&self.status);
            let changed = *current != next;
            *current = next.clone();
            changed
        };
        if changed {
            let _ = self.app.emit(EVENT_STATUS, &next);
            self.sync_tray(next.status == CaptureStatus::Paused);
        }
    }

    fn compute_status(&self) -> CaptureState {
        let paused = self.is_paused();
        let demo = self.is_demo();
        let secure = self.secure_input.load(Ordering::SeqCst);
        let mut state = CaptureState {
            status: if paused {
                CaptureStatus::Paused
            } else if secure {
                CaptureStatus::SecureInput
            } else {
                CaptureStatus::Active
            },
            message: demo.then(|| "demo".to_string()),
            secure_input: secure,
            demo_mode: demo,
            shortcut_error: lock(&self.shortcut_error).clone(),
        };
        // A paused or demo session has no live hook to fail, but permission
        // and storage problems are still worth surfacing.
        let fault = lock(&self.faults)
            .iter()
            .find(|(source, _)| !(paused || demo) || **source != FaultSource::Capture)
            .map(|(_, fault)| fault.clone());
        if let Some(fault) = fault {
            state.status = fault.status;
            state.message = fault.message;
        } else if let Some(reason) = &self.storage_volatile {
            state.status = CaptureStatus::StorageError;
            state.message = Some(reason.clone());
        }
        state
    }

    fn sync_tray(&self, paused: bool) {
        let Some(item) = lock(&self.tray_pause).clone() else {
            return;
        };
        let label = if paused {
            "Resume capture"
        } else {
            "Pause capture"
        };
        // `set_text` blocks until the main thread runs it. Callers may hold the
        // capture lock while the main thread waits on it inside a command, so
        // queue the update instead of waiting for it.
        let _ = self.app.run_on_main_thread(move || {
            let _ = item.set_text(label);
        });
    }

    pub fn effective_range(&self, request: &StatsRequest) -> TimeRange {
        let today = Local::now().date_naive();
        match (request.start, request.end) {
            (Some(start), Some(end)) => clamp_range(start, end, today),
            _ => range_for_preset(request.preset.unwrap_or(RangePreset::Week), today),
        }
    }
}

/// Orders the bounds, keeps the end at or before today and caps the length.
pub fn clamp_range(start: NaiveDate, end: NaiveDate, today: NaiveDate) -> TimeRange {
    let (start, end) = if start <= end {
        (start, end)
    } else {
        (end, start)
    };
    let end = end.min(today);
    let start = start.min(end);
    let earliest = end - chrono::Duration::days(MAX_RANGE_DAYS - 1);
    TimeRange {
        start_local_day: start.max(earliest),
        end_local_day: end,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, month, day).unwrap()
    }

    #[test]
    fn reversed_range_is_reordered() {
        let range = clamp_range(day(10, 20), day(10, 10), day(10, 27));
        assert_eq!(range.start_local_day, day(10, 10));
        assert_eq!(range.end_local_day, day(10, 20));
    }

    #[test]
    fn future_end_is_clamped_to_today() {
        let range = clamp_range(day(10, 30), day(11, 30), day(10, 27));
        assert_eq!(range.start_local_day, day(10, 27));
        assert_eq!(range.end_local_day, day(10, 27));
    }

    #[test]
    fn overly_long_range_is_capped() {
        let start = NaiveDate::from_ymd_opt(1990, 1, 1).unwrap();
        let range = clamp_range(start, day(10, 27), day(10, 27));
        let days = (range.end_local_day - range.start_local_day).num_days() + 1;
        assert_eq!(days, MAX_RANGE_DAYS);
    }

    #[test]
    fn poisoned_lock_is_recovered() {
        let mutex = std::sync::Arc::new(Mutex::new(1));
        let clone = mutex.clone();
        let _ = std::thread::spawn(move || {
            let _guard = clone.lock().unwrap();
            panic!("poison");
        })
        .join();
        assert_eq!(*lock(&mutex), 1);
    }
}
