import type { AppSettings } from "../types";

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
  | { kind: "error"; message: string };

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

export function updateErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const message = raw.trim();
  if (!message) {
    return "Update check failed.";
  }
  if (/404|not found/i.test(message)) {
    return "Update information is not available yet (404).";
  }
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
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

export function relativeCheckTime(timestamp: number | null, language: "zh" | "en"): string {
  if (timestamp === null) {
    return language === "zh" ? "尚未检查" : "Not checked yet";
  }
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) {
    return language === "zh" ? "刚刚" : "Just now";
  }
  if (minutes < 60) {
    return language === "zh" ? `${minutes} 分钟前` : `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return language === "zh" ? `${hours} 小时前` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return language === "zh" ? `${days} 天前` : `${days}d ago`;
}

export function updateSettingsLabel(
  phase: UpdatePhase,
  language: "zh" | "en",
): string | null {
  if (phase.kind === "checking") {
    return language === "zh" ? "正在检查…" : "Checking…";
  }
  if (phase.kind === "upToDate") {
    return language === "zh" ? "已是最新版本" : "You're up to date";
  }
  if (phase.kind === "available") {
    return language === "zh"
      ? `发现新版本 v${phase.version}`
      : `Version ${phase.version} is available`;
  }
  if (phase.kind === "downloading" || phase.kind === "ready") {
    return language === "zh"
      ? "更新已下载，重启后完成安装"
      : "Update downloaded; restart to finish";
  }
  if (phase.kind === "error") {
    return language === "zh"
      ? `检查失败：${phase.message ?? ""}`
      : `Check failed: ${phase.message ?? ""}`;
  }
  return null;
}
