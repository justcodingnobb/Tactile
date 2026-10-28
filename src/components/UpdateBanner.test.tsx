import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dictionary } from "../i18n";
import { UpdateBanner } from "./UpdateBanner";

const handlers = () => ({
  onNotes: vi.fn(),
  onInstall: vi.fn(),
  onDismiss: vi.fn(),
  onRestart: vi.fn(),
});

describe("UpdateBanner", () => {
  afterEach(() => cleanup());

  it("renders an available update and calls its actions", async () => {
    const user = userEvent.setup();
    const callbacks = handlers();
    render(
      <UpdateBanner
        phase={{
          kind: "available",
          version: "0.2.0",
          notes: "Changes",
          date: null,
        }}
        notesOpen={false}
        version="0.2.0"
        t={dictionary("en")}
        {...callbacks}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Version 0.2.0 is available");
    await user.click(screen.getByRole("button", { name: "What's new" }));
    await user.click(screen.getByRole("button", { name: "Update now" }));
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(callbacks.onNotes).toHaveBeenCalledOnce();
    expect(callbacks.onInstall).toHaveBeenCalledOnce();
    expect(callbacks.onDismiss).toHaveBeenCalledOnce();
  });

  it("renders download progress inside the status banner", () => {
    render(
      <UpdateBanner
        phase={{ kind: "downloading", progress: 0.42 }}
        notesOpen={false}
        version="0.2.0"
        t={dictionary("en")}
        {...handlers()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Version 0.2.0 is availableDownloading update 42%",
    );
  });

  it("renders the ready state and calls restart", async () => {
    const user = userEvent.setup();
    const callbacks = handlers();
    render(
      <UpdateBanner
        phase={{ kind: "ready" }}
        notesOpen={false}
        version="0.2.0"
        t={dictionary("en")}
        {...callbacks}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Update downloaded");
    await user.click(screen.getByRole("button", { name: "Restart to finish" }));
    expect(callbacks.onRestart).toHaveBeenCalledOnce();
  });
});
