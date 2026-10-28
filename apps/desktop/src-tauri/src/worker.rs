//! The capture worker: owns the OS hook, feeds aggregation, emits live pulses
//! and flushes to storage. A panic inside one tick restarts the loop instead
//! of silently ending capture.

use crate::flush::flush;
use crate::runtime::{EVENT_LIVE, FaultSource, RuntimeState, lock};
use chrono::{Local, Utc};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant};
use tactile_core::capture::CaptureSource;
use tactile_core::models::{CaptureStatus, RawInputEvent};
use tactile_platform::secure_input::is_secure_input_enabled;
use tactile_platform::{PlatformCapture, main_display_size, permission_granted};
use tauri::{AppHandle, Emitter, Manager};

const POLL_TIMEOUT: Duration = Duration::from_millis(25);
const IDLE_SLEEP: Duration = Duration::from_millis(100);
const LIVE_INTERVAL: Duration = Duration::from_millis(40);
const FLUSH_INTERVAL: Duration = Duration::from_secs(5);
const PERMISSION_INTERVAL: Duration = Duration::from_secs(2);
const SCREEN_INTERVAL: Duration = Duration::from_secs(10);
const RETENTION_INTERVAL: Duration = Duration::from_secs(60 * 60);
const RETRY_BASE: Duration = Duration::from_secs(2);
const RETRY_MAX: Duration = Duration::from_secs(60);
const PANIC_BACKOFF: Duration = Duration::from_secs(1);
const MINUTE_RETENTION_HOURS: i64 = 48;
const HOUR_RETENTION_DAYS: i64 = 90;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PermissionTransition {
    NoChange,
    Granted,
    Revoked,
}

fn permission_transition(previous: Option<bool>, granted: bool) -> PermissionTransition {
    match (previous, granted) {
        (Some(previous), granted) if previous == granted => PermissionTransition::NoChange,
        (_, true) => PermissionTransition::Granted,
        (_, false) => PermissionTransition::Revoked,
    }
}

pub fn spawn(app: AppHandle) {
    let spawned = thread::Builder::new()
        .name("tactile-worker".into())
        .spawn(move || supervise(app.clone()));
    if let Err(error) = spawned {
        eprintln!("tactile: capture worker could not start: {error}");
    }
}

fn supervise(app: AppHandle) {
    loop {
        let mut worker = Worker::new();
        let outcome = catch_unwind(AssertUnwindSafe(|| worker.run(&app)));
        let _ = worker.source.stop();
        let state = app.state::<RuntimeState>();
        match outcome {
            Ok(()) => return,
            Err(_) => {
                state.set_fault(
                    FaultSource::Capture,
                    CaptureStatus::HookError,
                    Some("capture restarted after an internal error".into()),
                );
                thread::sleep(PANIC_BACKOFF);
            }
        }
    }
}

struct Worker {
    source: PlatformCapture,
    gated: bool,
    permitted: Option<bool>,
    failures: u32,
    next_start: Instant,
    last_permission: Option<Instant>,
    last_live: Instant,
    last_flush: Instant,
    flush_failures: u32,
    last_screen: Instant,
    last_retention: Option<Instant>,
}

impl Worker {
    fn new() -> Self {
        let now = Instant::now();
        Self {
            source: PlatformCapture::new(),
            gated: false,
            permitted: None,
            failures: 0,
            next_start: now,
            last_permission: None,
            last_live: now,
            last_flush: now,
            flush_failures: 0,
            last_screen: now,
            last_retention: None,
        }
    }

    fn run(&mut self, app: &AppHandle) {
        let state = app.state::<RuntimeState>();
        while !state.exiting.load(Ordering::SeqCst) {
            self.refresh_permission(&state);
            self.sync_secure_input(&state);
            let gated = state.is_paused() || state.is_demo();
            self.sync_gate(&state, gated);
            self.ensure_running(&state, gated);
            if self.source.is_running() && !gated {
                self.pump(&state);
            } else {
                thread::sleep(IDLE_SLEEP);
            }
            self.emit_live(&state);
            self.maintain(&state);
        }
    }

    fn refresh_permission(&mut self, state: &RuntimeState) {
        if self
            .last_permission
            .is_some_and(|last| last.elapsed() < PERMISSION_INTERVAL)
        {
            return;
        }
        self.last_permission = Some(Instant::now());
        let granted = permission_granted();
        let transition = permission_transition(self.permitted, granted);
        self.permitted = Some(granted);
        match transition {
            PermissionTransition::Granted => {
                state.clear_fault(FaultSource::Permission);
                // Permission just arrived; try the hook right away.
                self.next_start = Instant::now();
                self.failures = 0;
            }
            PermissionTransition::Revoked => {
                let _ = self.source.stop();
                state.set_fault(
                    FaultSource::Permission,
                    CaptureStatus::PermissionRequired,
                    None,
                );
            }
            PermissionTransition::NoChange => {}
        }
    }

    fn sync_secure_input(&mut self, state: &RuntimeState) {
        let secure = is_secure_input_enabled();
        if state.secure_input.load(Ordering::SeqCst) == secure {
            return;
        }
        {
            let mut capture = lock(&state.capture);
            capture.normalizer.set_secure_input(secure);
        }
        state.set_secure_input(secure);
    }

    fn sync_gate(&mut self, state: &RuntimeState, gated: bool) {
        if gated == self.gated {
            return;
        }
        self.gated = gated;
        let _ = self.source.set_paused(gated);
        if !gated {
            // Keys released and pointer moves during the pause were not seen.
            let mut capture = lock(&state.capture);
            capture.normalizer.reset_key_state();
            capture.aggregation.reset_position();
        }
    }

    fn ensure_running(&mut self, state: &RuntimeState, gated: bool) {
        if self.source.is_running()
            || self.permitted != Some(true)
            || Instant::now() < self.next_start
        {
            return;
        }
        match self.source.start() {
            Ok(()) => {
                let _ = self.source.set_paused(gated);
                self.failures = 0;
                state.clear_fault(FaultSource::Capture);
            }
            Err(error) => {
                self.failures = self.failures.saturating_add(1);
                self.next_start = Instant::now() + backoff(self.failures);
                state.set_fault(
                    FaultSource::Capture,
                    CaptureStatus::HookError,
                    Some(error.to_string()),
                );
            }
        }
    }

    fn pump(&mut self, state: &RuntimeState) {
        let events = match self.source.poll(POLL_TIMEOUT) {
            Ok(events) => events,
            Err(error) => {
                self.fail_source(state, error.to_string());
                return;
            }
        };
        if events.is_empty() {
            return;
        }
        let now = Utc::now();
        let date = now.with_timezone(&Local).date_naive();
        let mut hook_error = None;
        {
            let mut guard = lock(&state.capture);
            let capture = &mut *guard;
            for raw in events {
                if let RawInputEvent::HookError { message } = raw {
                    hook_error = Some(message);
                    continue;
                }
                if !capture.normalizer.is_secure_input() {
                    capture.live.observe_raw(&raw);
                }
                let click_point = match &raw {
                    RawInputEvent::ButtonDown { point, .. } => *point,
                    _ => None,
                };
                let Some(event) = capture.normalizer.normalize(raw) else {
                    continue;
                };
                let cell = capture.aggregation.heatmap_cell(click_point);
                let wheel_unit = capture.aggregation.wheel_unit();
                capture.live.observe_counted(&event, date, cell, wheel_unit);
                capture.aggregation.ingest(event, now);
            }
        }
        if let Some(message) = hook_error {
            self.fail_source(state, message);
        }
    }

    fn fail_source(&mut self, state: &RuntimeState, message: String) {
        let _ = self.source.stop();
        self.failures = self.failures.saturating_add(1);
        self.next_start = Instant::now() + backoff(self.failures);
        state.set_fault(
            FaultSource::Capture,
            CaptureStatus::HookError,
            Some(message),
        );
    }

    fn emit_live(&mut self, state: &RuntimeState) {
        if self.last_live.elapsed() < LIVE_INTERVAL {
            return;
        }
        self.last_live = Instant::now();
        if !state.live_enabled.load(Ordering::SeqCst) {
            return;
        }
        let pulse = lock(&state.capture).live.take();
        if let Some(pulse) = pulse {
            let _ = state.app.emit(EVENT_LIVE, &pulse);
        }
    }

    fn maintain(&mut self, state: &RuntimeState) {
        if self.last_screen.elapsed() >= SCREEN_INTERVAL {
            self.last_screen = Instant::now();
            let (width, height) = main_display_size();
            lock(&state.capture)
                .aggregation
                .set_screen_size(width, height);
        }
        let flush_due = FLUSH_INTERVAL.saturating_mul(1 << self.flush_failures.min(4));
        if self.last_flush.elapsed() >= flush_due.min(RETRY_MAX) {
            self.last_flush = Instant::now();
            match flush(state) {
                Ok(_) => self.flush_failures = 0,
                Err(_) => self.flush_failures = self.flush_failures.saturating_add(1),
            }
        }
        if self
            .last_retention
            .is_none_or(|last| last.elapsed() >= RETENTION_INTERVAL)
        {
            self.last_retention = Some(Instant::now());
            let now = Utc::now();
            let mut store = lock(&state.store);
            let _ =
                store.purge_minute_buckets(now - chrono::Duration::hours(MINUTE_RETENTION_HOURS));
            let _ = store.purge_hour_buckets(now - chrono::Duration::days(HOUR_RETENTION_DAYS));
        }
    }
}

fn backoff(failures: u32) -> Duration {
    RETRY_BASE
        .saturating_mul(1 << failures.saturating_sub(1).min(5))
        .min(RETRY_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_denied_permission_check_revokes() {
        assert_eq!(
            permission_transition(None, false),
            PermissionTransition::Revoked
        );
    }

    #[test]
    fn first_granted_permission_check_grants() {
        assert_eq!(
            permission_transition(None, true),
            PermissionTransition::Granted
        );
    }

    #[test]
    fn permission_revocation_is_detected() {
        assert_eq!(
            permission_transition(Some(true), false),
            PermissionTransition::Revoked
        );
    }

    #[test]
    fn permission_grant_is_detected() {
        assert_eq!(
            permission_transition(Some(false), true),
            PermissionTransition::Granted
        );
    }

    #[test]
    fn unchanged_permission_is_no_change() {
        assert_eq!(
            permission_transition(Some(true), true),
            PermissionTransition::NoChange
        );
        assert_eq!(
            permission_transition(Some(false), false),
            PermissionTransition::NoChange
        );
    }

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff(1), RETRY_BASE);
        assert_eq!(backoff(2), RETRY_BASE * 2);
        assert_eq!(backoff(50), RETRY_MAX);
    }
}
