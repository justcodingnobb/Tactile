import { invoke } from "@tauri-apps/api/core";
import { demoStats, makeEmptyStats } from "./demo";
import type {
  AppSettings,
  CaptureState,
  Heatmap,
  PermissionState,
  StatsRequest,
  StatsSnapshot,
} from "../types";

const isTauri = "__TAURI_INTERNALS__" in window;

export const mockState: {
  paused: boolean;
  demo: boolean;
  settings: AppSettings;
} = {
  paused: false,
  demo: false,
  settings: {
    launch_at_login: true,
    check_updates: false,
    theme: "system",
    language: "system",
    shortcuts_enabled: true,
    onboarding_complete: false,
  },
};

function fallbackStatus(): CaptureState {
  return {
    status: mockState.paused
      ? "paused"
      : mockState.demo
        ? "paused"
        : "active",
    message: mockState.demo ? "demo" : null,
    secure_input: false,
    demo_mode: mockState.demo,
  };
}

export async function getStats(
  request: StatsRequest = { preset: "week" },
): Promise<StatsSnapshot> {
  if (!isTauri) {
    return mockState.demo ? demoStats : makeEmptyStats();
  }
  return invoke<StatsSnapshot>("get_stats", { request });
}

export async function getClickHeatmap(
  request: StatsRequest = { preset: "week" },
): Promise<Heatmap> {
  if (!isTauri) {
    if (!mockState.demo) {
      return emptyHeatmap();
    }
    return previewHeatmap();
  }
  return invoke<Heatmap>("get_click_heatmap", { request });
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
  const cells = Array.from({ length: 24 * 16 }, (_, index) => {
    const column = index % 24;
    const row = Math.floor(index / 24);
    const distance = Math.hypot(column - 9, row - 7);
    return Math.max(0, Math.round(180 - distance * 19));
  });
  return {
    columns: 24,
    rows: 16,
    cells,
    max_value: Math.max(...cells),
    filtered_total: 8_921,
  };
}

export async function getCaptureStatus(): Promise<CaptureState> {
  if (!isTauri) {
    return fallbackStatus();
  }
  return invoke<CaptureState>("get_capture_status");
}

export async function pauseCapture(paused: boolean): Promise<CaptureState> {
  if (!isTauri) {
    mockState.paused = paused;
    return fallbackStatus();
  }
  return invoke<CaptureState>("pause_capture", { paused });
}

export async function requestInputPermission(): Promise<PermissionState> {
  if (!isTauri) {
    return { granted: true, platform: navigator.platform };
  }
  return invoke<PermissionState>("request_input_permission");
}

export async function openSystemSettings(section = "input_monitoring"): Promise<void> {
  if (!isTauri) {
    return;
  }
  return invoke("open_system_settings", { section });
}

export async function getSettings(): Promise<AppSettings> {
  if (!isTauri) {
    return mockState.settings;
  }
  return invoke<AppSettings>("get_settings");
}

export async function updateSettings(
  settings: AppSettings,
): Promise<AppSettings> {
  if (!isTauri) {
    mockState.settings = settings;
    return settings;
  }
  return invoke<AppSettings>("update_settings", { settings });
}

export async function setDemoMode(enabled: boolean): Promise<CaptureState> {
  if (!isTauri) {
    mockState.demo = enabled;
    return fallbackStatus();
  }
  return invoke<CaptureState>("set_demo_mode", { enabled });
}

export async function exportData(
  format: "json" | "zip",
  outputPath: string,
  request: StatsRequest,
): Promise<{ path: string; format: string }> {
  return invoke("export_data", {
    request: { ...request, format, outputPath },
  });
}

export async function exportShareCard(
  outputPath: string,
  bytes: Uint8Array,
): Promise<{ path: string; format: string }> {
  return invoke("write_binary_file", {
    path: outputPath,
    bytes: Array.from(bytes),
  });
}

export async function createDiagnostics(
  outputPath: string,
): Promise<{ path: string; format: string }> {
  return invoke("create_diagnostics", { outputPath });
}

export async function clearData(
  start?: string,
  end?: string,
): Promise<void> {
  if (!isTauri) {
    return;
  }
  return invoke("clear_data", { start, end });
}

export { isTauri };
