import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushEnvironment } from "@/lib/pwa/service-worker";

const mocks = vi.hoisted(() => ({ currentPushEnvironment: vi.fn() }));

vi.mock("@/lib/pwa/service-worker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pwa/service-worker")>()),
  currentPushEnvironment: mocks.currentPushEnvironment,
}));

import { InstallCard } from "./install-card";

const env = (overrides: Partial<PushEnvironment> = {}): PushEnvironment => ({
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: "default",
  isIos: false,
  isStandalone: false,
  ...overrides,
});

/** Chromium's install event, with a prompt that can be watched. */
function installEvent() {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn(async () => {});
  Object.assign(event, { prompt });
  return { event, prompt };
}

beforeEach(() => {
  mocks.currentPushEnvironment.mockReturnValue(env());
});

describe("InstallCard", () => {
  it("shows nothing until the browser says the app can be installed", () => {
    const { container } = render(<InstallCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the app is already installed, even on iOS", () => {
    mocks.currentPushEnvironment.mockReturnValue(
      env({ isStandalone: true, isIos: true }),
    );
    const { container } = render(<InstallCard />);
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("explains Share then Add to Home Screen on iPhone and iPad", () => {
    mocks.currentPushEnvironment.mockReturnValue(env({ isIos: true }));
    render(<InstallCard />);
    expect(
      screen.getByRole("heading", { name: "Install Wayfind" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Add to Home Screen")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Install app" }),
    ).not.toBeInTheDocument();
  });

  it("offers an Install button when Chromium fires its install event", () => {
    render(<InstallCard />);
    const { event } = installEvent();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(
      screen.getByRole("button", { name: "Install app" }),
    ).toBeInTheDocument();
    // The browser's own mini-prompt is held back so the button can use it.
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows the browser's install prompt when the button is pressed, then hides", async () => {
    render(<InstallCard />);
    const { event, prompt } = installEvent();
    act(() => {
      window.dispatchEvent(event);
    });

    await userEvent.click(screen.getByRole("button", { name: "Install app" }));

    expect(prompt).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("heading", { name: "Install Wayfind" }),
    ).not.toBeInTheDocument();
  });

  it("goes away once the app has been installed", () => {
    render(<InstallCard />);
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    expect(
      screen.getByRole("button", { name: "Install app" }),
    ).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(
      screen.queryByRole("button", { name: "Install app" }),
    ).not.toBeInTheDocument();
  });

  it("stops listening when it is removed", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<InstallCard />);
    unmount();
    const removed = remove.mock.calls.map((call) => call[0]);
    expect(removed).toEqual(
      expect.arrayContaining(["beforeinstallprompt", "appinstalled"]),
    );
    remove.mockRestore();
  });
});
