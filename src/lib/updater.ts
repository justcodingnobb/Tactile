import type { AppSettings } from "../types";
import type { Dictionary } from "../i18n";

export const LAST_UPDATE_CHECK_KEY = "tactile.lastUpdateCheck";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AUTO_CHECK_DELAY_MS = 10_000;

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string | null;
}

export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | ({ kind: "available" } & UpdateInfo)
  | { kind: "downloading"; progress: number | null }
  | { kind: "ready" }
  | { kind: "upToDate" }
  | { kind: "error"; detail: string | null };

export function readLastUpdateCheck(now = Date.now()): number | null {
  try {
    const value = Number(window.localStorage.getItem(LAST_UPDATE_CHECK_KEY));
    return Number.isFinite(value) && value > 0 && value <= now ? value : null;
  } catch {
    return null;
  }
}

export function writeLastUpdateCheck(timestamp = Date.now()): void {
  try {
    window.localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(timestamp));
  } catch {
    // Storage can be disabled; throttling is best effort in that case.
  }
}

export function shouldAutoCheck(
  settings: Pick<AppSettings, "check_updates">,
  now = Date.now(),
): boolean {
  if (!settings.check_updates) {
    return false;
  }
  const last = readLastUpdateCheck(now);
  return last === null || now - last >= UPDATE_CHECK_INTERVAL_MS;
}

export function updateErrorDetail(cause: unknown): string | null {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const detail = raw.trim();
  if (!detail) {
    return null;
  }
  return detail.length > 160 ? `${detail.slice(0, 157)}...` : detail;
}

export function downloadProgress(
  downloaded: number,
  contentLength: number | null,
): number | null {
  if (!contentLength || contentLength <= 0 || !Number.isFinite(downloaded)) {
    return null;
  }
  return Math.max(0, Math.min(1, downloaded / contentLength));
}

function withCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}

export function relativeCheckTime(timestamp: number | null, t: Dictionary): string {
  if (timestamp === null) {
    return t.updates.notChecked;
  }
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) {
    return t.updates.justNow;
  }
  if (minutes < 60) {
    return withCount(t.updates.minutesAgo, minutes);
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return withCount(t.updates.hoursAgo, hours);
  }
  const days = Math.floor(hours / 24);
  return withCount(t.updates.daysAgo, days);
}

export function updateSettingsLabel(
  phase: UpdatePhase,
  t: Dictionary,
): string | null {
  if (phase.kind === "checking") {
    return t.settings.checking;
  }
  if (phase.kind === "upToDate") {
    return t.settings.upToDate;
  }
  if (phase.kind === "available") {
    return t.updates.available.replace("{version}", phase.version);
  }
  if (phase.kind === "downloading") {
    return t.updates.downloading;
  }
  if (phase.kind === "ready") {
    return t.updates.ready;
  }
  if (phase.kind === "error") {
    return t.settings.updateFailed;
  }
  return null;
}
