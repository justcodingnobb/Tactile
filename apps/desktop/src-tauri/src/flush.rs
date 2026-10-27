//! Moves aggregated buckets into SQLite.

use crate::runtime::{EVENT_FLUSHED, EVENT_LIVE, FaultSource, RuntimeState, lock};
use tauri::Emitter;
use trajectory_core::models::CaptureStatus;

/// Writes everything aggregated so far. On failure the buckets are kept for
/// the next attempt. Returns whether data was written.
pub fn flush(state: &RuntimeState) -> Result<bool, String> {
    let _flush = lock(&state.flush_lock);
    let (buckets, seq, pulse) = {
        let mut capture = lock(&state.capture);
        // Send what the UI has not seen yet before the counts move to storage,
        // so the confirmed sequence below covers every counted event.
        let pulse = capture.live.take();
        let mut buckets = std::mem::take(&mut capture.retry_buckets);
        buckets.extend(capture.aggregation.drain());
        (buckets, capture.live.last_seq(), pulse)
    };
    if let Some(pulse) = pulse
        && state.live_enabled.load(std::sync::atomic::Ordering::SeqCst)
    {
        let _ = state.app.emit(EVENT_LIVE, &pulse);
    }
    if buckets.is_empty() {
        lock(&state.capture).live.confirm_flushed(seq);
        return Ok(false);
    }
    let result = lock(&state.store)
        .write_buckets(&buckets)
        .map_err(|error| error.to_string());
    let mut capture = lock(&state.capture);
    match result {
        Ok(()) => {
            capture.live.confirm_flushed(seq);
            drop(capture);
            state.clear_fault(FaultSource::Storage);
            let _ = state.app.emit(EVENT_FLUSHED, seq);
            Ok(true)
        }
        Err(error) => {
            // Keep order: older retry data first, then anything aggregated
            // while the write was in flight stays in the aggregation state.
            let mut retry = buckets;
            retry.append(&mut capture.retry_buckets);
            capture.retry_buckets = retry;
            drop(capture);
            state.set_fault(
                FaultSource::Storage,
                CaptureStatus::StorageError,
                Some(error.clone()),
            );
            Err(error)
        }
    }
}

/// Discards pending data and clears every stored statistic.
pub fn clear_all(state: &RuntimeState) -> Result<(), String> {
    let _flush = lock(&state.flush_lock);
    let mut capture = lock(&state.capture);
    let result = lock(&state.store)
        .clear_range(None)
        .map_err(|error| error.to_string());
    if result.is_ok() {
        capture.aggregation.reset_metrics();
        capture.retry_buckets.clear();
        capture.live.discard_counts();
    }
    drop(capture);
    match &result {
        Ok(()) => state.clear_fault(FaultSource::Storage),
        Err(error) => state.set_fault(
            FaultSource::Storage,
            CaptureStatus::StorageError,
            Some(error.clone()),
        ),
    }
    result
}
