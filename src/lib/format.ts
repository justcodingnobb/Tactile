import type { AppSettings, LanguagePreference } from "../types";

export type Language = "zh" | "en";

export function resolveLanguage(
  preference: LanguagePreference,
  browserLanguage = navigator.language,
): Language {
  if (preference === "zh" || preference === "en") {
    return preference;
  }
  return browserLanguage.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function compactNumber(value: number, language: Language): string {
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value);
}

export function fullNumber(value: number, language: Language): string {
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDistance(km: number, language: Language): string {
  if (km < 0.1) {
    return `${fullNumber(km * 1_000, language)} m`;
  }
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", {
    minimumFractionDigits: km < 10 ? 2 : 1,
    maximumFractionDigits: km < 10 ? 2 : 1,
  }).format(km);
}

export function formatDuration(seconds: number, language: Language): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) {
    return `${minutes}m`;
  }
  return language === "zh" ? `${hours}小时 ${minutes}分` : `${hours}h ${minutes}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

export function formatDate(date: string, language: Language): string {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

export function formatDateRange(
  start: string,
  end: string,
  language: Language,
): string {
  const formatter = new Intl.DateTimeFormat(
    language === "zh" ? "zh-CN" : "en-US",
    { year: "numeric", month: "short", day: "numeric" },
  );
  return `${formatter.format(new Date(`${start}T12:00:00`))} — ${formatter.format(
    new Date(`${end}T12:00:00`),
  )}`;
}

export function todayIso(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function weekStartIso(): string {
  const date = new Date();
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date.toISOString().slice(0, 10);
}

export function defaultSettings(): AppSettings {
  return {
    launch_at_login: true,
    check_updates: false,
    theme: "system",
    language: "system",
    shortcuts_enabled: true,
    onboarding_complete: false,
  };
}

export function applyTheme(theme: AppSettings["theme"]): void {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
