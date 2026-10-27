use chrono::{DateTime, Local, NaiveDate, TimeZone, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use std::fs;
use std::path::{Path, PathBuf};
use tactile_core::aggregation::{HEATMAP_COLUMNS, HEATMAP_ROWS};
use tactile_core::models::{
    AggregatedBucket, AppSettings, BucketMetrics, Coverage, Granularity, Heatmap, HourlyPoint,
    StatsSnapshot, TimeRange,
};
use tactile_core::stats::{click_heatmap, summarize_buckets};
use thiserror::Error;

const SCHEMA_VERSION: i64 = 4;
/// Key id that older builds stored for the macOS globe/Fn key (keycode 179).
const MISCOUNTED_FN_KEY: &str = "key_10b3";
const HEATMAP_CELLS: usize = HEATMAP_COLUMNS * HEATMAP_ROWS;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database schema is newer than this application")]
    FutureSchema,
    #[error("settings could not be serialized")]
    SettingsSerialization,
}

pub struct Store {
    connection: Connection,
    path: PathBuf,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut connection = Connection::open(&path)?;
        // Another writer (e.g. a second instance during an update) should wait
        // briefly instead of failing with SQLITE_BUSY.
        connection.busy_timeout(std::time::Duration::from_secs(3))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&mut connection)?;
        Ok(Self { connection, path })
    }

    /// Fallback store used when the database file cannot be opened.
    pub fn open_in_memory() -> Result<Self, StoreError> {
        let mut connection = Connection::open_in_memory()?;
        migrate(&mut connection)?;
        Ok(Self {
            connection,
            path: PathBuf::new(),
        })
    }

    pub fn write_buckets(&mut self, buckets: &[AggregatedBucket]) -> Result<(), StoreError> {
        if buckets.is_empty() {
            return Ok(());
        }
        let tx = self.connection.transaction()?;
        for bucket in buckets {
            let timestamp = bucket.start_utc.timestamp();
            let hour_timestamp = (timestamp / 3600) * 3600;
            let day_timestamp = local_midnight_utc(bucket.local_date);
            let key = (timestamp, bucket.local_date.to_string(), bucket.local_hour);
            tx.execute(
                "INSERT INTO bucket_metrics
                 (granularity, bucket_start_utc, local_date, local_hour, distance_px, wheel_up,
                  wheel_down, left_clicks, right_clicks, middle_clicks, side1_clicks,
                  side2_clicks, other_clicks,
                  key_presses, shortcut_presses, active_seconds)
                 VALUES ('minute', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                         ?14, ?15)
                 ON CONFLICT(granularity, bucket_start_utc) DO UPDATE SET
                  distance_px = bucket_metrics.distance_px + excluded.distance_px,
                  wheel_up = bucket_metrics.wheel_up + excluded.wheel_up,
                  wheel_down = bucket_metrics.wheel_down + excluded.wheel_down,
                  left_clicks = bucket_metrics.left_clicks + excluded.left_clicks,
                  right_clicks = bucket_metrics.right_clicks + excluded.right_clicks,
                  middle_clicks = bucket_metrics.middle_clicks + excluded.middle_clicks,
                  side1_clicks = bucket_metrics.side1_clicks + excluded.side1_clicks,
                  side2_clicks = bucket_metrics.side2_clicks + excluded.side2_clicks,
                  other_clicks = bucket_metrics.other_clicks + excluded.other_clicks,
                  key_presses = bucket_metrics.key_presses + excluded.key_presses,
                  shortcut_presses = bucket_metrics.shortcut_presses + excluded.shortcut_presses,
                  active_seconds = bucket_metrics.active_seconds + excluded.active_seconds",
                params![
                    key.0,
                    key.1,
                    key.2,
                    bucket.metrics.distance_px,
                    bucket.metrics.wheel_up,
                    bucket.metrics.wheel_down,
                    bucket.metrics.left_clicks,
                    bucket.metrics.right_clicks,
                    bucket.metrics.middle_clicks,
                    bucket.metrics.side1_clicks,
                    bucket.metrics.side2_clicks,
                    bucket.metrics.other_clicks,
                    bucket.metrics.key_presses,
                    bucket.metrics.shortcut_presses,
                    bucket.metrics.active_seconds
                ],
            )?;
            tx.execute(
                "INSERT INTO bucket_metrics
                 (granularity, bucket_start_utc, local_date, local_hour, distance_px, wheel_up,
                  wheel_down, left_clicks, right_clicks, middle_clicks, side1_clicks,
                  side2_clicks, other_clicks, key_presses, shortcut_presses, active_seconds)
                 VALUES ('hour', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                         ?14, ?15)
                 ON CONFLICT(granularity, bucket_start_utc) DO UPDATE SET
                  distance_px = bucket_metrics.distance_px + excluded.distance_px,
                  wheel_up = bucket_metrics.wheel_up + excluded.wheel_up,
                  wheel_down = bucket_metrics.wheel_down + excluded.wheel_down,
                  left_clicks = bucket_metrics.left_clicks + excluded.left_clicks,
                  right_clicks = bucket_metrics.right_clicks + excluded.right_clicks,
                  middle_clicks = bucket_metrics.middle_clicks + excluded.middle_clicks,
                  side1_clicks = bucket_metrics.side1_clicks + excluded.side1_clicks,
                  side2_clicks = bucket_metrics.side2_clicks + excluded.side2_clicks,
                  other_clicks = bucket_metrics.other_clicks + excluded.other_clicks,
                  key_presses = bucket_metrics.key_presses + excluded.key_presses,
                  shortcut_presses = bucket_metrics.shortcut_presses + excluded.shortcut_presses,
                  active_seconds = bucket_metrics.active_seconds + excluded.active_seconds",
                params![
                    hour_timestamp,
                    key.1,
                    key.2,
                    bucket.metrics.distance_px,
                    bucket.metrics.wheel_up,
                    bucket.metrics.wheel_down,
                    bucket.metrics.left_clicks,
                    bucket.metrics.right_clicks,
                    bucket.metrics.middle_clicks,
                    bucket.metrics.side1_clicks,
                    bucket.metrics.side2_clicks,
                    bucket.metrics.other_clicks,
                    bucket.metrics.key_presses,
                    bucket.metrics.shortcut_presses,
                    bucket.metrics.active_seconds
                ],
            )?;
            tx.execute(
                "INSERT INTO bucket_metrics
                 (granularity, bucket_start_utc, local_date, local_hour, distance_px, wheel_up,
                  wheel_down, left_clicks, right_clicks, middle_clicks, side1_clicks,
                  side2_clicks, other_clicks, key_presses, shortcut_presses, active_seconds)
                 VALUES ('day', ?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                         ?14)
                 ON CONFLICT(granularity, bucket_start_utc) DO UPDATE SET
                  distance_px = bucket_metrics.distance_px + excluded.distance_px,
                  wheel_up = bucket_metrics.wheel_up + excluded.wheel_up,
                  wheel_down = bucket_metrics.wheel_down + excluded.wheel_down,
                  left_clicks = bucket_metrics.left_clicks + excluded.left_clicks,
                  right_clicks = bucket_metrics.right_clicks + excluded.right_clicks,
                  middle_clicks = bucket_metrics.middle_clicks + excluded.middle_clicks,
                  side1_clicks = bucket_metrics.side1_clicks + excluded.side1_clicks,
                  side2_clicks = bucket_metrics.side2_clicks + excluded.side2_clicks,
                  other_clicks = bucket_metrics.other_clicks + excluded.other_clicks,
                  key_presses = bucket_metrics.key_presses + excluded.key_presses,
                  shortcut_presses = bucket_metrics.shortcut_presses + excluded.shortcut_presses,
                  active_seconds = bucket_metrics.active_seconds + excluded.active_seconds",
                params![
                    day_timestamp,
                    key.1,
                    bucket.metrics.distance_px,
                    bucket.metrics.wheel_up,
                    bucket.metrics.wheel_down,
                    bucket.metrics.left_clicks,
                    bucket.metrics.right_clicks,
                    bucket.metrics.middle_clicks,
                    bucket.metrics.side1_clicks,
                    bucket.metrics.side2_clicks,
                    bucket.metrics.other_clicks,
                    bucket.metrics.key_presses,
                    bucket.metrics.shortcut_presses,
                    bucket.metrics.active_seconds
                ],
            )?;
            for (index, value) in bucket.metrics.click_cells.iter().enumerate() {
                if *value == 0 {
                    continue;
                }
                tx.execute(
                    "INSERT INTO bucket_click_cells (bucket_start_utc, cell_index, count)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(bucket_start_utc, cell_index)
                     DO UPDATE SET count = bucket_click_cells.count + excluded.count",
                    params![key.0, index as i64, to_sql_count(*value)],
                )?;
                tx.execute(
                    "INSERT INTO daily_click_cells (local_date, cell_index, count)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(local_date, cell_index)
                     DO UPDATE SET count = daily_click_cells.count + excluded.count",
                    params![key.1, index as i64, to_sql_count(*value)],
                )?;
            }
            for (key_id, count) in &bucket.metrics.keys {
                tx.execute(
                    "INSERT INTO bucket_keys (bucket_start_utc, key_id, count)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(bucket_start_utc, key_id)
                     DO UPDATE SET count = bucket_keys.count + excluded.count",
                    params![key.0, key_id, (*count).min(i64::MAX as u64) as i64],
                )?;
                tx.execute(
                    "INSERT INTO daily_key_counts (local_date, key_id, count)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(local_date, key_id)
                     DO UPDATE SET count = daily_key_counts.count + excluded.count",
                    params![key.1, key_id, (*count).min(i64::MAX as u64) as i64],
                )?;
            }
            tx.execute(
                "INSERT INTO bucket_daily
                 (local_date, distance_px, key_presses, clicks, active_seconds)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(local_date) DO UPDATE SET
                  distance_px = bucket_daily.distance_px + excluded.distance_px,
                  key_presses = bucket_daily.key_presses + excluded.key_presses,
                  clicks = bucket_daily.clicks + excluded.clicks,
                  active_seconds = bucket_daily.active_seconds + excluded.active_seconds",
                params![
                    key.1,
                    bucket.metrics.distance_px,
                    bucket.metrics.key_presses.min(i64::MAX as u64) as i64,
                    bucket
                        .metrics
                        .left_clicks
                        .saturating_add(bucket.metrics.right_clicks)
                        .saturating_add(bucket.metrics.middle_clicks)
                        .saturating_add(bucket.metrics.side1_clicks)
                        .saturating_add(bucket.metrics.side2_clicks)
                        .saturating_add(bucket.metrics.other_clicks)
                        .min(i64::MAX as u64) as i64,
                    bucket.metrics.active_seconds.min(i64::MAX as u64) as i64,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn stats(&self, range: &TimeRange) -> Result<StatsSnapshot, StoreError> {
        let mut buckets = self.day_buckets(range)?;
        for bucket in &mut buckets {
            bucket.metrics.keys.clear();
        }
        if let Some(first) = buckets.first_mut() {
            first.metrics.keys = self.key_totals(range)?;
        }
        let previous_range = previous_range(range);
        let previous = self.stats_for_range(&previous_range)?;
        let mut stats = summarize_buckets(&buckets, range, &previous);
        stats.hourly = self.hourly_points(range)?;
        stats.comparison_range = Some(previous_range);
        stats.data_coverage = Some(Coverage {
            minute_retention_hours: 48,
            hour_retention_days: 90,
            database_bytes: self.database_size(),
        });
        Ok(stats)
    }

    fn stats_for_range(&self, range: &TimeRange) -> Result<Vec<AggregatedBucket>, StoreError> {
        self.day_buckets(range)
    }

    fn day_buckets(&self, range: &TimeRange) -> Result<Vec<AggregatedBucket>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT bucket_start_utc, local_date, local_hour, distance_px, wheel_up, wheel_down,
                    left_clicks, right_clicks, middle_clicks, side1_clicks, side2_clicks,
                    other_clicks, key_presses, shortcut_presses, active_seconds
             FROM bucket_metrics
             WHERE granularity = 'day' AND local_date BETWEEN ?1 AND ?2
             ORDER BY bucket_start_utc",
        )?;
        let rows = statement.query_map(
            params![
                range.start_local_day.to_string(),
                range.end_local_day.to_string()
            ],
            |row| {
                let start_utc = Utc
                    .timestamp_opt(row.get::<_, i64>(0)?, 0)
                    .single()
                    .unwrap_or_else(Utc::now);
                let local_date = NaiveDate::parse_from_str(&row.get::<_, String>(1)?, "%Y-%m-%d")
                    .unwrap_or_else(|_| Local::now().date_naive());
                Ok(AggregatedBucket {
                    start_utc,
                    local_date,
                    local_hour: row.get::<_, i64>(2)?.clamp(0, 23) as u8,
                    granularity: Granularity::Day,
                    metrics: BucketMetrics {
                        distance_px: row.get::<_, f64>(3)?,
                        wheel_up: row.get::<_, f64>(4)?,
                        wheel_down: row.get::<_, f64>(5)?,
                        left_clicks: row.get::<_, i64>(6)? as u64,
                        right_clicks: row.get::<_, i64>(7)? as u64,
                        middle_clicks: row.get::<_, i64>(8)? as u64,
                        side1_clicks: row.get::<_, i64>(9)? as u64,
                        side2_clicks: row.get::<_, i64>(10)? as u64,
                        other_clicks: row.get::<_, i64>(11)? as u64,
                        key_presses: row.get::<_, i64>(12)? as u64,
                        shortcut_presses: row.get::<_, i64>(13)? as u64,
                        active_seconds: row.get::<_, i64>(14)? as u64,
                        ..Default::default()
                    },
                })
            },
        )?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    fn hourly_points(&self, range: &TimeRange) -> Result<Vec<HourlyPoint>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT local_hour, left_clicks, right_clicks, middle_clicks, side1_clicks,
                    side2_clicks, other_clicks, key_presses, active_seconds
             FROM bucket_metrics
             WHERE granularity = 'hour' AND local_date BETWEEN ?1 AND ?2",
        )?;
        let mut points = vec![HourlyPoint::default(); 24];
        for (hour, point) in points.iter_mut().enumerate() {
            point.hour = hour as u8;
        }
        for row in statement.query_map(
            params![
                range.start_local_day.to_string(),
                range.end_local_day.to_string()
            ],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                ))
            },
        )? {
            let (hour, left, right, middle, side1, side2, other, keys, active_seconds) = row?;
            if let Some(point) = points.get_mut(hour.clamp(0, 23) as usize) {
                let events = [left, right, middle, side1, side2, other, keys]
                    .into_iter()
                    .map(|value| value.max(0) as u64)
                    .fold(0_u64, u64::saturating_add);
                point.events = point.events.saturating_add(events);
                point.active_seconds = point
                    .active_seconds
                    .saturating_add(active_seconds.max(0) as u64);
            }
        }
        Ok(points)
    }

    pub fn click_heatmap(&self, range: &TimeRange) -> Result<Heatmap, StoreError> {
        let mut cells = vec![0u64; HEATMAP_CELLS];
        let mut statement = self.connection.prepare(
            "SELECT cell_index, count
             FROM daily_click_cells
             WHERE local_date BETWEEN ?1 AND ?2",
        )?;
        for row in statement.query_map(
            params![
                range.start_local_day.to_string(),
                range.end_local_day.to_string()
            ],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )? {
            let (index, count) = row?;
            if let Some(target) = cells.get_mut(index.max(0) as usize) {
                *target = target.saturating_add(count.max(0) as u64);
            }
        }
        Ok(click_heatmap(
            &[AggregatedBucket {
                start_utc: Utc::now(),
                local_date: range.start_local_day,
                local_hour: 0,
                granularity: Granularity::Day,
                metrics: BucketMetrics {
                    click_cells: cells,
                    ..Default::default()
                },
            }],
            HEATMAP_COLUMNS,
            HEATMAP_ROWS,
        ))
    }

    fn key_totals(&self, range: &TimeRange) -> Result<Vec<(String, u64)>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT key_id, count
             FROM daily_key_counts
             WHERE local_date BETWEEN ?1 AND ?2",
        )?;
        let mut totals = std::collections::BTreeMap::<String, u64>::new();
        for row in statement.query_map(
            params![
                range.start_local_day.to_string(),
                range.end_local_day.to_string()
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )? {
            let (key_id, count) = row?;
            let total = totals.entry(key_id).or_default();
            *total = total.saturating_add(count.max(0) as u64);
        }
        Ok(totals.into_iter().collect())
    }

    pub fn settings(&self) -> Result<AppSettings, StoreError> {
        let json: Option<String> = self
            .connection
            .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| {
                row.get(0)
            })
            .optional()?;
        Ok(json
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default())
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), StoreError> {
        let json =
            serde_json::to_string(settings).map_err(|_| StoreError::SettingsSerialization)?;
        self.connection.execute(
            "INSERT INTO settings (key, value) VALUES ('app', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![json],
        )?;
        Ok(())
    }

    pub fn clear_range(&mut self, range: Option<&TimeRange>) -> Result<(), StoreError> {
        let tx = self.connection.transaction()?;
        // A local day intentionally owns all finer-grained data for that day.
        // Removing only rows in the local UTC window can leave post-midnight
        // minute rows behind, so clear children by the date key instead.
        match range {
            Some(range) => {
                let start = range.start_local_day.to_string();
                let end = range.end_local_day.to_string();
                tx.execute(
                    "DELETE FROM bucket_keys WHERE bucket_start_utc IN (
                        SELECT bucket_start_utc FROM bucket_metrics
                        WHERE local_date BETWEEN ?1 AND ?2
                     )",
                    params![start, end],
                )?;
                tx.execute(
                    "DELETE FROM bucket_click_cells WHERE bucket_start_utc IN (
                        SELECT bucket_start_utc FROM bucket_metrics
                        WHERE local_date BETWEEN ?1 AND ?2
                     )",
                    params![start, end],
                )?;
                tx.execute(
                    "DELETE FROM bucket_metrics WHERE local_date BETWEEN ?1 AND ?2",
                    params![start, end],
                )?;
                tx.execute(
                    "DELETE FROM bucket_daily WHERE local_date BETWEEN ?1 AND ?2",
                    params![start, end],
                )?;
                tx.execute(
                    "DELETE FROM daily_key_counts WHERE local_date BETWEEN ?1 AND ?2",
                    params![start, end],
                )?;
                tx.execute(
                    "DELETE FROM daily_click_cells WHERE local_date BETWEEN ?1 AND ?2",
                    params![start, end],
                )?;
            }
            None => {
                tx.execute("DELETE FROM bucket_keys", [])?;
                tx.execute("DELETE FROM bucket_click_cells", [])?;
                tx.execute("DELETE FROM bucket_metrics", [])?;
                tx.execute("DELETE FROM bucket_daily", [])?;
                tx.execute("DELETE FROM daily_key_counts", [])?;
                tx.execute("DELETE FROM daily_click_cells", [])?;
            }
        }
        tx.commit()?;
        // Reclaiming space is best effort; the data is already gone.
        let _ = self.connection.execute_batch("VACUUM");
        Ok(())
    }

    pub fn purge_minute_buckets(&mut self, before: DateTime<Utc>) -> Result<usize, StoreError> {
        let tx = self.connection.transaction()?;
        let timestamp = before.timestamp();
        tx.execute(
            "DELETE FROM bucket_keys
             WHERE bucket_start_utc IN (
                 SELECT bucket_start_utc FROM bucket_metrics
                 WHERE granularity = 'minute' AND bucket_start_utc < ?1
             )",
            params![timestamp],
        )?;
        tx.execute(
            "DELETE FROM bucket_click_cells
             WHERE bucket_start_utc IN (
                 SELECT bucket_start_utc FROM bucket_metrics
                 WHERE granularity = 'minute' AND bucket_start_utc < ?1
             )",
            params![timestamp],
        )?;
        let removed = tx.execute(
            "DELETE FROM bucket_metrics WHERE granularity = 'minute' AND bucket_start_utc < ?1",
            params![timestamp],
        )?;
        tx.commit()?;
        Ok(removed)
    }

    pub fn purge_hour_buckets(&mut self, before: DateTime<Utc>) -> Result<usize, StoreError> {
        let tx = self.connection.transaction()?;
        let removed = tx.execute(
            "DELETE FROM bucket_metrics WHERE granularity = 'hour' AND bucket_start_utc < ?1",
            params![before.timestamp()],
        )?;
        tx.commit()?;
        Ok(removed)
    }

    #[cfg(test)]
    pub fn daily(
        &self,
        range: &TimeRange,
    ) -> Result<Vec<tactile_core::models::SeriesPoint>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT local_date, distance_px, key_presses, clicks, active_seconds
             FROM bucket_daily WHERE local_date BETWEEN ?1 AND ?2 ORDER BY local_date",
        )?;
        let rows = statement.query_map(
            params![
                range.start_local_day.to_string(),
                range.end_local_day.to_string()
            ],
            |row| {
                let date = NaiveDate::parse_from_str(&row.get::<_, String>(0)?, "%Y-%m-%d")
                    .unwrap_or_else(|_| Local::now().date_naive());
                Ok(tactile_core::models::SeriesPoint {
                    date,
                    distance_px: row.get(1)?,
                    key_presses: row.get::<_, i64>(2)? as u64,
                    clicks: row.get::<_, i64>(3)? as u64,
                    active_seconds: row.get::<_, i64>(4)? as u64,
                })
            },
        )?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn database_size(&self) -> u64 {
        database_file_size(&self.path)
    }

    #[cfg(test)]
    pub fn schema_version(&self) -> Result<i64, StoreError> {
        Ok(self
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }
}

fn to_sql_count(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn database_file_size(path: &Path) -> u64 {
    let base = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    let wal = fs::metadata(format!("{}-wal", path.display()))
        .map(|meta| meta.len())
        .unwrap_or(0);
    let shm = fs::metadata(format!("{}-shm", path.display()))
        .map(|meta| meta.len())
        .unwrap_or(0);
    base.saturating_add(wal).saturating_add(shm)
}

fn previous_range(range: &TimeRange) -> TimeRange {
    let length = (range.end_local_day - range.start_local_day).num_days() + 1;
    let end = range
        .start_local_day
        .pred_opt()
        .unwrap_or(range.start_local_day);
    TimeRange {
        start_local_day: end
            .checked_sub_signed(chrono::Duration::days(length - 1))
            .unwrap_or(end),
        end_local_day: end,
    }
}

fn local_midnight_utc(date: NaiveDate) -> i64 {
    // Midnight can be skipped by a DST change; fall back to UTC midnight so the
    // day row still has a stable key instead of drifting with `now`.
    let midnight = date.and_time(chrono::NaiveTime::MIN);
    Local
        .from_local_datetime(&midnight)
        .earliest()
        .map(|local| local.timestamp())
        .unwrap_or_else(|| midnight.and_utc().timestamp())
}

/// Fn is a modifier and must not be counted, but keycode 179 used to fall
/// through as an ordinary key. Drop those rows and take them out of the daily
/// totals (hourly rows have no per-key detail and keep the small overcount).
fn remove_miscounted_fn(connection: &mut Connection) -> Result<(), StoreError> {
    let tx = connection.transaction()?;
    tx.execute(
        "UPDATE bucket_metrics SET key_presses = MAX(0, key_presses - (
            SELECT count FROM daily_key_counts d
            WHERE d.local_date = bucket_metrics.local_date AND d.key_id = ?1))
         WHERE granularity = 'day' AND local_date IN (
            SELECT local_date FROM daily_key_counts WHERE key_id = ?1)",
        params![MISCOUNTED_FN_KEY],
    )?;
    tx.execute(
        "UPDATE bucket_daily SET key_presses = MAX(0, key_presses - (
            SELECT count FROM daily_key_counts d
            WHERE d.local_date = bucket_daily.local_date AND d.key_id = ?1))
         WHERE local_date IN (SELECT local_date FROM daily_key_counts WHERE key_id = ?1)",
        params![MISCOUNTED_FN_KEY],
    )?;
    tx.execute(
        "DELETE FROM daily_key_counts WHERE key_id = ?1",
        params![MISCOUNTED_FN_KEY],
    )?;
    tx.execute(
        "DELETE FROM bucket_keys WHERE key_id = ?1",
        params![MISCOUNTED_FN_KEY],
    )?;
    tx.execute_batch("PRAGMA user_version = 3;")?;
    tx.commit()?;
    Ok(())
}

/// The old disabled toggle left `check_updates: false` in every stored
/// settings row. Enable it once; later user choices are not overwritten.
fn enable_update_checks(connection: &mut Connection) -> Result<(), StoreError> {
    let tx = connection.transaction()?;
    let json: Option<String> = tx
        .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| {
            row.get(0)
        })
        .optional()?;
    if let Some(json) = json
        && let Ok(mut settings) = serde_json::from_str::<serde_json::Value>(&json)
        && let Some(object) = settings.as_object_mut()
    {
        object.insert("check_updates".into(), serde_json::Value::Bool(true));
        tx.execute(
            "UPDATE settings SET value = ?1 WHERE key = 'app'",
            params![
                serde_json::to_string(&settings).map_err(|_| StoreError::SettingsSerialization)?
            ],
        )?;
    }
    tx.execute_batch("PRAGMA user_version = 4;")?;
    tx.commit()?;
    Ok(())
}

fn migrate(connection: &mut Connection) -> Result<(), StoreError> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(StoreError::FutureSchema);
    }
    if version < 1 {
        let tx = connection.transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS bucket_metrics (
                granularity TEXT NOT NULL,
                bucket_start_utc INTEGER NOT NULL,
                local_date TEXT NOT NULL,
                local_hour INTEGER NOT NULL,
                distance_px REAL NOT NULL DEFAULT 0,
                wheel_up REAL NOT NULL DEFAULT 0,
                wheel_down REAL NOT NULL DEFAULT 0,
                left_clicks INTEGER NOT NULL DEFAULT 0,
                right_clicks INTEGER NOT NULL DEFAULT 0,
                middle_clicks INTEGER NOT NULL DEFAULT 0,
                side1_clicks INTEGER NOT NULL DEFAULT 0,
                side2_clicks INTEGER NOT NULL DEFAULT 0,
                other_clicks INTEGER NOT NULL DEFAULT 0,
                key_presses INTEGER NOT NULL DEFAULT 0,
                shortcut_presses INTEGER NOT NULL DEFAULT 0,
                active_seconds INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (granularity, bucket_start_utc)
             );
             CREATE INDEX IF NOT EXISTS idx_bucket_metrics_date
                ON bucket_metrics (granularity, local_date);
             CREATE TABLE IF NOT EXISTS bucket_keys (
                bucket_start_utc INTEGER NOT NULL,
                key_id TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (bucket_start_utc, key_id)
             );
             CREATE TABLE IF NOT EXISTS bucket_click_cells (
                bucket_start_utc INTEGER NOT NULL,
                cell_index INTEGER NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (bucket_start_utc, cell_index)
             );
             CREATE TABLE IF NOT EXISTS daily_key_counts (
                local_date TEXT NOT NULL,
                key_id TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (local_date, key_id)
             );
             CREATE TABLE IF NOT EXISTS daily_click_cells (
                local_date TEXT NOT NULL,
                cell_index INTEGER NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (local_date, cell_index)
             );
             CREATE TABLE IF NOT EXISTS bucket_daily (
                local_date TEXT PRIMARY KEY,
                distance_px REAL NOT NULL DEFAULT 0,
                key_presses INTEGER NOT NULL DEFAULT 0,
                clicks INTEGER NOT NULL DEFAULT 0,
                active_seconds INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS device (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );
             PRAGMA user_version = 2;",
        )?;
        tx.commit()?;
    } else if version < 2 {
        let tx = connection.transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS daily_key_counts (
                local_date TEXT NOT NULL,
                key_id TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (local_date, key_id)
             );
             CREATE TABLE IF NOT EXISTS daily_click_cells (
                local_date TEXT NOT NULL,
                cell_index INTEGER NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (local_date, cell_index)
             );
             INSERT INTO daily_key_counts (local_date, key_id, count)
             SELECT m.local_date, k.key_id, SUM(k.count)
             FROM bucket_keys k
             JOIN bucket_metrics m ON m.bucket_start_utc = k.bucket_start_utc
             WHERE m.granularity = 'minute'
             GROUP BY m.local_date, k.key_id
             ON CONFLICT(local_date, key_id) DO UPDATE SET count = excluded.count;
             INSERT INTO daily_click_cells (local_date, cell_index, count)
             SELECT m.local_date, c.cell_index, SUM(c.count)
             FROM bucket_click_cells c
             JOIN bucket_metrics m ON m.bucket_start_utc = c.bucket_start_utc
             WHERE m.granularity = 'minute'
             GROUP BY m.local_date, c.cell_index
             ON CONFLICT(local_date, cell_index) DO UPDATE SET count = excluded.count;
             PRAGMA user_version = 2;",
        )?;
        tx.commit()?;
    }
    if connection.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))? < 3 {
        remove_miscounted_fn(connection)?;
    }
    if connection.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))? < 4 {
        enable_update_checks(connection)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tactile_core::models::{AppSettings, LanguagePreference, ThemePreference};

    fn sample_bucket(day: u32) -> AggregatedBucket {
        AggregatedBucket {
            start_utc: Utc.with_ymd_and_hms(2026, 10, day, 8, 0, 0).unwrap(),
            local_date: NaiveDate::from_ymd_opt(2026, 10, day).unwrap(),
            local_hour: 8,
            granularity: Granularity::Minute,
            metrics: BucketMetrics {
                distance_px: 1500.0,
                key_presses: 20,
                shortcut_presses: 4,
                left_clicks: 3,
                right_clicks: 1,
                active_seconds: 9,
                keys: vec![("space".into(), 7)],
                click_cells: {
                    let mut cells = vec![0; HEATMAP_COLUMNS * HEATMAP_ROWS];
                    cells[42] = 2;
                    cells
                },
                ..Default::default()
            },
        }
    }

    #[test]
    fn writes_and_queries_bucket() {
        let mut store = Store::open_in_memory().unwrap();
        let bucket = sample_bucket(20);
        store.write_buckets(std::slice::from_ref(&bucket)).unwrap();
        let range = TimeRange {
            start_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
            end_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
        };
        let stats = store.stats(&range).unwrap();
        assert_eq!(stats.totals.key_presses, 20);
        assert_eq!(stats.totals.clicks, 4);
        assert_eq!(stats.keys[0].count, 7);
        assert_eq!(store.daily(&range).unwrap().len(), 1);
    }

    #[test]
    fn repeated_flush_in_same_minute_adds_new_events() {
        let mut store = Store::open_in_memory().unwrap();
        store.write_buckets(&[sample_bucket(20)]).unwrap();
        let mut second = sample_bucket(20);
        second.metrics.key_presses = 3;
        second.metrics.keys = vec![("space".into(), 1)];
        second.metrics.click_cells.fill(0);
        store.write_buckets(&[second]).unwrap();
        let range = TimeRange {
            start_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
            end_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
        };
        assert_eq!(store.stats(&range).unwrap().totals.key_presses, 23);
    }

    #[test]
    fn deleting_a_day_removes_only_that_day() {
        let mut store = Store::open_in_memory().unwrap();
        store
            .write_buckets(&[sample_bucket(20), sample_bucket(21)])
            .unwrap();
        let day = TimeRange {
            start_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
            end_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
        };
        store.clear_range(Some(&day)).unwrap();
        let all = TimeRange {
            start_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
            end_local_day: NaiveDate::from_ymd_opt(2026, 10, 21).unwrap(),
        };
        assert_eq!(store.stats(&all).unwrap().totals.key_presses, 20);
    }

    #[test]
    fn migration_removes_miscounted_fn_presses() {
        let mut store = Store::open_in_memory().unwrap();
        let mut bucket = sample_bucket(20);
        bucket.metrics.keys.push((MISCOUNTED_FN_KEY.into(), 5));
        store.write_buckets(&[bucket]).unwrap();
        remove_miscounted_fn(&mut store.connection).unwrap();
        let range = TimeRange {
            start_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
            end_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
        };
        let stats = store.stats(&range).unwrap();
        assert_eq!(stats.totals.key_presses, 15);
        assert!(stats.keys.iter().all(|key| key.key_id != MISCOUNTED_FN_KEY));
    }

    #[test]
    fn settings_round_trip() {
        let store = Store::open_in_memory().unwrap();
        let settings = AppSettings {
            launch_at_login: false,
            check_updates: false,
            theme: ThemePreference::Dark,
            language: LanguagePreference::En,
            shortcuts_enabled: false,
            onboarding_complete: true,
        };
        store.save_settings(&settings).unwrap();
        assert_eq!(store.settings().unwrap(), settings);
    }

    #[test]
    fn schema_version_is_initialized() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.schema_version().unwrap(), SCHEMA_VERSION);
    }

    #[test]
    fn migration_enables_updates_in_stored_settings() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 PRAGMA user_version = 3;",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO settings (key, value) VALUES ('app', ?1)",
                params![r#"{"launch_at_login":false,"check_updates":false,"theme":"system","language":"system","shortcuts_enabled":true,"onboarding_complete":true}"#],
            )
            .unwrap();

        migrate(&mut connection).unwrap();

        let json: String = connection
            .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let settings: AppSettings = serde_json::from_str(&json).unwrap();
        assert!(settings.check_updates);
        assert!(settings.onboarding_complete);
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
    }

    #[test]
    fn daily_heatmap_and_keys_survive_minute_retention() {
        let mut store = Store::open_in_memory().unwrap();
        store.write_buckets(&[sample_bucket(20)]).unwrap();
        store
            .purge_minute_buckets(Utc.with_ymd_and_hms(2026, 10, 21, 0, 0, 0).unwrap())
            .unwrap();
        let range = TimeRange {
            start_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
            end_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
        };
        assert_eq!(store.stats(&range).unwrap().totals.key_presses, 20);
        assert_eq!(store.stats(&range).unwrap().keys[0].count, 7);
        assert_eq!(store.click_heatmap(&range).unwrap().filtered_total, 2);
    }

    #[test]
    fn database_size_includes_wal_sidecar() {
        let directory = std::env::temp_dir().join(format!(
            "tactile-wal-size-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("tactile.db");
        let store = Store::open(&path).unwrap();
        fs::write(format!("{}-wal", path.display()), vec![0_u8; 4096]).unwrap();
        assert!(store.database_size() >= 4096);
        drop(store);
        fs::remove_dir_all(directory).unwrap();
    }
}
