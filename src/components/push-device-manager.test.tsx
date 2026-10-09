import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushEnvironment } from "@/lib/pwa/service-worker";

const mocks = vi.hoisted(() => ({
  currentPushEnvironment: vi.fn(),
  registerServiceWorker: vi.fn(),
}));

vi.mock("@/lib/pwa/service-worker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pwa/service-worker")>()),
  currentPushEnvironment: mocks.currentPushEnvironment,
  registerServiceWorker: mocks.registerServiceWorker,
}));

import { PushDeviceManager } from "./push-device-manager";

const env = (overrides: Partial<PushEnvironment> = {}): PushEnvironment => ({
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: "default",
  isIos: false,
  isStandalone: false,
  ...overrides,
});

const KEY = "B".repeat(87);

const subscription = (
  endpoint = "https://fcm.googleapis.com/fcm/send/abc",
) => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  unsubscribe: vi.fn(async () => true),
});

/** A fake registration whose push manager holds (or lacks) a subscription. */
function registration(existing: ReturnType<typeof subscription> | null) {
  const pushManager = {
    getSubscription: vi.fn(async () => existing),
    subscribe: vi.fn(async (_options?: unknown) => subscription()),
  };
  return { pushManager };
}

const actions = () => ({
  saveAction: vi.fn(async () => ({ ok: true })),
  removeAction: vi.fn(async () => {}),
  testAction: vi.fn(async () => ({ status: "sent" as const, devices: 1 })),
});

const renderManager = (
  overrides: Partial<React.ComponentProps<typeof PushDeviceManager>> = {},
) => {
  const fns = actions();
  render(<PushDeviceManager publicKey={KEY} {...fns} {...overrides} />);
  return fns;
};

let requestPermission: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.currentPushEnvironment.mockReturnValue(env());
  mocks.registerServiceWorker.mockResolvedValue(registration(null));
  requestPermission = vi.fn(async () => "granted");
  vi.stubGlobal("Notification", { requestPermission, permission: "default" });
  Object.defineProperty(navigator, "serviceWorker", {
    value: { ready: Promise.resolve({}) },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  // @ts-expect-error: remove the stub so other tests see a clean navigator
  delete navigator.serviceWorker;
});

describe("PushDeviceManager: what it shows", () => {
  it("says push is not set up when the server has no key", async () => {
    renderManager({ publicKey: null });
    expect(
      await screen.findByText(/not set up on this server/),
    ).toBeInTheDocument();
    expect(mocks.currentPushEnvironment).not.toHaveBeenCalled();
  });

  it.each([
    [{ hasPushManager: false }, /does not support push notifications/],
    [{ hasServiceWorker: false }, /does not support push notifications/],
    [{ isIos: true }, /Add to Home Screen/],
    [{ permission: "denied" as const }, /blocked for this site/],
  ])("explains why push is unavailable: %j", async (overrides, message) => {
    mocks.currentPushEnvironment.mockReturnValue(env(overrides));
    renderManager();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Turn on push" }),
    ).not.toBeInTheDocument();
  });

  it("offers to turn push on when this browser has no subscription", async () => {
    renderManager();
    expect(
      await screen.findByRole("button", { name: "Turn on push" }),
    ).toBeInTheDocument();
  });

  it("offers a test and turning off when this browser is already subscribed", async () => {
    mocks.registerServiceWorker.mockResolvedValue(registration(subscription()));
    renderManager();
    expect(
      await screen.findByText("Push is on for this device."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send a test" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Turn off push" }),
    ).toBeInTheDocument();
  });

  it("does not ask for permission just by being shown", async () => {
    renderManager();
    await screen.findByRole("button", { name: "Turn on push" });
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe("PushDeviceManager: turning on", () => {
  it("asks permission, subscribes with the server's key, and saves the device", async () => {
    const reg = registration(null);
    mocks.registerServiceWorker.mockResolvedValue(reg);
    const { saveAction } = renderManager();

    await userEvent.click(
      await screen.findByRole("button", { name: "Turn on push" }),
    );

    await screen.findByText("Push is on for this device.");
    expect(requestPermission).toHaveBeenCalledOnce();
    const options = reg.pushManager.subscribe.mock.calls[0]?.[0] as unknown as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(options.applicationServerKey).toHaveLength(65);
    expect(saveAction).toHaveBeenCalledExactlyOnceWith({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "p", auth: "a" },
    });
  });

  it("stops at a refused permission without subscribing or saving", async () => {
    requestPermission.mockResolvedValue("denied");
    const reg = registration(null);
    mocks.registerServiceWorker.mockResolvedValue(reg);
    const { saveAction } = renderManager();

    await userEvent.click(
      await screen.findByRole("button", { name: "Turn on push" }),
    );

    expect(
      await screen.findByText(/blocked for this site/),
    ).toBeInTheDocument();
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled();
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("undoes the browser subscription if the server will not take it", async () => {
    const created = subscription();
    const reg = registration(null);
    reg.pushManager.subscribe.mockResolvedValue(created);
    mocks.registerServiceWorker.mockResolvedValue(reg);
    const { saveAction } = renderManager();
    saveAction.mockResolvedValue({ ok: false });

    await userEvent.click(
      await screen.findByRole("button", { name: "Turn on push" }),
    );

    expect(
      await screen.findByText(/push service isn't supported/),
    ).toBeInTheDocument();
    expect(created.unsubscribe).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Turn on push" }),
    ).toBeInTheDocument();
  });

  it("says so, and stays off, when subscribing throws", async () => {
    const reg = registration(null);
    reg.pushManager.subscribe.mockRejectedValue(new Error("AbortError"));
    mocks.registerServiceWorker.mockResolvedValue(reg);
    renderManager();

    await userEvent.click(
      await screen.findByRole("button", { name: "Turn on push" }),
    );

    expect(
      await screen.findByText("Push could not be turned on. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on push" })).toBeEnabled();
  });

  it("reports an unsupported browser if the service worker cannot register", async () => {
    mocks.registerServiceWorker
      .mockResolvedValueOnce(registration(null)) // the check on mount
      .mockResolvedValueOnce(null); // the click
    renderManager();

    await userEvent.click(
      await screen.findByRole("button", { name: "Turn on push" }),
    );

    expect(
      await screen.findByText(/does not support push notifications/),
    ).toBeInTheDocument();
  });
});

describe("PushDeviceManager: turning off and testing", () => {
  it("removes this device on the server, then unsubscribes the browser", async () => {
    const existing = subscription("https://fcm.googleapis.com/fcm/send/mine");
    mocks.registerServiceWorker.mockResolvedValue(registration(existing));
    const { removeAction } = renderManager();

    await userEvent.click(
      await screen.findByRole("button", { name: "Turn off push" }),
    );

    await screen.findByRole("button", { name: "Turn on push" });
    expect(removeAction).toHaveBeenCalledExactlyOnceWith(
      "https://fcm.googleapis.com/fcm/send/mine",
    );
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
  });

  it("stays on and says so if turning off fails", async () => {
    mocks.registerServiceWorker.mockResolvedValue(registration(subscription()));
    const { removeAction } = renderManager();
    removeAction.mockRejectedValue(new Error("network"));

    await userEvent.click(
      await screen.findByRole("button", { name: "Turn off push" }),
    );

    expect(
      await screen.findByText(
        "Push could not be turned off. Please try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Push is on for this device.")).toBeInTheDocument();
  });

  it.each([
    [{ status: "sent", devices: 1 }, /Test sent/],
    [{ status: "no_devices" }, /No device is set up/],
    [{ status: "rate_limited" }, /Wait a minute/],
    [{ status: "failed" }, /could not be delivered/],
  ] as const)("shows the result of a test: %j", async (result, message) => {
    mocks.registerServiceWorker.mockResolvedValue(registration(subscription()));
    const { testAction } = renderManager();
    testAction.mockResolvedValue(result as never);

    await userEvent.click(
      await screen.findByRole("button", { name: "Send a test" }),
    );

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("shows a failure message if the test request itself fails", async () => {
    mocks.registerServiceWorker.mockResolvedValue(registration(subscription()));
    const { testAction } = renderManager();
    testAction.mockRejectedValue(new Error("network"));

    await userEvent.click(
      await screen.findByRole("button", { name: "Send a test" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /could not be delivered/,
      ),
    );
  });
});
