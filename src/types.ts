export type PointerButton =
  | "left"
  | "right"
  | "middle"
  | "side1"
  | "side2"
  | "other_side";

export type CaptureStatus =
  | "active"
  | "paused"
  | "permission_required"
  | "secure_input"
  | "storage_error"
  | "hook_error";

export type ThemePreference = "system" | "light" | "dark";
export type LanguagePreference = "system" | "zh" | "en";
export type RangePreset = "today" | "week" | "month" | "year" | "custom";

export interface CaptureState {
  status: CaptureStatus;
  message: string | null;
  secure_input: boolean;
  demo_mode: boolean;
}

export interface TimeRange {
  start_local_day: string;
  end_local_day: string;
}

export interface Totals {
  distance_px: number;
  distance_km: number;
  key_presses: number;
  shortcut_presses: number;
  shortcut_ratio: number;
  clicks: number;
  active_seconds: number;
  wheel_up: number;
  wheel_down: number;
  left_clicks: number;
  right_clicks: number;
  middle_clicks: number;
  side1_clicks: number;
  side2_clicks: number;
  other_clicks: number;
}

export interface Comparison {
  distance_ratio: number | null;
  key_ratio: number | null;
  click_ratio: number | null;
  active_ratio: number | null;
}

export interface SeriesPoint {
  date: string;
  distance_px: number;
  key_presses: number;
  clicks: number;
  active_seconds: number;
}

export interface HourlyPoint {
  hour: number;
  events: number;
  active_seconds: number;
}

export interface KeyCount {
  key_id: string;
  label: string;
  count: number;
}

export interface ButtonCount {
  button: PointerButton;
  count: number;
}

export interface Coverage {
  minute_retention_hours: number;
  hour_retention_days: number;
  database_bytes: number;
}

export interface StatsSnapshot {
  range: TimeRange | null;
  comparison_range: TimeRange | null;
  totals: Totals;
  comparison: Comparison;
  series: SeriesPoint[];
  hourly: HourlyPoint[];
  keys: KeyCount[];
  buttons: ButtonCount[];
  data_coverage: Coverage | null;
}

export interface Heatmap {
  columns: number;
  rows: number;
  cells: number[];
  max_value: number;
  filtered_total: number;
}

export interface AppSettings {
  launch_at_login: boolean;
  check_updates: boolean;
  theme: ThemePreference;
  language: LanguagePreference;
  shortcuts_enabled: boolean;
  onboarding_complete: boolean;
}

export interface ShareCardConfig {
  show_active_seconds: boolean;
  show_comparison: boolean;
  show_top_key: boolean;
}

export type AppSection =
  | "overview"
  | "mouse"
  | "keyboard"
  | "trends"
  | "settings";

export interface StatsRequest {
  preset?: RangePreset;
  start?: string;
  end?: string;
}

export interface PermissionState {
  granted: boolean;
  platform: string;
}
