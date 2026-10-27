use crate::models::{AggregatedBucket, BucketMetrics, InputEvent, Point, PointerButton, TimeRange};
use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Timelike, Utc};

pub const HEATMAP_COLUMNS: usize = 24;
pub const HEATMAP_ROWS: usize = 16;
pub const WHEEL_UNIT: f64 = 120.0;
pub const MAC_WHEEL_UNIT: f64 = 1.0;

#[derive(Clone, Debug)]
struct WorkingBucket {
    start_utc: DateTime<Utc>,
    local_date: NaiveDate,
    local_hour: u8,
    metrics: BucketMetrics,
    wheel_up_remainder: f64,
    wheel_down_remainder: f64,
    seen_active_second: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct AggregationState {
    current: Option<WorkingBucket>,
    last_position: Option<Point>,
    screen: (f64, f64),
    wheel_unit: f64,
    pending: Vec<AggregatedBucket>,
}

impl AggregationState {
    pub fn new(screen_width: f64, screen_height: f64, wheel_unit: f64) -> Self {
        Self {
            current: None,
            last_position: None,
            screen: (screen_width.max(1.0), screen_height.max(1.0)),
            wheel_unit: if wheel_unit <= 0.0 { 1.0 } else { wheel_unit },
            pending: Vec::new(),
        }
    }

    pub fn ingest(&mut self, event: InputEvent, at: DateTime<Utc>) {
        match event {
            InputEvent::PointerMove { dx_dip, dy_dip } => {
                let distance = (dx_dip * dx_dip + dy_dip * dy_dip).sqrt();
                if distance.is_finite() {
                    let bucket = self.bucket_for(at);
                    bucket.metrics.distance_px += distance;
                }
                if let Some(last) = self.last_position.as_mut() {
                    last.x += dx_dip;
                    last.y += dy_dip;
                } else {
                    self.last_position = Some(Point {
                        x: dx_dip,
                        y: dy_dip,
                    });
                }
                self.mark_active(at);
            }
            InputEvent::ButtonDown { button, point } => {
                let screen = self.screen;
                let bucket = self.bucket_for(at);
                match button {
                    PointerButton::Left => bucket.metrics.left_clicks += 1,
                    PointerButton::Right => bucket.metrics.right_clicks += 1,
                    PointerButton::Middle => bucket.metrics.middle_clicks += 1,
                    PointerButton::Side1 => bucket.metrics.side1_clicks += 1,
                    PointerButton::Side2 => bucket.metrics.side2_clicks += 1,
                    PointerButton::OtherSide => bucket.metrics.other_clicks += 1,
                }
                if let Some(point) = point
                    && let Some(index) = heatmap_index(point, screen)
                {
                    if bucket.metrics.click_cells.is_empty() {
                        bucket.metrics.click_cells = vec![0; HEATMAP_COLUMNS * HEATMAP_ROWS];
                    }
                    bucket.metrics.click_cells[index] += 1;
                }
                self.mark_active(at);
            }
            InputEvent::Wheel { delta_y } => {
                let wheel_unit = self.wheel_unit;
                let bucket = self.bucket_for(at);
                if delta_y > 0.0 {
                    let total = bucket.wheel_up_remainder + delta_y / wheel_unit;
                    let whole = total.floor();
                    bucket.wheel_up_remainder = total - whole;
                    bucket.metrics.wheel_up += whole;
                } else if delta_y < 0.0 {
                    let total = bucket.wheel_down_remainder + (-delta_y / wheel_unit);
                    let whole = total.floor();
                    bucket.wheel_down_remainder = total - whole;
                    bucket.metrics.wheel_down += whole;
                }
                self.mark_active(at);
            }
            InputEvent::KeyPress { key, shortcut, .. } => {
                let bucket = self.bucket_for(at);
                bucket.metrics.key_presses += 1;
                if shortcut {
                    bucket.metrics.shortcut_presses += 1;
                }
                if let Some(entry) = bucket.metrics.keys.iter_mut().find(|(id, _)| id == &key.id) {
                    entry.1 += 1;
                } else {
                    bucket.metrics.keys.push((key.id, 1));
                }
                self.mark_active(at);
            }
            InputEvent::SecureInputChanged { .. } => {}
        }
    }

    pub fn reset_position(&mut self) {
        self.last_position = None;
    }

    pub fn reset_metrics(&mut self) {
        self.current = None;
        self.pending.clear();
    }

    pub fn set_screen_size(&mut self, screen_width: f64, screen_height: f64) {
        let screen = (screen_width.max(1.0), screen_height.max(1.0));
        if screen != self.screen {
            self.screen = screen;
            self.last_position = None;
        }
    }

    /// Heatmap cell a click at `point` lands in, using the current screen size.
    pub fn heatmap_cell(&self, point: Option<Point>) -> Option<usize> {
        point.and_then(|point| heatmap_index(point, self.screen))
    }

    pub fn wheel_unit(&self) -> f64 {
        self.wheel_unit
    }

    pub fn take_pending(&mut self) -> Vec<AggregatedBucket> {
        std::mem::take(&mut self.pending)
    }

    pub fn drain(&mut self) -> Vec<AggregatedBucket> {
        self.flush_current();
        std::mem::take(&mut self.pending)
    }

    pub fn flush_current(&mut self) {
        if let Some(current) = self.current.take() {
            self.pending.push(AggregatedBucket {
                start_utc: current.start_utc,
                local_date: current.local_date,
                local_hour: current.local_hour,
                granularity: crate::models::Granularity::Minute,
                metrics: current.metrics,
            });
        }
    }

    fn mark_active(&mut self, at: DateTime<Utc>) {
        let second = at.timestamp();
        let bucket = self.bucket_for(at);
        if bucket.seen_active_second != Some(second) {
            bucket.seen_active_second = Some(second);
            bucket.metrics.active_seconds += 1;
        }
    }

    fn bucket_for(&mut self, at: DateTime<Utc>) -> &mut WorkingBucket {
        let local = at.with_timezone(&Local);
        let date = local.date_naive();
        let hour = local.hour() as u8;
        let minute_start = local
            .with_second(0)
            .and_then(|value| value.with_nanosecond(0))
            .unwrap_or(local);
        let start_utc = minute_start.with_timezone(&Utc);
        let needs_new = self
            .current
            .as_ref()
            .map(|bucket| bucket.start_utc != start_utc)
            .unwrap_or(true);
        if needs_new {
            self.flush_current();
            self.current = Some(WorkingBucket {
                start_utc,
                local_date: date,
                local_hour: hour,
                metrics: BucketMetrics::default(),
                wheel_up_remainder: 0.0,
                wheel_down_remainder: 0.0,
                seen_active_second: None,
            });
        }
        self.current.as_mut().expect("bucket initialized")
    }
}

pub fn flush_bucket(state: &mut AggregationState) -> Vec<AggregatedBucket> {
    state.drain()
}

pub fn heatmap_index(point: Point, screen: (f64, f64)) -> Option<usize> {
    if !point.x.is_finite() || !point.y.is_finite() {
        return None;
    }
    if point.x < 0.0 || point.y < 0.0 || point.x >= screen.0 || point.y >= screen.1 {
        return None;
    }
    let column = ((point.x / screen.0) * HEATMAP_COLUMNS as f64).floor() as usize;
    let row = ((point.y / screen.1) * HEATMAP_ROWS as f64).floor() as usize;
    if column >= HEATMAP_COLUMNS || row >= HEATMAP_ROWS {
        return None;
    }
    Some(row * HEATMAP_COLUMNS + column)
}

pub fn bucket_start_for_range(range: &TimeRange) -> DateTime<Utc> {
    let local = Local
        .from_local_datetime(
            &range
                .start_local_day
                .and_hms_opt(0, 0, 0)
                .expect("valid midnight"),
        )
        .earliest()
        .unwrap_or_else(Local::now);
    local.with_timezone(&Utc)
}

pub fn previous_range(range: &TimeRange) -> TimeRange {
    let length = (range.end_local_day - range.start_local_day).num_days() + 1;
    let end = range
        .start_local_day
        .pred_opt()
        .unwrap_or(range.start_local_day);
    let start = end
        .checked_sub_signed(chrono::Duration::days(length - 1))
        .unwrap_or(end);
    TimeRange {
        start_local_day: start,
        end_local_day: end,
    }
}

pub fn local_day(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).expect("valid date")
}

pub fn is_date_in_range(date: NaiveDate, range: &TimeRange) -> bool {
    date >= range.start_local_day && date <= range.end_local_day
}

pub fn today_local() -> NaiveDate {
    Local::now().date_naive()
}

pub fn week_start(date: NaiveDate) -> NaiveDate {
    date - chrono::Duration::days(date.weekday().num_days_from_monday() as i64)
}

pub fn month_start(date: NaiveDate) -> NaiveDate {
    NaiveDate::from_ymd_opt(date.year(), date.month(), 1).expect("valid month")
}

pub fn year_start(date: NaiveDate) -> NaiveDate {
    NaiveDate::from_ymd_opt(date.year(), 1, 1).expect("valid year")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::KeyIdentity;
    use chrono::TimeZone;

    fn utc(hour: u32, minute: u32, second: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 20, hour, minute, second)
            .unwrap()
    }

    #[test]
    fn movement_distance_uses_euclidean_length() {
        let mut state = AggregationState::new(1920.0, 1080.0, WHEEL_UNIT);
        state.ingest(
            InputEvent::PointerMove {
                dx_dip: 3.0,
                dy_dip: 4.0,
            },
            utc(8, 0, 0),
        );
        let bucket = state.drain().pop().unwrap();
        assert!((bucket.metrics.distance_px - 5.0).abs() < f64::EPSILON);
    }

    #[test]
    fn wheel_directions_keep_independent_remainders() {
        let mut state = AggregationState::new(1920.0, 1080.0, 120.0);
        state.ingest(InputEvent::Wheel { delta_y: 60.0 }, utc(8, 0, 0));
        state.ingest(InputEvent::Wheel { delta_y: 60.0 }, utc(8, 0, 0));
        state.ingest(InputEvent::Wheel { delta_y: -60.0 }, utc(8, 0, 0));
        let bucket = state.drain().pop().unwrap();
        assert_eq!(bucket.metrics.wheel_up, 1.0);
        assert_eq!(bucket.metrics.wheel_down, 0.0);
    }

    #[test]
    fn normalized_wheel_step_counts_once() {
        let mut state = AggregationState::new(1920.0, 1080.0, MAC_WHEEL_UNIT);
        state.ingest(InputEvent::Wheel { delta_y: 1.0 }, utc(8, 0, 0));
        let bucket = state.drain().pop().unwrap();
        assert_eq!(bucket.metrics.wheel_up, 1.0);
    }

    #[test]
    fn one_active_second_counts_once_per_bucket_date() {
        let mut state = AggregationState::new(1920.0, 1080.0, 120.0);
        for second in [1, 1, 2] {
            state.ingest(InputEvent::Wheel { delta_y: 120.0 }, utc(8, 0, second));
        }
        let bucket = state.drain().pop().unwrap();
        assert_eq!(bucket.metrics.active_seconds, 2);
    }

    #[test]
    fn clicks_outside_main_screen_still_count() {
        let mut state = AggregationState::new(100.0, 100.0, 120.0);
        state.ingest(
            InputEvent::ButtonDown {
                button: PointerButton::Left,
                point: Some(Point { x: 120.0, y: 20.0 }),
            },
            utc(8, 0, 0),
        );
        let bucket = state.drain().pop().unwrap();
        assert_eq!(bucket.metrics.left_clicks, 1);
        assert!(bucket.metrics.click_cells.is_empty());
    }

    #[test]
    fn heatmap_edge_is_clamped_to_last_cell() {
        assert_eq!(
            heatmap_index(
                Point {
                    x: 99.999,
                    y: 99.999
                },
                (100.0, 100.0)
            ),
            Some(HEATMAP_COLUMNS * HEATMAP_ROWS - 1)
        );
        assert_eq!(
            heatmap_index(Point { x: 100.0, y: 99.0 }, (100.0, 100.0)),
            None
        );
    }

    #[test]
    fn key_count_accumulates_in_same_minute() {
        let mut state = AggregationState::new(100.0, 100.0, 120.0);
        for _ in 0..3 {
            state.ingest(
                InputEvent::KeyPress {
                    key: KeyIdentity {
                        id: "a".into(),
                        label: "A".into(),
                        is_modifier: false,
                    },
                    modifiers: Default::default(),
                    shortcut: false,
                },
                utc(8, 0, 12),
            );
        }
        let bucket = state.drain().pop().unwrap();
        assert_eq!(bucket.metrics.key_presses, 3);
        assert_eq!(bucket.metrics.keys[0].1, 3);
    }

    #[test]
    fn changing_screen_size_keeps_pending_metrics() {
        let mut state = AggregationState::new(100.0, 100.0, 120.0);
        state.ingest(
            InputEvent::ButtonDown {
                button: PointerButton::Left,
                point: Some(Point { x: 20.0, y: 20.0 }),
            },
            utc(8, 0, 0),
        );
        state.set_screen_size(200.0, 200.0);
        let bucket = state.drain().pop().unwrap();
        assert_eq!(bucket.metrics.left_clicks, 1);
        assert_eq!(bucket.metrics.click_cells.iter().sum::<u64>(), 1);
    }

    #[test]
    fn reset_metrics_discards_pending_and_current_buckets() {
        let mut state = AggregationState::new(100.0, 100.0, 120.0);
        state.ingest(
            InputEvent::ButtonDown {
                button: PointerButton::Left,
                point: None,
            },
            utc(8, 0, 0),
        );
        state.reset_metrics();
        assert!(state.drain().is_empty());

        state.ingest(
            InputEvent::ButtonDown {
                button: PointerButton::Right,
                point: None,
            },
            utc(8, 0, 1),
        );
        let bucket = state.drain().pop().unwrap();
        assert_eq!(bucket.metrics.left_clicks, 0);
        assert_eq!(bucket.metrics.right_clicks, 1);
    }
}
