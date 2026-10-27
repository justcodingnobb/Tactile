use crate::aggregation::{
    local_day, month_start, previous_range, today_local, week_start, year_start,
};
use crate::models::{
    AggregatedBucket, ButtonCount, Comparison, Granularity, Heatmap, HourlyPoint, KeyCount,
    PointerButton, RangePreset, SeriesPoint, StatsSnapshot, TimeRange, Totals,
};
use chrono::{Datelike, NaiveDate};
use std::collections::BTreeMap;

pub fn range_for_preset(preset: RangePreset, today: NaiveDate) -> TimeRange {
    let start = match preset {
        RangePreset::Today => today,
        RangePreset::Week => week_start(today),
        RangePreset::Month => month_start(today),
        RangePreset::Year => year_start(today),
        RangePreset::Custom => today,
    };
    TimeRange {
        start_local_day: start,
        end_local_day: today,
    }
}

pub fn summarize_buckets(
    buckets: &[AggregatedBucket],
    range: &TimeRange,
    comparison_buckets: &[AggregatedBucket],
) -> StatsSnapshot {
    let mut totals = Totals::default();
    let mut daily: BTreeMap<NaiveDate, SeriesPoint> = BTreeMap::new();
    let mut hourly = vec![HourlyPoint::default(); 24];
    let mut keys: BTreeMap<String, (String, u64)> = BTreeMap::new();
    let mut buttons = BTreeMap::new();

    for bucket in buckets {
        totals.distance_px += bucket.metrics.distance_px;
        totals.key_presses += bucket.metrics.key_presses;
        totals.shortcut_presses += bucket.metrics.shortcut_presses;
        totals.left_clicks += bucket.metrics.left_clicks;
        totals.right_clicks += bucket.metrics.right_clicks;
        totals.middle_clicks += bucket.metrics.middle_clicks;
        totals.side1_clicks += bucket.metrics.side1_clicks;
        totals.side2_clicks += bucket.metrics.side2_clicks;
        totals.other_clicks += bucket.metrics.other_clicks;
        totals.active_seconds += bucket.metrics.active_seconds;
        totals.wheel_up += bucket.metrics.wheel_up;
        totals.wheel_down += bucket.metrics.wheel_down;

        let point = daily.entry(bucket.local_date).or_insert(SeriesPoint {
            date: bucket.local_date,
            ..Default::default()
        });
        point.distance_px += bucket.metrics.distance_px;
        point.key_presses += bucket.metrics.key_presses;
        point.clicks += bucket.metrics.left_clicks
            + bucket.metrics.right_clicks
            + bucket.metrics.middle_clicks
            + bucket.metrics.side1_clicks
            + bucket.metrics.side2_clicks
            + bucket.metrics.other_clicks;
        point.active_seconds += bucket.metrics.active_seconds;

        if bucket.granularity != Granularity::Day {
            let hour = &mut hourly[bucket.local_hour as usize % 24];
            hour.hour = bucket.local_hour;
            hour.events += bucket.metrics.key_presses
                + bucket.metrics.left_clicks
                + bucket.metrics.right_clicks
                + bucket.metrics.middle_clicks
                + bucket.metrics.side1_clicks
                + bucket.metrics.side2_clicks
                + bucket.metrics.other_clicks;
            hour.active_seconds += bucket.metrics.active_seconds;
        }

        for (id, count) in &bucket.metrics.keys {
            let entry = keys.entry(id.clone()).or_insert_with(|| (id.clone(), 0));
            entry.1 += count;
        }
        buttons.insert(PointerButton::Left, totals.left_clicks);
        buttons.insert(PointerButton::Right, totals.right_clicks);
        buttons.insert(PointerButton::Middle, totals.middle_clicks);
        buttons.insert(PointerButton::Side1, totals.side1_clicks);
        buttons.insert(PointerButton::Side2, totals.side2_clicks);
        buttons.insert(PointerButton::OtherSide, totals.other_clicks);
    }

    totals.clicks = totals.left_clicks
        + totals.right_clicks
        + totals.middle_clicks
        + totals.side1_clicks
        + totals.side2_clicks
        + totals.other_clicks;
    totals.distance_km = totals.distance_px / 1_000_000.0;
    totals.shortcut_ratio = if totals.key_presses == 0 {
        0.0
    } else {
        totals.shortcut_presses as f64 / totals.key_presses as f64
    };

    let comparison_totals = summarize_totals(comparison_buckets);
    let comparison = Comparison {
        distance_ratio: ratio(totals.distance_px, comparison_totals.distance_px),
        key_ratio: ratio(
            totals.key_presses as f64,
            comparison_totals.key_presses as f64,
        ),
        click_ratio: ratio(totals.clicks as f64, comparison_totals.clicks as f64),
        active_ratio: ratio(
            totals.active_seconds as f64,
            comparison_totals.active_seconds as f64,
        ),
    };

    let mut key_counts: Vec<KeyCount> = keys
        .into_iter()
        .map(|(id, (stored_label, count))| {
            let label = crate::keys::canonical_label(&id, &stored_label);
            KeyCount {
                key_id: id,
                label,
                count,
            }
        })
        .collect();
    key_counts.sort_by(|a, b| b.count.cmp(&a.count).then(a.label.cmp(&b.label)));

    StatsSnapshot {
        range: Some(range.clone()),
        comparison_range: Some(previous_range(range)),
        totals,
        comparison,
        series: daily.into_values().collect(),
        hourly,
        keys: key_counts,
        buttons: buttons
            .into_iter()
            .map(|(button, count)| ButtonCount { button, count })
            .collect(),
        data_coverage: None,
    }
}

pub fn summarize_totals(buckets: &[AggregatedBucket]) -> Totals {
    let mut totals = Totals::default();
    for bucket in buckets {
        totals.distance_px += bucket.metrics.distance_px;
        totals.key_presses += bucket.metrics.key_presses;
        totals.shortcut_presses += bucket.metrics.shortcut_presses;
        totals.left_clicks += bucket.metrics.left_clicks;
        totals.right_clicks += bucket.metrics.right_clicks;
        totals.middle_clicks += bucket.metrics.middle_clicks;
        totals.side1_clicks += bucket.metrics.side1_clicks;
        totals.side2_clicks += bucket.metrics.side2_clicks;
        totals.other_clicks += bucket.metrics.other_clicks;
        totals.active_seconds += bucket.metrics.active_seconds;
        totals.wheel_up += bucket.metrics.wheel_up;
        totals.wheel_down += bucket.metrics.wheel_down;
    }
    totals.clicks = totals.left_clicks
        + totals.right_clicks
        + totals.middle_clicks
        + totals.side1_clicks
        + totals.side2_clicks
        + totals.other_clicks;
    totals.distance_km = totals.distance_px / 1_000_000.0;
    totals.shortcut_ratio = if totals.key_presses == 0 {
        0.0
    } else {
        totals.shortcut_presses as f64 / totals.key_presses as f64
    };
    totals
}

pub fn click_heatmap(buckets: &[AggregatedBucket], columns: usize, rows: usize) -> Heatmap {
    let mut cells = vec![0u64; columns * rows];
    let mut filtered_total = 0u64;
    let mut max_value = 0u64;
    for bucket in buckets {
        for (index, value) in bucket.metrics.click_cells.iter().enumerate() {
            if let Some(cell) = cells.get_mut(index) {
                *cell = cell.saturating_add(*value);
                filtered_total += *value;
                max_value = max_value.max(*cell);
            }
        }
    }
    Heatmap {
        columns,
        rows,
        cells,
        max_value,
        filtered_total,
    }
}

pub fn compare_with_previous(range: &TimeRange) -> (TimeRange, TimeRange) {
    (range.clone(), previous_range(range))
}

fn ratio(current: f64, previous: f64) -> Option<f64> {
    if previous <= 0.0 {
        None
    } else {
        Some((current - previous) / previous)
    }
}

pub fn default_range() -> TimeRange {
    let today = today_local();
    TimeRange {
        start_local_day: local_day(today.year(), today.month(), today.day()),
        end_local_day: today,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::BucketMetrics;
    use chrono::{TimeZone, Utc};

    fn bucket(day: u32, metrics: BucketMetrics) -> AggregatedBucket {
        AggregatedBucket {
            start_utc: Utc.with_ymd_and_hms(2026, 10, day, 8, 0, 0).unwrap(),
            local_date: NaiveDate::from_ymd_opt(2026, 10, day).unwrap(),
            local_hour: 8,
            granularity: Granularity::Minute,
            metrics,
        }
    }

    #[test]
    fn preset_ranges_start_on_expected_day() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        assert_eq!(
            range_for_preset(RangePreset::Week, today).start_local_day,
            NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
        );
        assert_eq!(
            range_for_preset(RangePreset::Month, today).start_local_day,
            NaiveDate::from_ymd_opt(2026, 10, 1).unwrap()
        );
    }

    #[test]
    fn totals_include_all_buttons_and_shortcut_ratio() {
        let data = vec![bucket(
            20,
            BucketMetrics {
                key_presses: 4,
                shortcut_presses: 1,
                left_clicks: 2,
                right_clicks: 1,
                middle_clicks: 1,
                side1_clicks: 2,
                side2_clicks: 1,
                other_clicks: 4,
                ..Default::default()
            },
        )];
        let range = TimeRange {
            start_local_day: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            end_local_day: NaiveDate::from_ymd_opt(2026, 10, 31).unwrap(),
        };
        let stats = summarize_buckets(&data, &range, &[]);
        assert_eq!(stats.totals.clicks, 11);
        assert_eq!(stats.totals.shortcut_ratio, 0.25);
        assert_eq!(
            stats.buttons.iter().map(|value| value.count).sum::<u64>(),
            11
        );
    }

    #[test]
    fn no_previous_baseline_returns_empty_comparison() {
        let range = default_range();
        let (_, previous) = compare_with_previous(&range);
        assert!(previous.end_local_day < range.start_local_day);
    }

    #[test]
    fn heatmap_returns_aggregated_maximum() {
        let data = vec![bucket(
            20,
            BucketMetrics {
                click_cells: vec![2; 24 * 16],
                ..Default::default()
            },
        )];
        let heatmap = click_heatmap(&data, 24, 16);
        assert_eq!(heatmap.max_value, 2);
        assert_eq!(heatmap.filtered_total, 768);
    }
}
