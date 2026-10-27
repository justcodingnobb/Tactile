import type { ButtonCount, Heatmap, KeyCount, LivePulse, StatsSnapshot } from "../types";

/**
 * Applies a live pulse to the currently displayed statistics.
 *
 * Counts are only added when the pulse is newer than the dashboard snapshot
 * (`pulse.seq > baseSeq`) and the pulse's day is inside the displayed range,
 * so an event is never shown twice and other ranges stay untouched.
 */
export function applyPulse(
  stats: StatsSnapshot,
  heatmap: Heatmap,
  pulse: LivePulse,
  baseSeq: number,
): { stats: StatsSnapshot; heatmap: Heatmap } | null {
  if (pulse.seq <= baseSeq || !inRange(stats, pulse.date) || !hasCounts(pulse)) {
    return null;
  }
  const presses = pulse.presses.reduce((sum, key) => sum + key.count, 0);
  const clicks = pulse.buttons.reduce((sum, button) => sum + button.count, 0);
  const totals = { ...stats.totals };
  totals.key_presses += presses;
  totals.shortcut_presses += pulse.shortcut_presses;
  totals.shortcut_ratio =
    totals.key_presses === 0 ? 0 : totals.shortcut_presses / totals.key_presses;
  totals.distance_px += pulse.distance_px;
  totals.distance_km = totals.distance_px / 1_000_000;
  totals.wheel_up += pulse.wheel_up;
  totals.wheel_down += pulse.wheel_down;
  totals.clicks += clicks;
  for (const button of pulse.buttons) {
    const field = `${button.button === "other_side" ? "other" : button.button}_clicks` as const;
    totals[field] += button.count;
  }
  const series = stats.series.some((point) => point.date === pulse.date)
    ? stats.series.map((point) =>
        point.date === pulse.date
          ? {
              ...point,
              key_presses: point.key_presses + presses,
              clicks: point.clicks + clicks,
              distance_px: point.distance_px + pulse.distance_px,
            }
          : point,
      )
    : stats.series;
  return {
    stats: {
      ...stats,
      totals,
      series,
      keys: mergeKeys(stats.keys, pulse.presses),
      buttons: mergeButtons(stats.buttons, pulse.buttons),
    },
    heatmap: mergeCells(heatmap, pulse.click_cells),
  };
}

export function hasCounts(pulse: LivePulse): boolean {
  return (
    pulse.presses.length > 0 ||
    pulse.buttons.length > 0 ||
    pulse.distance_px > 0 ||
    pulse.wheel_up > 0 ||
    pulse.wheel_down > 0
  );
}

function inRange(stats: StatsSnapshot, date: string | null): boolean {
  if (!date || !stats.range) {
    return false;
  }
  return date >= stats.range.start_local_day && date <= stats.range.end_local_day;
}

/** Adds counts and returns keys sorted by count, then label (matches the backend). */
export function mergeKeys(keys: KeyCount[], presses: KeyCount[]): KeyCount[] {
  if (presses.length === 0) {
    return keys;
  }
  const merged = new Map(keys.map((key) => [key.key_id, { ...key }]));
  for (const press of presses) {
    const existing = merged.get(press.key_id);
    if (existing) {
      existing.count += press.count;
    } else {
      merged.set(press.key_id, { ...press });
    }
  }
  return [...merged.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

function mergeButtons(buttons: ButtonCount[], added: ButtonCount[]): ButtonCount[] {
  if (added.length === 0) {
    return buttons;
  }
  const result = buttons.map((button) => ({ ...button }));
  for (const item of added) {
    const existing = result.find((button) => button.button === item.button);
    if (existing) {
      existing.count += item.count;
    } else {
      result.push({ ...item });
    }
  }
  return result;
}

function mergeCells(heatmap: Heatmap, cells: number[]): Heatmap {
  if (cells.length === 0) {
    return heatmap;
  }
  const next = [...heatmap.cells];
  let added = 0;
  for (const index of cells) {
    if (index >= 0 && index < next.length) {
      next[index] += 1;
      added += 1;
    }
  }
  return {
    ...heatmap,
    cells: next,
    max_value: Math.max(heatmap.max_value, ...cells.map((index) => next[index] ?? 0)),
    filtered_total: heatmap.filtered_total + added,
  };
}
