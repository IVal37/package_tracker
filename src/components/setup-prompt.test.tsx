import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SetupPrompt } from "./setup-prompt";

const setup = () => {
  const completeAction = vi.fn(async () => {});
  const skipAction = vi.fn(async () => {});
  render(
    <SetupPrompt completeAction={completeAction} skipAction={skipAction} />,
  );
  return { completeAction, skipAction };
};

describe("SetupPrompt", () => {
  it("is a modal dialog with the three things to set up", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Welcome to Wayfind" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent(/Forward your order emails/);
    expect(dialog).toHaveTextContent(/Put Wayfind on your phone/);
    expect(dialog).toHaveTextContent(/Turn on alerts/);
  });

  it("links to the setup guide without answering", () => {
    const { completeAction, skipAction } = setup();
    expect(
      screen.getByRole("link", { name: "Open the setup guide" }),
    ).toHaveAttribute("href", "/setup");
    expect(completeAction).not.toHaveBeenCalled();
    expect(skipAction).not.toHaveBeenCalled();
  });

  it("cannot be closed except by answering", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("modal-backdrop"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("runs the done action for 'I've finished setup'", async () => {
    const user = userEvent.setup();
    const { completeAction, skipAction } = setup();
    await user.click(
      screen.getByRole("button", { name: "I’ve finished setup" }),
    );
    expect(completeAction).toHaveBeenCalledTimes(1);
    expect(skipAction).not.toHaveBeenCalled();
  });

  it("runs the skip action for 'Skip, I'll do it later'", async () => {
    const user = userEvent.setup();
    const { completeAction, skipAction } = setup();
    await user.click(
      screen.getByRole("button", { name: "Skip, I’ll do it later" }),
    );
    expect(skipAction).toHaveBeenCalledTimes(1);
    expect(completeAction).not.toHaveBeenCalled();
  });

  it("says where the guide can be found later", () => {
    setup();
    expect(screen.getByText(/under Setup in the header/)).toBeInTheDocument();
  });
});
