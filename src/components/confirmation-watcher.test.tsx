import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
const router = { refresh: mocks.refresh };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

import {
  ConfirmationWatcher,
  POLL_EVERY_MS,
  POLL_FOR_MS,
} from "./confirmation-watcher";

const setVisibility = (state: "visible" | "hidden") =>
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });

beforeEach(() => {
  vi.useFakeTimers();
  mocks.refresh.mockReset();
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("ConfirmationWatcher", () => {
  it("asks the page to draw again every few seconds", async () => {
    render(<ConfirmationWatcher />);
    expect(mocks.refresh).not.toHaveBeenCalled();

    await tick(POLL_EVERY_MS);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await tick(POLL_EVERY_MS * 2);
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status")).toHaveTextContent(
      /confirmation link or code appears here by itself/,
    );
  });

  it("stops after a few minutes and says nothing came", async () => {
    render(<ConfirmationWatcher />);
    await tick(POLL_FOR_MS + POLL_EVERY_MS);
    const calls = mocks.refresh.mock.calls.length;
    expect(screen.getByRole("status")).toHaveTextContent(
      "No Gmail confirmation yet.",
    );

    await tick(POLL_FOR_MS);
    expect(mocks.refresh).toHaveBeenCalledTimes(calls);
  });

  it("does not ask while the tab is hidden", async () => {
    setVisibility("hidden");
    render(<ConfirmationWatcher />);
    await tick(POLL_EVERY_MS * 3);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("stops when it is removed, as it is once the code arrives", async () => {
    const { unmount } = render(<ConfirmationWatcher />);
    unmount();
    await tick(POLL_FOR_MS);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("Check now looks straight away and starts waiting again", async () => {
    render(<ConfirmationWatcher />);
    await tick(POLL_FOR_MS + POLL_EVERY_MS);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No Gmail confirmation yet.",
    );
    mocks.refresh.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      /appears here by itself/,
    );

    await tick(POLL_EVERY_MS);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
});
