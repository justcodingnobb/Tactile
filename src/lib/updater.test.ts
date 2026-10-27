import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAST_UPDATE_CHECK_KEY,
  UPDATE_CHECK_INTERVAL_MS,
  downloadProgress,
  readLastUpdateCheck,
  relativeCheckTime,
  shouldAutoCheck,
  updateErrorMessage,
  updateSettingsLabel,
  writeLastUpdateCheck,
} from "./updater";

describe("update check throttling", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("checks when updates are enabled and no timestamp exists", () => {
    expect(shouldAutoCheck({ check_updates: true }, 1_000)).toBe(true);
  });

  it("does not check when updates are disabled", () => {
    expect(shouldAutoCheck({ check_updates: false }, 1_000)).toBe(false);
  });

  it("checks again only after 24 hours", () => {
    writeLastUpdateCheck(1_000);
    expect(shouldAutoCheck({ check_updates: true }, 1_000 + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(
      false,
    );
    expect(shouldAutoCheck({ check_updates: true }, 1_000 + UPDATE_CHECK_INTERVAL_MS)).toBe(true);
  });

  it("treats a fresh check as current for the next 24 hours", () => {
    const now = 10_000;
    writeLastUpdateCheck(now);
    expect(shouldAutoCheck({ check_updates: true }, now + 12 * 60 * 60 * 1000)).toBe(false);
  });

  it("ignores invalid or future timestamps", () => {
    window.localStorage.setItem(LAST_UPDATE_CHECK_KEY, "not-a-number");
    expect(readLastUpdateCheck(1_000)).toBeNull();
    window.localStorage.setItem(LAST_UPDATE_CHECK_KEY, "2000");
    expect(readLastUpdateCheck(1_000)).toBeNull();
  });
});

describe("update display helpers", () => {
  it("turns 404 failures into a short readable message", () => {
    expect(updateErrorMessage(new Error("HTTP 404: Not Found"))).toContain("404");
  });

  it("returns null progress when the server provides no length", () => {
    expect(downloadProgress(10, null)).toBeNull();
  });

  it("clamps download progress to zero through one", () => {
    expect(downloadProgress(150, 100)).toBe(1);
    expect(downloadProgress(-5, 100)).toBe(0);
  });

  it("localizes relative check times", () => {
    expect(relativeCheckTime(null, "en")).toBe("Not checked yet");
    expect(relativeCheckTime(Date.now() - 2 * 60 * 60 * 1000, "zh")).toBe("2 小时前");
  });

  it("describes non-idle check states in the settings row", () => {
    expect(updateSettingsLabel({ kind: "checking" }, "en")).toBe("Checking…");
    expect(updateSettingsLabel({ kind: "upToDate" }, "zh")).toBe("已是最新版本");
    expect(updateSettingsLabel({ kind: "idle" }, "en")).toBeNull();
  });
});
