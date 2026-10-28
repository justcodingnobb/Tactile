import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../types";
import {
  AUTO_CHECK_DELAY_MS,
  LAST_UPDATE_CHECK_KEY,
  UPDATE_CHECK_INTERVAL_MS,
  writeLastUpdateCheck,
} from "../lib/updater";

const ipc = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  installPendingUpdate: vi.fn(),
  relaunchApp: vi.fn(),
}));

vi.mock("../lib/ipc", () => ipc);

import { useUpdater } from "./useUpdater";

const settings: AppSettings = {
  launch_at_login: false,
  check_updates: true,
  theme: "system",
  language: "en",
  shortcuts_enabled: true,
  onboarding_complete: true,
};

const availableUpdate = {
  kind: "available" as const,
  update: {
    version: "0.2.0",
    notes: "Changes",
    date: "2026-10-27T00:00:00Z",
  },
};

describe("useUpdater", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("moves from checking to available", async () => {
    ipc.checkForUpdate.mockResolvedValue(availableUpdate);
    const notify = vi.fn();
    const { result } = renderHook(() => useUpdater(settings, true, notify));

    await act(async () => {
      await result.current.check({ manual: true });
    });

    expect(ipc.checkForUpdate).toHaveBeenCalledWith(true);
    expect(result.current.phase).toEqual({
      kind: "available",
      version: "0.2.0",
      notes: "Changes",
      date: "2026-10-27T00:00:00Z",
    });
  });

  it("reports download progress before reaching ready", async () => {
    let finishInstall!: () => void;
    ipc.checkForUpdate.mockResolvedValue(availableUpdate);
    ipc.installPendingUpdate.mockImplementation(
      (onProgress: (progress: number | null) => void) =>
        new Promise<void>((resolve) => {
          onProgress(0.42);
          finishInstall = resolve;
        }),
    );
    const { result } = renderHook(() => useUpdater(settings, true, vi.fn()));

    await act(async () => {
      await result.current.check({ manual: true });
    });
    act(() => {
      void result.current.install();
    });

    await waitFor(() => {
      expect(result.current.phase).toEqual({ kind: "downloading", progress: 0.42 });
    });

    await act(async () => {
      finishInstall();
      await Promise.resolve();
    });
    expect(result.current.phase).toEqual({ kind: "ready" });
  });

  it("moves to error when there is no pending update handle", async () => {
    ipc.checkForUpdate.mockResolvedValue(availableUpdate);
    ipc.installPendingUpdate.mockRejectedValue(
      new Error("No update is ready to install."),
    );
    const notify = vi.fn();
    const { result } = renderHook(() => useUpdater(settings, true, notify));

    await act(async () => {
      await result.current.check({ manual: true });
    });
    await act(async () => {
      await result.current.install();
    });

    expect(result.current.phase).toEqual({
      kind: "error",
      detail: "No update is ready to install.",
    });
    expect(notify).toHaveBeenCalledOnce();
  });

  it("does not check again while an update is downloading or ready", async () => {
    vi.useFakeTimers();
    ipc.checkForUpdate.mockResolvedValue(availableUpdate);
    ipc.installPendingUpdate.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUpdater(settings, true, vi.fn()));

    await act(async () => {
      await result.current.check({ manual: true });
    });
    await act(async () => {
      await result.current.install();
    });
    expect(result.current.phase).toEqual({ kind: "ready" });

    window.localStorage.removeItem(LAST_UPDATE_CHECK_KEY);
    await act(async () => {
      await result.current.check({ manual: true });
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    });

    expect(ipc.checkForUpdate).toHaveBeenCalledOnce();
  });

  it("dismisses the current update banner", async () => {
    ipc.checkForUpdate.mockResolvedValue(availableUpdate);
    const { result } = renderHook(() => useUpdater(settings, true, vi.fn()));

    await act(async () => {
      await result.current.check({ manual: true });
    });
    expect(result.current.bannerVisible).toBe(true);

    act(() => result.current.dismiss());

    expect(result.current.bannerVisible).toBe(false);
  });

  it("throttles automatic checks for 24 hours using fake timers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T00:00:00Z"));
    writeLastUpdateCheck(Date.now() - UPDATE_CHECK_INTERVAL_MS - 1);
    ipc.checkForUpdate.mockResolvedValue({ kind: "upToDate" });
    const { result } = renderHook(() => useUpdater(settings, true, vi.fn()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_CHECK_DELAY_MS);
    });
    expect(ipc.checkForUpdate).toHaveBeenCalledOnce();
    expect(ipc.checkForUpdate).toHaveBeenCalledWith(false);
    expect(result.current.phase).toEqual({ kind: "upToDate" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    expect(ipc.checkForUpdate).toHaveBeenCalledOnce();
  });
});
