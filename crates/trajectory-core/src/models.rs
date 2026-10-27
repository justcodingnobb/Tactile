use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PointerButton {
    Left,
    Right,
    Middle,
    Side1,
    Side2,
    OtherSide,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModifierSet {
    pub shift: bool,
    pub control: bool,
    pub alt: bool,
    pub meta: bool,
    pub caps_lock: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RawInputEvent {
    PointerMove {
        dx_dip: f64,
        dy_dip: f64,
    },
    ButtonDown {
        button: u8,
        point: Option<Point>,
    },
    Wheel {
        delta_y: f64,
    },
    KeyDown {
        code: u32,
        key: Option<char>,
        modifiers: ModifierSet,
        is_repeat: bool,
    },
    KeyUp {
        code: u32,
    },
    SecureInputChanged {
        active: bool,
    },
    HookError {
        message: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InputEvent {
    PointerMove {
        dx_dip: f64,
        dy_dip: f64,
    },
    ButtonDown {
        button: PointerButton,
        point: Option<Point>,
    },
    Wheel {
        delta_y: f64,
    },
    KeyPress {
        key: KeyIdentity,
        modifiers: ModifierSet,
        shortcut: bool,
    },
    SecureInputChanged {
        active: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct KeyIdentity {
    pub id: String,
    pub label: String,
    pub is_modifier: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Granularity {
    Minute,
    Hour,
    Day,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct BucketMetrics {
    pub distance_px: f64,
    pub wheel_up: f64,
    pub wheel_down: f64,
    pub left_clicks: u64,
    pub right_clicks: u64,
    pub middle_clicks: u64,
    pub side1_clicks: u64,
    pub side2_clicks: u64,
    pub other_clicks: u64,
    pub key_presses: u64,
    pub shortcut_presses: u64,
    pub active_seconds: u64,
    pub click_cells: Vec<u64>,
    pub keys: Vec<(String, u64)>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AggregatedBucket {
    pub start_utc: DateTime<Utc>,
    pub local_date: NaiveDate,
    pub local_hour: u8,
    pub granularity: Granularity,
    pub metrics: BucketMetrics,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeRange {
    pub start_local_day: NaiveDate,
    pub end_local_day: NaiveDate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RangePreset {
    Today,
    Week,
    Month,
    Year,
    Custom,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Totals {
    pub distance_px: f64,
    pub distance_km: f64,
    pub key_presses: u64,
    pub shortcut_presses: u64,
    pub shortcut_ratio: f64,
    pub clicks: u64,
    pub active_seconds: u64,
    pub wheel_up: f64,
    pub wheel_down: f64,
    pub left_clicks: u64,
    pub right_clicks: u64,
    pub middle_clicks: u64,
    pub side1_clicks: u64,
    pub side2_clicks: u64,
    pub other_clicks: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Comparison {
    pub distance_ratio: Option<f64>,
    pub key_ratio: Option<f64>,
    pub click_ratio: Option<f64>,
    pub active_ratio: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SeriesPoint {
    pub date: NaiveDate,
    pub distance_px: f64,
    pub key_presses: u64,
    pub clicks: u64,
    pub active_seconds: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct HourlyPoint {
    pub hour: u8,
    pub events: u64,
    pub active_seconds: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct StatsSnapshot {
    pub range: Option<TimeRange>,
    pub comparison_range: Option<TimeRange>,
    pub totals: Totals,
    pub comparison: Comparison,
    pub series: Vec<SeriesPoint>,
    pub hourly: Vec<HourlyPoint>,
    pub keys: Vec<KeyCount>,
    pub buttons: Vec<ButtonCount>,
    pub data_coverage: Option<Coverage>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Coverage {
    pub minute_retention_hours: u64,
    pub hour_retention_days: u64,
    pub database_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyCount {
    pub key_id: String,
    pub label: String,
    pub count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ButtonCount {
    pub button: PointerButton,
    pub count: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Heatmap {
    pub columns: usize,
    pub rows: usize,
    pub cells: Vec<u64>,
    pub max_value: u64,
    pub filtered_total: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureStatus {
    Active,
    Paused,
    PermissionRequired,
    SecureInput,
    StorageError,
    HookError,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptureState {
    pub status: CaptureStatus,
    pub message: Option<String>,
    pub secure_input: bool,
    pub demo_mode: bool,
    /// Global shortcut registration problem; informational, not a capture fault.
    #[serde(default)]
    pub shortcut_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemePreference {
    System,
    Light,
    Dark,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LanguagePreference {
    System,
    Zh,
    En,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppSettings {
    pub launch_at_login: bool,
    pub check_updates: bool,
    pub theme: ThemePreference,
    pub language: LanguagePreference,
    pub shortcuts_enabled: bool,
    pub onboarding_complete: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            // Opt-in: registering a login item should be the user's choice.
            launch_at_login: false,
            check_updates: false,
            theme: ThemePreference::System,
            language: LanguagePreference::System,
            shortcuts_enabled: true,
            onboarding_complete: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExportBundle {
    pub schema_version: u32,
    pub exported_at: DateTime<Utc>,
    pub app_version: String,
    pub range: TimeRange,
    pub timezone: String,
    pub totals: Totals,
    pub daily: Vec<SeriesPoint>,
    pub keys: Vec<KeyCount>,
    pub buttons: Vec<ButtonCount>,
    pub click_grid: Heatmap,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShareCardConfig {
    pub show_active_seconds: bool,
    pub show_comparison: bool,
    pub show_top_key: bool,
}

/// Real-time input delta pushed to the dashboard while it is visible.
///
/// `seq` increases with every pulse. Counted fields are only applied by the UI
/// when `seq` is newer than the `live_seq` of its latest [`Dashboard`]; the
/// visual `down`/`up` lists are always applied.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct LivePulse {
    pub seq: u64,
    pub date: Option<NaiveDate>,
    /// Physical keys that went down (including modifiers), for animation.
    pub down: Vec<String>,
    /// Physical keys that were released.
    pub up: Vec<String>,
    /// Counted key presses, matching the ids stored in statistics.
    pub presses: Vec<KeyCount>,
    pub shortcut_presses: u64,
    pub distance_px: f64,
    pub buttons: Vec<ButtonCount>,
    pub click_cells: Vec<usize>,
    pub wheel_up: f64,
    pub wheel_down: f64,
}

impl LivePulse {
    pub fn has_counts(&self) -> bool {
        !self.presses.is_empty()
            || !self.buttons.is_empty()
            || self.distance_px > 0.0
            || self.wheel_up > 0.0
            || self.wheel_down > 0.0
    }

    pub fn is_empty(&self) -> bool {
        !self.has_counts() && self.down.is_empty() && self.up.is_empty()
    }

    /// Drops counted data that a statistics snapshot already includes.
    pub fn clear_counts(&mut self) {
        let down = std::mem::take(&mut self.down);
        let up = std::mem::take(&mut self.up);
        *self = Self {
            down,
            up,
            ..Self::default()
        };
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Dashboard {
    pub stats: StatsSnapshot,
    pub heatmap: Heatmap,
    /// Last pulse whose counts are already part of `stats`.
    pub live_seq: u64,
}
