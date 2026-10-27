import { describe, expect, it } from "vitest";
import { applyPulse, mergeKeys } from "./live";
import { makeEmptyStats } from "./demo";
import { emptyHeatmap } from "./ipc";
import type { LivePulse, StatsSnapshot } from "../types";

function stats(): StatsSnapshot {
  return {
    ...makeEmptyStats(),
    range: { start_local_day: "2026-10-26", end_local_day: "2026-10-27" },
    keys: [{ key_id: "a", label: "A", count: 2 }],
    series: [
      { date: "2026-10-27", distance_px: 0, key_presses: 2, clicks: 0, active_seconds: 0 },
    ],
  };
}

function pulse(overrides: Partial<LivePulse> = {}): LivePulse {
  return {
    seq: 5,
    date: "2026-10-27",
    down: [],
    up: [],
    presses: [{ key_id: "b", label: "B", count: 3 }],
    shortcut_presses: 1,
    distance_px: 0,
    buttons: [{ button: "left", count: 1 }],
    click_cells: [10],
    wheel_up: 0,
    wheel_down: 0,
    ...overrides,
  };
}

describe("applyPulse", () => {
  it("adds counts, re-ranks keys and updates the heatmap", () => {
    const result = applyPulse(stats(), emptyHeatmap(), pulse(), 4);
    expect(result).not.toBeNull();
    expect(result!.stats.totals.key_presses).toBe(3);
    expect(result!.stats.keys[0]).toEqual({ key_id: "b", label: "B", count: 3 });
    expect(result!.stats.series[0].key_presses).toBe(5);
    expect(result!.stats.totals.left_clicks).toBe(1);
    expect(result!.heatmap.cells[10]).toBe(1);
    expect(result!.heatmap.filtered_total).toBe(1);
  });

  it("ignores pulses already included in the snapshot", () => {
    expect(applyPulse(stats(), emptyHeatmap(), pulse({ seq: 4 }), 4)).toBeNull();
  });

  it("ignores pulses outside the displayed range", () => {
    expect(applyPulse(stats(), emptyHeatmap(), pulse({ date: "2026-10-28" }), 0)).toBeNull();
  });

  it("ignores animation-only pulses", () => {
    const visual = pulse({ presses: [], buttons: [], click_cells: [], down: ["shift"] });
    expect(applyPulse(stats(), emptyHeatmap(), visual, 0)).toBeNull();
  });
});

describe("mergeKeys", () => {
  it("keeps original order when nothing is added", () => {
    const keys = stats().keys;
    expect(mergeKeys(keys, [])).toBe(keys);
  });
});
