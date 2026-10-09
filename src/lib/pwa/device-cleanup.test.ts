// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_PREFIX,
  CLEANUP_TIMEOUT_MS,
  clearOfflineCaches,
  forgetThisDevice,
} from "./device-cleanup";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // @ts-expect-error: remove the stub so other tests see a clean navigator
  delete navigator.serviceWorker;
});

function storage(names: string[]) {
  const deleted: string[] = [];
  return {
    deleted,
    keys: vi.fn(async () => names),
    delete: vi.fn(async (name: string) => {
      deleted.push(name);
      return true;
    }),
  };
}

function stubServiceWorker(subscription: unknown) {
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      getRegistration: vi.fn(async () => ({
        pushManager: { getSubscription: vi.fn(async () => subscription) },
      })),
    },
    configurable: true,
  });
}

const pushSubscription = (
  endpoint = "https://fcm.googleapis.com/fcm/send/abc",
) => ({
  endpoint,
  unsubscribe: vi.fn(async () => true),
});

describe("clearOfflineCaches", () => {
  it("deletes Wayfind's caches and no one else's", async () => {
    const s = storage([
      "wayfind-pages-v1",
      "wayfind-static-v1",
      "other-app",
      "workbox-x",
    ]);
    await clearOfflineCaches(s);
    expect(s.deleted.sort()).toEqual(["wayfind-pages-v1", "wayfind-static-v1"]);
    expect(CACHE_PREFIX).toBe("wayfind-");
  });

  it("does nothing, quietly, where there is no cache storage", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(clearOfflineCaches()).resolves.toBeUndefined();
  });

  it("swallows a failure", async () => {
    const broken = {
      keys: vi.fn(async () => {
        throw new Error("SecurityError");
      }),
      delete: vi.fn(),
    };
    await expect(clearOfflineCaches(broken)).resolves.toBeUndefined();
    expect(broken.delete).not.toHaveBeenCalled();
  });

  it("uses the browser's cache storage by default", async () => {
    const s = storage(["wayfind-pages-v1"]);
    vi.stubGlobal("caches", s);
    await clearOfflineCaches();
    expect(s.deleted).toEqual(["wayfind-pages-v1"]);
  });
});

describe("forgetThisDevice", () => {
  it("tells the server, unsubscribes the browser, and clears the offline copy", async () => {
    const sub = pushSubscription();
    stubServiceWorker(sub);
    const s = storage(["wayfind-pages-v1"]);
    vi.stubGlobal("caches", s);
    const removeFromServer = vi.fn(async () => {});

    await forgetThisDevice({ removeFromServer });

    expect(removeFromServer).toHaveBeenCalledExactlyOnceWith(sub.endpoint);
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    expect(s.deleted).toEqual(["wayfind-pages-v1"]);
  });

  it("tells the server before the browser lets go of the subscription", async () => {
    const order: string[] = [];
    const sub = pushSubscription();
    sub.unsubscribe.mockImplementation(async () => {
      order.push("unsubscribe");
      return true;
    });
    stubServiceWorker(sub);
    await forgetThisDevice({
      removeFromServer: async () => {
        order.push("server");
      },
    });
    expect(order).toEqual(["server", "unsubscribe"]);
  });

  it("still unsubscribes and clears the cache if the server call fails", async () => {
    const sub = pushSubscription();
    stubServiceWorker(sub);
    const s = storage(["wayfind-pages-v1"]);
    vi.stubGlobal("caches", s);

    await forgetThisDevice({
      removeFromServer: async () => {
        throw new Error("network");
      },
    });

    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    expect(s.deleted).toEqual(["wayfind-pages-v1"]);
  });

  it("clears the cache even when this browser has no push subscription or no service worker", async () => {
    const s = storage(["wayfind-static-v1"]);
    vi.stubGlobal("caches", s);

    stubServiceWorker(null);
    const removeFromServer = vi.fn(async () => {});
    await forgetThisDevice({ removeFromServer });
    expect(removeFromServer).not.toHaveBeenCalled();
    expect(s.deleted).toEqual(["wayfind-static-v1"]);

    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    s.deleted.length = 0;
    await forgetThisDevice({ removeFromServer });
    expect(s.deleted).toEqual(["wayfind-static-v1"]);
  });

  it("carries on if the browser refuses to look up the registration", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        getRegistration: vi.fn(async () => {
          throw new Error("InvalidStateError");
        }),
      },
      configurable: true,
    });
    const s = storage(["wayfind-pages-v1"]);
    vi.stubGlobal("caches", s);
    await expect(
      forgetThisDevice({ removeFromServer: vi.fn() }),
    ).resolves.toBeUndefined();
    expect(s.deleted).toEqual(["wayfind-pages-v1"]);
  });

  it("gives up waiting after the timeout so signing out is never held up", async () => {
    vi.useFakeTimers();
    stubServiceWorker(pushSubscription());
    const removeFromServer = vi.fn(() => new Promise<void>(() => {})); // never answers

    let finished = false;
    const done = forgetThisDevice({ removeFromServer }).then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(CLEANUP_TIMEOUT_MS - 1);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await done;
    expect(finished).toBe(true);
    expect(CLEANUP_TIMEOUT_MS).toBe(3000);
  });

  it("honours a custom timeout", async () => {
    vi.useFakeTimers();
    stubServiceWorker(pushSubscription());
    const done = forgetThisDevice({
      removeFromServer: () => new Promise<void>(() => {}),
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(51);
    await expect(done).resolves.toBeUndefined();
  });
});
