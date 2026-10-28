import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updater = vi.hoisted(() => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: updater.check,
}));

function fakeUpdate() {
  return {
    version: "0.2.0",
    body: "Changes",
    date: "2026-10-27T00:00:00Z",
    close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn(
      async (onEvent?: (event: {
        event: "Started" | "Progress" | "Finished";
        data: { contentLength?: number; chunkLength?: number };
      }) => void) => {
        onEvent?.({ event: "Started", data: { contentLength: 100 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 20 } });
        onEvent?.({ event: "Finished", data: {} });
      },
    ),
  };
}

describe("updater IPC lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    updater.check.mockReset();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("closes a replaced update handle without closing the current one", async () => {
    const first = fakeUpdate();
    const second = fakeUpdate();
    updater.check.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { checkForUpdate } = await import("./ipc");

    await checkForUpdate(true);
    await checkForUpdate(true);

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
  });

  it("closes the previous handle when a later check finds no update", async () => {
    const first = fakeUpdate();
    updater.check.mockResolvedValueOnce(first).mockResolvedValueOnce(null);
    const { checkForUpdate } = await import("./ipc");

    await checkForUpdate(true);
    await expect(checkForUpdate(true)).resolves.toEqual({ kind: "upToDate" });

    expect(first.close).toHaveBeenCalledOnce();
  });

  it("reports download progress and releases the handle after installation", async () => {
    const update = fakeUpdate();
    updater.check.mockResolvedValueOnce(update);
    const { checkForUpdate, installPendingUpdate } = await import("./ipc");
    const progress: Array<number | null> = [];

    await checkForUpdate(true);
    await installPendingUpdate((value) => progress.push(value));

    expect(progress).toEqual([0, 0.4, 0.6, 1]);
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(update.close).toHaveBeenCalledOnce();
  });

  it("rejects installation when no downloaded update handle is pending", async () => {
    const { installPendingUpdate } = await import("./ipc");

    await expect(installPendingUpdate(() => undefined)).rejects.toThrow(
      "No update is ready to install.",
    );
  });
});
