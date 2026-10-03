import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpgradeButton } from "./upgrade-button";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UpgradeButton", () => {
  it("shows no dialog until clicked", () => {
    render(<UpgradeButton />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the Coming soon dialog and makes no network calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<UpgradeButton />);

    await userEvent.click(screen.getByRole("button", { name: "Upgrade" }));

    const dialog = screen.getByRole("dialog", { name: "Coming soon" });
    expect(dialog).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Got it button",
      () => userEvent.click(screen.getByRole("button", { name: "Got it" })),
    ],
    [
      "close button",
      () => userEvent.click(screen.getByRole("button", { name: "Close" })),
    ],
    ["Escape key", () => userEvent.keyboard("{Escape}")],
    [
      "backdrop click",
      () => userEvent.click(screen.getByTestId("modal-backdrop")),
    ],
  ])(
    "closes via the %s and returns focus to the trigger",
    async (_name, close) => {
      render(<UpgradeButton />);
      const trigger = screen.getByRole("button", { name: "Upgrade" });
      await userEvent.click(trigger);

      await close();

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    },
  );
});
