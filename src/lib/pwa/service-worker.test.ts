// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SERVICE_WORKER_URL,
  currentPushEnvironment,
  pushSupport,
  registerServiceWorker,
  urlBase64ToUint8Array,
  type PushEnvironment,
} from "./service-worker";

const env = (overrides: Partial<PushEnvironment> = {}): PushEnvironment => ({
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: "default",
  isIos: false,
  isStandalone: false,
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pushSupport", () => {
  it("is available when everything exists and permission is not refused", () => {
    expect(pushSupport(env())).toBe("available");
    expect(pushSupport(env({ permission: "granted" }))).toBe("available");
    expect(pushSupport(env({ permission: null }))).toBe("available");
  });

  it("says denied when the user blocked notifications", () => {
    expect(pushSupport(env({ permission: "denied" }))).toBe("denied");
  });

  it.each([
    ["no service worker", { hasServiceWorker: false }],
    ["no push manager", { hasPushManager: false }],
    ["no notification api", { hasNotification: false }],
  ])("is unsupported with %s", (_name, overrides) => {
    expect(pushSupport(env(overrides))).toBe("unsupported");
  });

  it("asks iPhone and iPad users to install first, whatever else is true", () => {
    expect(pushSupport(env({ isIos: true }))).toBe("needs_install");
    expect(
      pushSupport(
        env({ isIos: true, hasPushManager: false, permission: "denied" }),
      ),
    ).toBe("needs_install");
  });

  it("lets an installed iPhone app use push", () => {
    expect(pushSupport(env({ isIos: true, isStandalone: true }))).toBe(
      "available",
    );
  });

  it("does not ask non-iOS users to install", () => {
    expect(pushSupport(env({ isIos: false, isStandalone: false }))).toBe(
      "available",
    );
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with or without padding", () => {
    // "hello" is aGVsbG8 in unpadded base64url.
    expect([...urlBase64ToUint8Array("aGVsbG8")]).toEqual([
      104, 101, 108, 108, 111,
    ]);
    expect([...urlBase64ToUint8Array("aGVsbG8=")]).toEqual([
      104, 101, 108, 108, 111,
    ]);
  });

  it("maps the url-safe characters back", () => {
    // 0xfb 0xff 0xfe is "-__-" in base64url ("+//+" in plain base64).
    expect([...urlBase64ToUint8Array("-__-")]).toEqual([0xfb, 0xff, 0xfe]);
  });

  it("decodes a 65-byte VAPID-sized key", () => {
    const key = "B".repeat(87);
    expect(urlBase64ToUint8Array(key)).toHaveLength(65);
  });
});

describe("registerServiceWorker", () => {
  it("registers /sw.js at the root and never lets the browser cache the script", async () => {
    const registration = { scope: "/" };
    const register = vi.fn(async () => registration);
    vi.stubGlobal("navigator", { serviceWorker: { register } });

    expect(await registerServiceWorker()).toBe(registration);
    expect(register).toHaveBeenCalledExactlyOnceWith(SERVICE_WORKER_URL, {
      scope: "/",
      updateViaCache: "none",
    });
    expect(SERVICE_WORKER_URL).toBe("/sw.js");
  });

  it("returns null where service workers do not exist", async () => {
    vi.stubGlobal("navigator", {});
    expect(await registerServiceWorker()).toBeNull();
  });

  it("returns null instead of throwing when registration fails", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn(async () => {
          throw new Error("SecurityError");
        }),
      },
    });
    expect(await registerServiceWorker()).toBeNull();
  });
});

describe("currentPushEnvironment", () => {
  const stub = (
    nav: Record<string, unknown>,
    win: Record<string, unknown> = {},
  ) => {
    vi.stubGlobal("navigator", nav);
    for (const [key, value] of Object.entries(win)) vi.stubGlobal(key, value);
  };

  it("reads a desktop Chrome-like browser", () => {
    stub(
      {
        userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130",
        serviceWorker: {},
        platform: "Win32",
        maxTouchPoints: 0,
      },
      {
        PushManager: class {},
        Notification: { permission: "granted" },
        matchMedia: () => ({ matches: false }),
      },
    );
    expect(currentPushEnvironment()).toMatchObject({
      hasServiceWorker: true,
      hasPushManager: true,
      hasNotification: true,
      permission: "granted",
      isIos: false,
      isStandalone: false,
    });
  });

  it("recognises an iPhone, and iPadOS posing as a Mac", () => {
    stub({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
      platform: "iPhone",
      maxTouchPoints: 5,
    });
    expect(currentPushEnvironment().isIos).toBe(true);
    stub({
      userAgent: "Mozilla/5.0 (Macintosh)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    });
    expect(currentPushEnvironment().isIos).toBe(true);
    stub({
      userAgent: "Mozilla/5.0 (Macintosh)",
      platform: "MacIntel",
      maxTouchPoints: 0,
    });
    expect(currentPushEnvironment().isIos).toBe(false);
  });

  it("recognises an installed app by display mode or by Safari's flag", () => {
    stub(
      { userAgent: "x", platform: "x", maxTouchPoints: 0 },
      { matchMedia: () => ({ matches: true }) },
    );
    expect(currentPushEnvironment().isStandalone).toBe(true);

    stub(
      { userAgent: "x", platform: "x", maxTouchPoints: 0, standalone: true },
      { matchMedia: () => ({ matches: false }) },
    );
    expect(currentPushEnvironment().isStandalone).toBe(true);
  });

  it("copes with a browser that has no matchMedia, treating it as not installed", () => {
    stub(
      { userAgent: "x", platform: "x", maxTouchPoints: 0 },
      { matchMedia: undefined },
    );
    expect(currentPushEnvironment().isStandalone).toBe(false);
  });

  it("reports missing push apis honestly", () => {
    stub(
      { userAgent: "x", platform: "x", maxTouchPoints: 0 },
      { matchMedia: undefined },
    );
    const result = currentPushEnvironment();
    expect(result.hasServiceWorker).toBe(false);
    expect(
      result.permission === null || typeof result.permission === "string",
    ).toBe(true);
  });
});
