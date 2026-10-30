import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SetupTimestamps } from "@/lib/setup/status";
import { SetupStatus } from "./setup-status";

const WHEN = new Date("2026-10-30T12:00:00Z");

const NEW: SetupTimestamps = { completedAt: null, skippedAt: null };
const SKIPPED: SetupTimestamps = { completedAt: null, skippedAt: WHEN };
const DONE: SetupTimestamps = { completedAt: WHEN, skippedAt: null };

const setup = (
  answer = NEW,
  signals: { emailsArriving?: boolean; pushDevices?: number } = {},
) => {
  const completeAction = vi.fn(async () => {});
  const skipAction = vi.fn(async () => {});
  render(
    <SetupStatus
      answer={answer}
      emailsArriving={signals.emailsArriving ?? false}
      pushDevices={signals.pushDevices ?? 0}
      completeAction={completeAction}
      skipAction={skipAction}
    />,
  );
  return { completeAction, skipAction };
};

describe("SetupStatus", () => {
  it("says not started, and offers done and skip", () => {
    setup(NEW);
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark setup as done" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Skip for now" }),
    ).toBeInTheDocument();
  });

  it("says when it was skipped, and offers done but no second skip", () => {
    setup(SKIPPED);
    expect(screen.getByText("Skipped on 30 Oct 2026")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark setup as done" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
  });

  it("says when it was completed, and offers to undo it", () => {
    setup(DONE);
    expect(screen.getByText("Completed on 30 Oct 2026")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark as not done" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark setup as done" }),
    ).toBeNull();
  });

  it("runs the matching action when a button is pressed", async () => {
    const user = userEvent.setup();
    const done = setup(NEW);
    await user.click(
      screen.getByRole("button", { name: "Mark setup as done" }),
    );
    expect(done.completeAction).toHaveBeenCalledTimes(1);
    expect(done.skipAction).not.toHaveBeenCalled();
  });

  it("sends 'not done' through the skip action, so the dialog stays away", async () => {
    const user = userEvent.setup();
    const { skipAction, completeAction } = setup(DONE);
    await user.click(screen.getByRole("button", { name: "Mark as not done" }));
    expect(skipAction).toHaveBeenCalledTimes(1);
    expect(completeAction).not.toHaveBeenCalled();
  });

  it("shows what the app can see, apart from the answer", () => {
    setup(NEW, { emailsArriving: true, pushDevices: 2 });
    expect(
      screen.getByText("Emails are reaching your private address."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Alerts are on for 2 devices."),
    ).toBeInTheDocument();
  });

  it("says plainly when nothing has happened yet", () => {
    setup(DONE, { emailsArriving: false, pushDevices: 0 });
    // Completed, yet nothing is arriving: the page says so rather than hiding it.
    expect(screen.getByText("Completed on 30 Oct 2026")).toBeInTheDocument();
    expect(
      screen.getByText("No email has reached your private address yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No device is set up for push alerts yet."),
    ).toBeInTheDocument();
  });

  it("uses the singular for one device", () => {
    setup(NEW, { pushDevices: 1 });
    expect(screen.getByText("Alerts are on for 1 device.")).toBeInTheDocument();
  });
});
