use crate::models::{ExportBundle, Heatmap, StatsSnapshot};
use serde_json::json;

pub fn build_json_export(bundle: &ExportBundle) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(bundle)
}

pub fn build_csv_bundle(bundle: &ExportBundle, click_grid: &Heatmap) -> Vec<(String, String)> {
    let mut files = Vec::new();
    files.push((
        "totals.csv".into(),
        format!(
            "distance_px,distance_km,key_presses,shortcut_presses,shortcut_ratio,clicks,active_seconds,wheel_up,wheel_down,left_clicks,right_clicks,middle_clicks,side1_clicks,side2_clicks,other_clicks\n{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}\n",
            bundle.totals.distance_px,
            bundle.totals.distance_km,
            bundle.totals.key_presses,
            bundle.totals.shortcut_presses,
            bundle.totals.shortcut_ratio,
            bundle.totals.clicks,
            bundle.totals.active_seconds,
            bundle.totals.wheel_up,
            bundle.totals.wheel_down,
            bundle.totals.left_clicks,
            bundle.totals.right_clicks,
            bundle.totals.middle_clicks,
            bundle.totals.side1_clicks,
            bundle.totals.side2_clicks,
            bundle.totals.other_clicks
        ),
    ));
    let mut daily = String::from("date,distance_px,key_presses,clicks,active_seconds\n");
    for point in &bundle.daily {
        daily.push_str(&format!(
            "{},{},{},{},{}\n",
            point.date, point.distance_px, point.key_presses, point.clicks, point.active_seconds
        ));
    }
    files.push(("daily.csv".into(), daily));
    let mut keys = String::from("key_id,label,count\n");
    for key in &bundle.keys {
        keys.push_str(&format!(
            "{},{},{}\n",
            key.key_id,
            csv_escape(&key.label),
            key.count
        ));
    }
    files.push(("keys.csv".into(), keys));
    let mut buttons = String::from("button,count\n");
    for button in &bundle.buttons {
        buttons.push_str(&format!("{:?},{}\n", button.button, button.count));
    }
    files.push(("buttons.csv".into(), buttons));
    let mut grid = String::from("row,column,count\n");
    for (index, value) in click_grid.cells.iter().enumerate() {
        grid.push_str(&format!(
            "{},{},{}\n",
            index / click_grid.columns,
            index % click_grid.columns,
            value
        ));
    }
    files.push(("click-grid.csv".into(), grid));
    files.push((
        "metadata.csv".into(),
        format!(
            "schema_version,range_start,range_end,timezone,app_version\n{},{},{},{},{}\n",
            bundle.schema_version,
            bundle.range.start_local_day,
            bundle.range.end_local_day,
            csv_escape(&bundle.timezone),
            bundle.app_version
        ),
    ));
    files
}

pub fn sanitize_filename(input: &str) -> String {
    let filtered: String = input
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect();
    if filtered.is_empty() {
        "trajectory-export".into()
    } else {
        filtered
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

pub fn demo_snapshot() -> StatsSnapshot {
    serde_json::from_value(json!({
        "range": {
            "start_local_day": "2026-10-20",
            "end_local_day": "2026-10-26"
        },
        "comparison_range": {
            "start_local_day": "2026-10-13",
            "end_local_day": "2026-10-19"
        },
        "totals": {
            "distance_px": 12486730.0,
            "distance_km": 12.48673,
            "key_presses": 48219,
            "shortcut_presses": 6842,
            "shortcut_ratio": 0.1419,
            "clicks": 9237,
            "active_seconds": 119640,
            "wheel_up": 4231.0,
            "wheel_down": 3712.0,
            "left_clicks": 6841,
            "right_clicks": 1840,
            "middle_clicks": 324,
            "side1_clicks": 124,
            "side2_clicks": 74,
            "other_clicks": 34
        },
        "comparison": {
            "distance_ratio": 0.183,
            "key_ratio": 0.074,
            "click_ratio": -0.032,
            "active_ratio": 0.112
        },
        "series": [
            {"date":"2026-10-20","distance_px":1624851.0,"key_presses":7240,"clicks":1338,"active_seconds":17430},
            {"date":"2026-10-21","distance_px":1815800.0,"key_presses":7602,"clicks":1401,"active_seconds":18120},
            {"date":"2026-10-22","distance_px":1728000.0,"key_presses":6362,"clicks":1214,"active_seconds":16800},
            {"date":"2026-10-23","distance_px":2085412.0,"key_presses":8112,"clicks":1578,"active_seconds":19440},
            {"date":"2026-10-24","distance_px":1512334.0,"key_presses":5960,"clicks":1102,"active_seconds":14890},
            {"date":"2026-10-25","distance_px":1892178.0,"key_presses":7021,"clicks":1399,"active_seconds":17360},
            {"date":"2026-10-26","distance_px":1828155.0,"key_presses":5922,"clicks":1205,"active_seconds":15600}
        ],
        "hourly": [
            {"hour":0,"events":0,"active_seconds":0},{"hour":1,"events":0,"active_seconds":0},
            {"hour":2,"events":0,"active_seconds":0},{"hour":3,"events":0,"active_seconds":0},
            {"hour":4,"events":0,"active_seconds":0},{"hour":5,"events":0,"active_seconds":0},
            {"hour":6,"events":120,"active_seconds":210},{"hour":7,"events":980,"active_seconds":1550},
            {"hour":8,"events":2810,"active_seconds":3102},{"hour":9,"events":3400,"active_seconds":3480},
            {"hour":10,"events":3120,"active_seconds":3390},{"hour":11,"events":2910,"active_seconds":3180},
            {"hour":12,"events":680,"active_seconds":810},{"hour":13,"events":2200,"active_seconds":2680},
            {"hour":14,"events":3290,"active_seconds":3420},{"hour":15,"events":3700,"active_seconds":3510},
            {"hour":16,"events":3100,"active_seconds":3220},{"hour":17,"events":2100,"active_seconds":2360},
            {"hour":18,"events":620,"active_seconds":740},{"hour":19,"events":420,"active_seconds":510},
            {"hour":20,"events":180,"active_seconds":260},{"hour":21,"events":0,"active_seconds":0},
            {"hour":22,"events":0,"active_seconds":0},{"hour":23,"events":0,"active_seconds":0}
        ],
        "keys": [
            {"key_id":"space","label":"Space","count":6821},
            {"key_id":"e","label":"E","count":4560},
            {"key_id":"a","label":"A","count":3642},
            {"key_id":"t","label":"T","count":3411},
            {"key_id":"enter","label":"Enter","count":3129},
            {"key_id":"r","label":"R","count":2960},
            {"key_id":"s","label":"S","count":2650},
            {"key_id":"shift","label":"Shift","count":2544},
            {"key_id":"o","label":"O","count":2298},
            {"key_id":"i","label":"I","count":2190}
        ],
        "buttons": [
            {"button":"left","count":6841},
            {"button":"right","count":1840},
            {"button":"middle","count":324},
            {"button":"side1","count":124},
            {"button":"side2","count":74},
            {"button":"other_side","count":34}
        ],
        "data_coverage": {"minute_retention_hours":48,"hour_retention_days":90,"database_bytes":2840000}
    })).expect("demo snapshot fixture")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ButtonCount, KeyCount, PointerButton, TimeRange, Totals};
    use chrono::{NaiveDate, Utc};

    fn fixture() -> ExportBundle {
        ExportBundle {
            schema_version: 1,
            exported_at: Utc::now(),
            app_version: "0.1.0".into(),
            range: TimeRange {
                start_local_day: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
                end_local_day: NaiveDate::from_ymd_opt(2026, 10, 26).unwrap(),
            },
            timezone: "Asia/Shanghai".into(),
            totals: Totals::default(),
            daily: vec![],
            keys: vec![KeyCount {
                key_id: "space".into(),
                label: "Space".into(),
                count: 2,
            }],
            buttons: vec![ButtonCount {
                button: PointerButton::Left,
                count: 1,
            }],
            click_grid: Heatmap {
                columns: 24,
                rows: 16,
                cells: vec![0; 24 * 16],
                max_value: 0,
                filtered_total: 0,
            },
        }
    }

    #[test]
    fn json_export_contains_schema_version() {
        let json = build_json_export(&fixture()).unwrap();
        assert!(json.contains("\"schema_version\": 1"));
    }

    #[test]
    fn csv_bundle_has_no_individual_device_identifier() {
        let bundle = fixture();
        let files = build_csv_bundle(&bundle, &bundle.click_grid);
        assert_eq!(files.len(), 6);
        assert!(!files.iter().any(|(_, body)| body.contains("device_id")));
    }

    #[test]
    fn unsafe_filename_characters_are_replaced() {
        assert_eq!(sanitize_filename("轨迹 2026/10"), "轨迹-2026-10");
    }
}
