import { describe, expect, it } from "vitest";
import {
  compactNumber,
  formatDistance,
  formatDuration,
  formatRatio,
  resolveLanguage,
} from "./format";

describe("language resolution", () => {
  it("follows a Chinese system locale when preference is system", () => {
    expect(resolveLanguage("system", "zh-CN")).toBe("zh");
  });

  it("honors an explicit English override", () => {
    expect(resolveLanguage("en", "zh-CN")).toBe("en");
  });
});

describe("metric formatting", () => {
  it("uses compact notation for large counts", () => {
    expect(compactNumber(48_219, "en")).toContain("48");
  });

  it("shows a readable minute duration", () => {
    expect(formatDuration(3_900, "en")).toBe("1h 5m");
  });

  it("labels no comparison baseline explicitly", () => {
    expect(formatRatio(null)).toBe("—");
  });

  it("keeps sub-kilometer distance in meters", () => {
    expect(formatDistance(0.042, "en")).toContain("m");
  });
});
