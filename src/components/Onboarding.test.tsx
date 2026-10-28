import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dictionary } from "../i18n";
import { Onboarding } from "./Onboarding";

const props = {
  platform: "MacIntel",
  onBegin: () => undefined,
  onDemo: () => undefined,
  onGrant: () => undefined,
};

describe("Onboarding", () => {
  afterEach(() => cleanup());

  it("discloses the daily GitHub update check in English", () => {
    render(<Onboarding t={dictionary("en")} language="en" {...props} />);

    expect(
      screen.getByText(
        "Tactile checks GitHub once a day for app updates. No usage data is sent, and you can turn this off in Settings.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/runs fully offline/i)).not.toBeInTheDocument();
  });

  it("discloses the daily GitHub update check in Chinese", () => {
    render(<Onboarding t={dictionary("zh")} language="zh" {...props} />);

    expect(
      screen.getByText(
        "指痕每天向 GitHub 检查一次应用更新，不发送使用数据，可在设置中关闭。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/完全离线/)).not.toBeInTheDocument();
  });
});
