import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { demoStats, makeEmptyStats } from "./demo";
import type {
  AppSettings,
  CaptureState,
  Dashboard,
  Heatmap,
  LivePulse,
  PermissionState,
  StatsRequest,
} from "../types";

export const isTauri = "__TAURI_INTERNALS__" in window;
const DEMO_HEATMAP_TOTAL_RATIO = 0.92;

/** Browser-preview state, also used by tests. */
export const mockState: {
  paused: boolean;
  demo: boolean;
  updateSettingsError: boolean;
  settings: AppSettings;
} = {
  paused: false,
  demo: false,
  updateSettingsError: false,
  settings: {
    launch_at_login: false,
    check_updates: false,
    theme: "system",
    language: "system",
    shortcuts_enabled: true,
    onboarding_complete: false,
  },
};

/**
 * Dev-only browser preview shortcut: `?preview=keyboard` opens demo mode on
 * that page, skipping onboarding. Never active in builds or inside Tauri.
 */
export const previewSection: string | null =
  import.meta.env.DEV && !isTauri
    ? new URLSearchParams(window.location.search).get("preview")
    : null;
if (previewSection) {
  mockState.demo = true;
  mockState.settings.onboarding_complete = true;
}

function fallbackStatus(): CaptureState {
  return {
    status: mockState.paused ? "paused" : "active",
    message: mockState.demo ? "demo" : null,
    secure_input: false,
    demo_mode: mockState.demo,
    shortcut_error: null,
  };
}

/** Turns any rejected invoke payload into an Error with a readable message. */
function toError(cause: unknown): Error {
  if (cause instanceof Error) {
    return cause;
  }
  return new Error(typeof cause === "string" ? cause : "Unexpected error");
}

async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (cause) {
    throw toError(cause);
  }
}

export function emptyHeatmap(): Heatmap {
  return {
    columns: 24,
    rows: 16,
    cells: Array(24 * 16).fill(0),
    max_value: 0,
    filtered_total: 0,
  };
}

export function previewHeatmap(): Heatmap {
  const baseCells = Array.from({ length: 24 * 16 }, (_, index) => {
    const column = index % 24;
    const row = Math.floor(index / 24);
    const distance = Math.hypot(column - 9, row - 7);
    return Math.max(0, Math.round(180 - distance * 19));
  });
  const baseTotal = baseCells.reduce((sum, value) => sum + value, 0);
  const target = demoStats.totals.clicks * DEMO_HEATMAP_TOTAL_RATIO;
  const scale = baseTotal > 0 ? target / baseTotal : 0;
  const cells = baseCells.map((value) => Math.round(value * scale));
  return {
    columns: 24,
    rows: 16,
    cells,
    max_value: Math.max(...cells),
    filtered_total: cells.reduce((sum, value) => sum + value, 0),
  };
}

export async function getDashboard(request: StatsRequest): Promise<Dashboard> {
  if (!isTauri) {
    return mockState.demo
      ? { stats: demoStats, heatmap: previewHeatmap(), live_seq: 0 }
      : { stats: makeEmptyStats(), heatmap: emptyHeatmap(), live_seq: 0 };
  }
  return call<Dashboard>("get_dashboard", { request });
}

export async function getCaptureStatus(): Promise<CaptureState> {
  if (!isTauri) {
    return fallbackStatus();
  }
  return call<CaptureState>("get_capture_status");
}

export async function setLiveEnabled(enabled: boolean): Promise<void> {
  if (!isTauri) {
    return;
  }
  await call("set_live_enabled", { enabled });
}

/** Subscribes to a backend event; resolves to a no-op outside Tauri. */
export function subscribe<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) {
    return Promise.resolve(() => undefined);
  }
  return listen<T>(event, (message) => handler(message.payload));
}

export const onLivePulse = (handler: (pulse: LivePulse) => void) =>
  subscribe<LivePulse>("input-live", handler);
export const onStatsFlushed = (handler: (seq: number) => void) =>
  subscribe<number>("stats-flushed", handler);
export const onCaptureStatus = (handler: (state: CaptureState) => void) =>
  subscribe<CaptureState>("capture-status-changed", handler);
export const onSettingsChanged = (handler: (settings: AppSettings) => void) =>
  subscribe<AppSettings>("settings-changed", handler);

export async function pauseCapture(paused: boolean): Promise<CaptureState> {
  if (!isTauri) {
    mockState.paused = paused;
    return fallbackStatus();
  }
  return call<CaptureState>("pause_capture", { paused });
}

export async function requestInputPermission(): Promise<PermissionState> {
  if (!isTauri) {
    return { granted: true, platform: navigator.platform };
  }
  return call<PermissionState>("request_input_permission");
}

export async function openSystemSettings(section = "input_monitoring"): Promise<void> {
  if (!isTauri) {
    return;
  }
  await call("open_system_settings", { section });
}

export async function getSettings(): Promise<AppSettings> {
  if (!isTauri) {
    return { ...mockState.settings };
  }
  return call<AppSettings>("get_settings");
}

export async function updateSettings(settings: AppSettings): Promise<AppSettings> {
  if (!isTauri) {
    if (mockState.updateSettingsError) {
      throw new Error("settings update failed");
    }
    mockState.settings = { ...settings };
    return { ...settings };
  }
  return call<AppSettings>("update_settings", { settings });
}

export async function setDemoMode(enabled: boolean): Promise<CaptureState> {
  if (!isTauri) {
    mockState.demo = enabled;
    return fallbackStatus();
  }
  return call<CaptureState>("set_demo_mode", { enabled });
}

/** Opens a native save dialog and exports. Resolves to null if cancelled. */
export async function exportData(
  format: "json" | "zip",
  request: StatsRequest,
): Promise<string | null> {
  return call<string | null>("export_data", { request, format });
}

/** Sends PNG bytes as a raw IPC body; the backend opens the save dialog. */
export async function saveShareCard(png: Uint8Array): Promise<string | null> {
  return call<string | null>("save_share_card", png);
}

export async function createDiagnostics(): Promise<string | null> {
  return call<string | null>("create_diagnostics");
}

export async function clearData(): Promise<void> {
  if (!isTauri) {
    return;
  }
  await call("clear_data");
}
