import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { mockState } from "../lib/ipc";

describe("Trajectory app", () => {
  beforeEach(() => {
    mockState.paused = false;
    mockState.demo = false;
    mockState.settings = {
      launch_at_login: true,
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
      await screen.findByText(/Your motion|你的动作/),
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
      expect(screen.getByText("TOTAL DISTANCE / POINTER TRAVEL")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Keystrokes").length).toBeGreaterThan(0);
    expect(screen.getByText("DEMO · Exit demo")).toBeInTheDocument();
  });

  it("navigates to the keyboard terrain page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /Explore the demo|先看演示/ }),
    );
    await screen.findByText("TOTAL DISTANCE / POINTER TRAVEL");
    await user.click(
      screen.getByRole("button", { name: /Keyboard|键盘/ }),
    );
    expect(await screen.findByText("Keyboard terrain")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^space:/ })).toBeInTheDocument();
  });
});
