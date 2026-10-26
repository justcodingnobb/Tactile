import type { StatsSnapshot } from "../types";

const dates = [
  "2026-10-20",
  "2026-10-21",
  "2026-10-22",
  "2026-10-23",
  "2026-10-24",
  "2026-10-25",
  "2026-10-26",
];

const distances = [
  1_624_851, 1_815_800, 1_728_000, 2_085_412, 1_512_334, 1_892_178,
  1_828_155,
];
const keys = [7_240, 7_602, 6_362, 8_112, 5_960, 7_021, 5_922];
const clicks = [1_338, 1_401, 1_214, 1_578, 1_102, 1_399, 1_205];
const active = [17_430, 18_120, 16_800, 19_440, 14_890, 17_360, 15_600];

export const demoStats: StatsSnapshot = {
  range: { start_local_day: "2026-10-20", end_local_day: "2026-10-26" },
  comparison_range: { start_local_day: "2026-10-13", end_local_day: "2026-10-19" },
  totals: {
    distance_px: 12_486_730,
    distance_km: 12.48673,
    key_presses: 48_219,
    shortcut_presses: 6_842,
    shortcut_ratio: 0.1419,
    clicks: 9_237,
    active_seconds: 119_640,
    wheel_up: 4_231,
    wheel_down: 3_712,
    left_clicks: 6_841,
    right_clicks: 1_840,
    middle_clicks: 324,
    side1_clicks: 124,
    side2_clicks: 74,
    other_clicks: 34,
  },
  comparison: {
    distance_ratio: 0.183,
    key_ratio: 0.074,
    click_ratio: -0.032,
    active_ratio: 0.112,
  },
  series: dates.map((date, index) => ({
    date,
    distance_px: distances[index],
    key_presses: keys[index],
    clicks: clicks[index],
    active_seconds: active[index],
  })),
  hourly: Array.from({ length: 24 }, (_, hour) => {
    const weights = [
      0, 0, 0, 0, 0, 0, 120, 980, 2_810, 3_400, 3_120, 2_910, 680,
      2_200, 3_290, 3_700, 3_100, 2_100, 620, 420, 180, 0, 0, 0,
    ];
    return {
      hour,
      events: weights[hour],
      active_seconds: Math.round(weights[hour] * 1.05),
    };
  }),
  keys: [
    { key_id: "space", label: "Space", count: 6_821 },
    { key_id: "e", label: "E", count: 4_560 },
    { key_id: "a", label: "A", count: 3_642 },
    { key_id: "t", label: "T", count: 3_411 },
    { key_id: "enter", label: "Enter", count: 3_129 },
    { key_id: "r", label: "R", count: 2_960 },
    { key_id: "s", label: "S", count: 2_650 },
    { key_id: "shift", label: "Shift", count: 2_544 },
    { key_id: "o", label: "O", count: 2_298 },
    { key_id: "i", label: "I", count: 2_190 },
  ],
  buttons: [
    { button: "left", count: 6_841 },
    { button: "right", count: 1_840 },
    { button: "middle", count: 324 },
    { button: "side1", count: 124 },
    { button: "side2", count: 74 },
    { button: "other_side", count: 34 },
  ],
  data_coverage: {
    minute_retention_hours: 48,
    hour_retention_days: 90,
    database_bytes: 2_840_000,
  },
};

export function makeEmptyStats(): StatsSnapshot {
  return {
    range: null,
    comparison_range: null,
    totals: {
      distance_px: 0,
      distance_km: 0,
      key_presses: 0,
      shortcut_presses: 0,
      shortcut_ratio: 0,
      clicks: 0,
      active_seconds: 0,
      wheel_up: 0,
      wheel_down: 0,
      left_clicks: 0,
      right_clicks: 0,
      middle_clicks: 0,
      side1_clicks: 0,
      side2_clicks: 0,
      other_clicks: 0,
    },
    comparison: {
      distance_ratio: null,
      key_ratio: null,
      click_ratio: null,
      active_ratio: null,
    },
    series: [],
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      events: 0,
      active_seconds: 0,
    })),
    keys: [],
    buttons: [
      { button: "left", count: 0 },
      { button: "right", count: 0 },
      { button: "middle", count: 0 },
      { button: "side1", count: 0 },
      { button: "side2", count: 0 },
      { button: "other_side", count: 0 },
    ],
    data_coverage: null,
  };
}
