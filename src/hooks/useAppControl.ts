import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { dictionary } from "../i18n";
import { applyTheme, defaultSettings, resolveLanguage } from "../lib/format";
import {
  clearData,
  createDiagnostics,
  exportData,
  getCaptureStatus,
  getSettings,
  isTauri,
  onCaptureStatus,
  onSettingsChanged,
  openSystemSettings,
  pauseCapture,
  requestInputPermission,
  saveShareCard,
  setDemoMode,
  updateSettings,
} from "../lib/ipc";
import type { AppSettings, CaptureState, StatsRequest } from "../types";
import { useUpdater } from "./useUpdater";

const initialStatus: CaptureState = {
  status: "active",
  message: null,
  secure_input: false,
  demo_mode: false,
  shortcut_error: null,
};

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Settings, capture status and every user action that talks to the backend. */
export function useAppControl(notify: (message: string) => void) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [status, setStatus] = useState<CaptureState>(initialStatus);
  const [ready, setReady] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const t = dictionary(resolveLanguage(settings.language));
  const tRef = useRef(t);
  tRef.current = t;
  const updater = useUpdater(settings, ready, notify);

  useEffect(() => {
    let active = true;
    Promise.all([getSettings(), getCaptureStatus()])
      .then(([nextSettings, nextStatus]) => {
        if (!active) {
          return;
        }
        setSettings(nextSettings);
        setStatus(nextStatus);
        setOnboarding(!nextSettings.onboarding_complete && !nextStatus.demo_mode);
      })
      .catch(() => active && setOnboarding(true))
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => settingsRef.current.theme === "system" && applyTheme("system");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [settings.theme]);

  useEffect(() => {
    let disposed = false;
    const unlisten: UnlistenFn[] = [];
    const keep = (fn: UnlistenFn) => (disposed ? fn() : unlisten.push(fn));
    onCaptureStatus(setStatus).then(keep).catch(() => undefined);
    onSettingsChanged(setSettings).then(keep).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const previous = settingsRef.current;
      const next = { ...previous, ...patch };
      setSettings(next);
      try {
        setSettings(await updateSettings(next));
      } catch (cause) {
        setSettings(previous);
        notify(`${tRef.current.errors.generic} ${errorText(cause)}`);
      }
    },
    [notify],
  );

  const togglePause = useCallback(async () => {
    try {
      setStatus(await pauseCapture(status.status !== "paused"));
    } catch {
      notify(tRef.current.errors.generic);
    }
  }, [notify, status.status]);

  const finishOnboarding = useCallback(async () => {
    setOnboarding(false);
    await saveSettings({ onboarding_complete: true });
  }, [saveSettings]);

  const enterDemo = useCallback(async () => {
    try {
      setStatus(await setDemoMode(true));
      setOnboarding(false);
    } catch {
      notify(tRef.current.errors.generic);
    }
  }, [notify]);

  const leaveDemo = useCallback(async () => {
    try {
      setStatus(await setDemoMode(false));
      if (!settingsRef.current.onboarding_complete) {
        await saveSettings({ onboarding_complete: true });
      }
    } catch {
      notify(tRef.current.errors.generic);
    }
  }, [notify, saveSettings]);

  const grantPermission = useCallback(async () => {
    const zh = resolveLanguage(settingsRef.current.language) === "zh";
    try {
      const result = await requestInputPermission();
      if (result.granted) {
        notify(zh ? "输入监控已授权。" : "Input Monitoring granted.");
      } else {
        notify(
          zh
            ? "请在系统设置中允许 指痕（Tactile），然后返回应用。"
            : "Allow Tactile in System Settings, then come back.",
        );
        await openSystemSettings("input_monitoring");
      }
      setStatus(await getCaptureStatus());
    } catch {
      notify(tRef.current.errors.generic);
    }
  }, [notify]);

  /** Runs a file action with a busy flag; returns the saved path or null. */
  const runFile = useCallback(
    async (action: () => Promise<string | null>, done: (path: string) => string) => {
      if (!isTauri) {
        notify(tRef.current.errors.noTauri);
        return null;
      }
      setBusy(true);
      try {
        const path = await action();
        if (path) {
          notify(done(path));
        }
        return path;
      } catch (cause) {
        notify(`${tRef.current.errors.generic} ${errorText(cause)}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const zh = () => resolveLanguage(settingsRef.current.language) === "zh";
  const exportFile = (format: "json" | "zip", request: StatsRequest) =>
    runFile(
      () => exportData(format, request),
      (path) => (zh() ? `已导出到 ${path}` : `Exported to ${path}`),
    );
  const saveCard = (png: Uint8Array) =>
    runFile(
      () => saveShareCard(png),
      (path) => (zh() ? `分享卡已保存到 ${path}` : `Share card saved to ${path}`),
    );
  const diagnostics = () =>
    void runFile(createDiagnostics, () => (zh() ? "诊断包已导出。" : "Diagnostics exported."));

  const clear = useCallback(async () => {
    setBusy(true);
    try {
      await clearData();
      notify(resolveLanguage(settingsRef.current.language) === "zh" ? "数据已清除。" : "Data cleared.");
      return true;
    } catch (cause) {
      notify(`${tRef.current.errors.generic} ${errorText(cause)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [notify]);

  return {
    settings,
    updater,
    status,
    ready,
    onboarding,
    busy,
    saveSettings,
    togglePause,
    finishOnboarding,
    enterDemo,
    leaveDemo,
    grantPermission,
    exportFile,
    saveCard,
    diagnostics,
    clear,
  };
}
