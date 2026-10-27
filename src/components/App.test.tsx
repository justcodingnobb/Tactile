import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { demoStats } from "../lib/demo";
import { mockState, previewHeatmap } from "../lib/ipc";
import { donutTotal } from "./Charts";
import { KeyboardHeatmap } from "./Keyboard";
import { liveBus } from "../lib/liveBus";

describe("Tactile app", () => {
  beforeEach(() => {
    mockState.paused = false;
    mockState.demo = false;
    mockState.updateSettingsError = false;
    mockState.settings = {
      launch_at_login: false,
      check_updates: false,
      theme: "system",
      language: "system",
      shortcuts_enabled: true,
      onboarding_complete: false,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the privacy-first onboarding on first launch", async () => {
    render(<App />);
    expect(
      await screen.findByText(/Every keystroke and click leaves a mark|每一次敲击与点击/),
    ).toBeInTheDocument();
    expect(screen.getByText("No account. No cloud.")).toBeInTheDocument();
  });

  it("enters demo mode and displays the dashboard metrics", async () => {
    const user = userEvent.setup();
    render(<App />);
    const demo = await screen.findByRole("button", {
      name: /Explore the demo|先看演示/,
    });
    await user.click(demo);
    await waitFor(() => {
      expect(screen.getByText("Mouse travel")).toBeInTheDocument();
    });
    expect(screen.queryByText(/[A-D]—0\d/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Keystrokes").length).toBeGreaterThan(0);
    expect(screen.getByText("DEMO · Exit demo")).toBeInTheDocument();
  });

  it("navigates to the keyboard terrain page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /Explore the demo|先看演示/ }),
    );
    await screen.findByText("Mouse travel");
    await user.click(
      screen.getByRole("button", { name: /Keyboard|键盘/ }),
    );
    expect(await screen.findByRole("heading", { name: "Keyboard terrain" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^space:/ })).toBeInTheDocument();
    expect(screen.queryByText(/Live keyboard|实时键盘/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Key ranking|按键排行/)).not.toBeInTheDocument();
  });

  it("shows the mouse page without a live pointer panel", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /Explore the demo|先看演示/ }),
    );
    await screen.findByText("Mouse travel");
    await user.click(screen.getByRole("button", { name: /^(Mouse|鼠标)$/ }));
    expect(await screen.findByRole("heading", { name: "Mouse" })).toBeInTheDocument();
    expect(screen.queryByText(/Live pointer|实时指针/)).not.toBeInTheDocument();
  });

  it("lights a key while it is held and releases it after key up", async () => {
    render(<KeyboardHeatmap keys={[]} language="en" live />);
    const key = screen.getByRole("img", { name: /^a:/ });
    const pulse = {
      seq: 1,
      date: null,
      presses: [],
      shortcut_presses: 0,
      distance_px: 0,
      buttons: [],
      click_cells: [],
      wheel_up: 0,
      wheel_down: 0,
    };
    act(() => liveBus.emit({ ...pulse, down: ["a"], up: [] }));
    expect(key).toHaveClass("is-down");
    act(() => liveBus.emit({ ...pulse, down: [], up: ["a"] }));
    await waitFor(() => expect(key).not.toHaveClass("is-down"));
  });

  it("rolls back settings that fail to save", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /Enter the dashboard|进入仪表盘/ }),
    );
    await user.click(await screen.findByRole("button", { name: /Settings|设置/ }));
    const autostart = await screen.findByRole("switch", {
      name: /Launch at login|登录时自动启动/,
    });
    expect(autostart).toHaveAttribute("aria-checked", "false");
    mockState.updateSettingsError = true;
    await user.click(autostart);
    await waitFor(() => {
      expect(autostart).toHaveAttribute("aria-checked", "false");
    });
  });

  it("does not invent a click when no button was pressed", () => {
    expect(
      donutTotal([
        { value: 0 },
        { value: 0 },
      ]),
    ).toBe(0);
  });

  it("keeps the demo heatmap within the demo click total", () => {
    const heatmap = previewHeatmap();
    const cellTotal = heatmap.cells.reduce((sum, value) => sum + value, 0);
    expect(heatmap.filtered_total).toBe(cellTotal);
    expect(heatmap.max_value).toBe(Math.max(...heatmap.cells));
    expect(heatmap.filtered_total).toBeLessThan(demoStats.totals.clicks);
  });
});
