// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// public/sw.js is plain JavaScript served as-is, so it is tested the way a
// browser would run it: loaded into a sandbox with a fake `self`, Cache API,
// fetch and clients.

const SOURCE = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://wayfind.example.test";

/** A Response that looks like a same-origin one from a real fetch. */
function ok(body = "page", init: ResponseInit = {}): Response {
  const response = new Response(body, { status: 200, ...init });
  Object.defineProperty(response, "type", {
    value: "basic",
    configurable: true,
  });
  return response;
}

function withProps(response: Response, props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(response, key, { value, configurable: true });
  }
  return response;
}

/** Just enough of CacheStorage: match, put and delete by URL. */
class FakeCaches {
  readonly stores = new Map<string, Map<string, Response>>();
  private key(input: Request | string) {
    return typeof input === "string" ? new URL(input, ORIGIN).href : input.url;
  }
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    const store = this.stores.get(name)!;
    return {
      match: async (input: Request | string) =>
        store.get(this.key(input))?.clone(),
      put: async (input: Request | string, response: Response) => {
        store.set(this.key(input), response);
      },
    };
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  names() {
    return [...this.stores.keys()].sort();
  }
  entries(name: string) {
    return [...(this.stores.get(name)?.keys() ?? [])].sort();
  }
}

type Handler = (event: Record<string, unknown>) => void;

function load(options: { hostname?: string; fetchImpl?: typeof fetch } = {}) {
  const handlers: Record<string, Handler> = {};
  const caches = new FakeCaches();
  const clients = {
    claim: vi.fn(async () => {}),
    matchAll: vi.fn(async () => [] as unknown[]),
    openWindow: vi.fn(async () => null),
  };
  const showNotification = vi.fn(async () => {});
  const origin = options.hostname ? `https://${options.hostname}` : ORIGIN;
  const self = {
    location: new URL(`${origin}/`),
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
    skipWaiting: vi.fn(),
    clients,
    registration: { showNotification },
  };
  const fetchMock = vi.fn(options.fetchImpl ?? (async () => ok()));
  const context = vm.createContext({
    self,
    caches,
    fetch: fetchMock,
    URL,
    Request,
    Response,
    Promise,
  });
  vm.runInContext(SOURCE, context);

  /** Runs a fetch event; returns the response, or undefined if the worker ignored it. */
  async function fetchEvent(
    url: string,
    init: { method?: string; mode?: string } = {},
  ) {
    let responded: Promise<Response> | undefined;
    const request = new Request(new URL(url, origin), {
      method: init.method ?? "GET",
    });
    Object.defineProperty(request, "mode", { value: init.mode ?? "no-cors" });
    handlers.fetch!({
      request,
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
    });
    return responded ? await responded : undefined;
  }

  return {
    handlers,
    caches,
    clients,
    showNotification,
    self,
    fetchMock,
    fetchEvent,
  };
}

const navigate = (worker: ReturnType<typeof load>, url: string) =>
  worker.fetchEvent(url, { mode: "navigate" });

describe("install and activate", () => {
  it("takes over as soon as it is installed", () => {
    const worker = load();
    worker.handlers.install!({});
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it("removes its own old caches but leaves anyone else's, then claims open pages", async () => {
    const worker = load();
    for (const name of [
      "wayfind-pages-v0",
      "wayfind-static-v0",
      "wayfind-pages-v1",
      "wayfind-static-v1",
      "other-app-cache",
    ]) {
      await worker.caches.open(name);
    }

    let done: Promise<unknown> = Promise.resolve();
    worker.handlers.activate!({
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;

    expect(worker.caches.names()).toEqual([
      "other-app-cache",
      "wayfind-pages-v1",
      "wayfind-static-v1",
    ]);
    expect(worker.clients.claim).toHaveBeenCalledOnce();
  });
});

describe("the package list", () => {
  it("saves a good list page under / and returns the fresh response", async () => {
    const worker = load({ fetchImpl: async () => ok("fresh list") });

    const response = await navigate(worker, "/");

    expect(await response!.text()).toBe("fresh list");
    expect(worker.caches.entries("wayfind-pages-v1")).toEqual([`${ORIGIN}/`]);
  });

  it("serves the saved list when the network fails", async () => {
    let online = true;
    const worker = load({
      fetchImpl: async () => {
        if (!online) throw new TypeError("offline");
        return ok("saved list");
      },
    });
    await navigate(worker, "/");

    online = false;
    const response = await navigate(worker, "/");

    expect(await response!.text()).toBe("saved list");
  });

  it("serves the saved list for the list with a query, such as an open drawer, when offline", async () => {
    let online = true;
    const worker = load({
      fetchImpl: async () => {
        if (!online) throw new TypeError("offline");
        return ok("saved list");
      },
    });
    await navigate(worker, "/");

    online = false;
    expect(await (await navigate(worker, "/?shipment=abc"))!.text()).toBe(
      "saved list",
    );
    expect(await (await navigate(worker, "/?view=map"))!.text()).toBe(
      "saved list",
    );
  });

  it("does not save a page that has a query, so the map and a drawer are never the saved list", async () => {
    const worker = load({ fetchImpl: async () => ok("map") });
    await navigate(worker, "/?view=map");
    await navigate(worker, "/?shipment=abc");
    expect(worker.caches.entries("wayfind-pages-v1")).toEqual([]);
  });

  it("does not overwrite the saved list with one that has a query", async () => {
    let body = "list";
    const worker = load({ fetchImpl: async () => ok(body) });
    await navigate(worker, "/");
    body = "map view";
    await navigate(worker, "/?view=map");

    const offline = load({
      fetchImpl: async () => {
        throw new TypeError("offline");
      },
    });
    expect(offline.caches.entries("wayfind-pages-v1")).toEqual([]);
    const saved = await worker.caches.open("wayfind-pages-v1");
    expect(await (await saved.match("/"))!.text()).toBe("list");
  });

  it.each([
    [
      "a redirect (signed out, sent to sign-in)",
      () => withProps(ok("sign in"), { redirected: true }),
    ],
    ["a server error", () => withProps(ok("oops"), { status: 500 })],
    ["a not-found page", () => withProps(ok("missing"), { status: 404 })],
    [
      "a response that is not same-origin",
      () => withProps(ok("x"), { type: "cors" }),
    ],
  ])("never saves %s", async (_name, make) => {
    const worker = load({ fetchImpl: async () => make() });
    const response = await navigate(worker, "/");
    expect(response).toBeDefined(); // still passed to the page
    expect(worker.caches.entries("wayfind-pages-v1")).toEqual([]);
  });

  it("fails like the network when offline and nothing was ever saved", async () => {
    const worker = load({
      fetchImpl: async () => {
        throw new TypeError("offline");
      },
    });
    await expect(navigate(worker, "/")).rejects.toThrow("offline");
  });
});

describe("what it leaves alone", () => {
  it.each([
    ["an API route", "/api/webhooks/tracking", "navigate"],
    ["another page", "/settings", "navigate"],
    ["the sign-in page", "/sign-in", "navigate"],
    ["a data request for the list (not a page load)", "/", "cors"],
    ["a client-side navigation request", "/?_rsc=abc", "same-origin"],
    ["an image", "/icons/icon-192.png", "no-cors"],
    ["the manifest", "/manifest.webmanifest", "no-cors"],
  ])("does not intercept %s", async (_name, url, mode) => {
    const worker = load();
    expect(await worker.fetchEvent(url, { mode })).toBeUndefined();
    expect(worker.fetchMock).not.toHaveBeenCalled();
    expect(worker.caches.names()).toEqual([]);
  });

  it("does not intercept anything but GET, so server actions and forms pass through", async () => {
    const worker = load();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      expect(
        await worker.fetchEvent("/", { method, mode: "navigate" }),
      ).toBeUndefined();
      expect(
        await worker.fetchEvent("/_next/static/chunks/a.js", { method }),
      ).toBeUndefined();
    }
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it("does not intercept other origins", async () => {
    const worker = load();
    let responded = false;
    worker.handlers.fetch!({
      request: new Request("https://tiles.example.test/a.png"),
      respondWith: () => {
        responded = true;
      },
    });
    expect(responded).toBe(false);
  });
});

describe("static files", () => {
  const STATIC = "/_next/static/chunks/app-abc123.js";

  it("serves a hashed file from the cache once it has it, without asking the network again", async () => {
    const worker = load({ fetchImpl: async () => ok("console.log(1)") });

    await worker.fetchEvent(STATIC);
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);

    const second = await worker.fetchEvent(STATIC);
    expect(await second!.text()).toBe("console.log(1)");
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    expect(worker.caches.entries("wayfind-static-v1")).toEqual([
      `${ORIGIN}${STATIC}`,
    ]);
  });

  it("works offline once a file has been seen", async () => {
    let online = true;
    const worker = load({
      fetchImpl: async () => {
        if (!online) throw new TypeError("offline");
        return ok("js");
      },
    });
    await worker.fetchEvent(STATIC);
    online = false;
    expect(await (await worker.fetchEvent(STATIC))!.text()).toBe("js");
  });

  it("does not save a failed or redirected response", async () => {
    for (const make of [
      () => withProps(ok("nope"), { status: 404 }),
      () => withProps(ok("moved"), { redirected: true }),
    ]) {
      const worker = load({ fetchImpl: async () => make() });
      await worker.fetchEvent(STATIC);
      expect(worker.caches.entries("wayfind-static-v1")).toEqual([]);
    }
  });

  it("on localhost, asks the network first so edited code is never stale, and falls back offline", async () => {
    let body = "v1";
    let online = true;
    const worker = load({
      hostname: "localhost",
      fetchImpl: async () => {
        if (!online) throw new TypeError("offline");
        return ok(body);
      },
    });

    expect(await (await worker.fetchEvent(STATIC))!.text()).toBe("v1");
    body = "v2";
    expect(await (await worker.fetchEvent(STATIC))!.text()).toBe("v2");
    expect(worker.fetchMock).toHaveBeenCalledTimes(2);

    online = false;
    expect(await (await worker.fetchEvent(STATIC))!.text()).toBe("v2");
  });

  it("on localhost, fails offline for a file it never saw", async () => {
    const worker = load({
      hostname: "localhost",
      fetchImpl: async () => {
        throw new TypeError("offline");
      },
    });
    await expect(worker.fetchEvent(STATIC)).rejects.toThrow("offline");
  });
});

describe("push", () => {
  const push = async (
    worker: ReturnType<typeof load>,
    data: unknown,
    raw?: string,
  ) => {
    let done: Promise<unknown> = Promise.resolve();
    worker.handlers.push!({
      data:
        data === undefined && raw === undefined
          ? null
          : {
              json: () => (raw !== undefined ? JSON.parse(raw) : data),
            },
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
  };

  it("shows the notification the server sent", async () => {
    const worker = load();
    await push(worker, {
      title: "Delivered: Merino socks",
      body: "Left at front door",
      tag: "shipment-1",
      url: "/?shipment=1",
    });

    expect(worker.showNotification).toHaveBeenCalledExactlyOnceWith(
      "Delivered: Merino socks",
      {
        body: "Left at front door",
        tag: "shipment-1",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: "/?shipment=1" },
      },
    );
  });

  it("falls back to a plain notification for a missing or broken payload", async () => {
    for (const run of [
      (w: ReturnType<typeof load>) => push(w, undefined),
      (w: ReturnType<typeof load>) => push(w, undefined, "not json"),
      (w: ReturnType<typeof load>) => push(w, null),
      (w: ReturnType<typeof load>) => push(w, "just a string"),
      (w: ReturnType<typeof load>) => push(w, 42),
    ]) {
      const worker = load();
      await run(worker);
      expect(worker.showNotification).toHaveBeenCalledExactlyOnceWith(
        "Wayfind",
        expect.objectContaining({
          body: "",
          tag: "wayfind",
          data: { url: "/" },
        }),
      );
    }
  });

  it("ignores values that are not strings and cuts very long ones", async () => {
    const worker = load();
    await push(worker, {
      title: { evil: true },
      body: "b".repeat(500),
      tag: 7,
      url: ["/x"],
    });
    const [title, options] = worker.showNotification.mock
      .calls[0] as unknown as [
      string,
      { body: string; tag: string; data: { url: string } },
    ];
    expect(title).toBe("Wayfind");
    expect(options.body).toHaveLength(200);
    expect(options.tag).toBe("wayfind");
  });

  it("never lets the payload send the user to another site", async () => {
    for (const url of [
      "https://evil.test/phish",
      "//evil.test/x",
      "javascript:alert(1)",
      "data:text/html,hi",
    ]) {
      const worker = load();
      await push(worker, { title: "t", url });
      const [, options] = worker.showNotification.mock.calls[0] as unknown as [
        string,
        { data: { url: string } },
      ];
      expect(options.data.url).toBe("/");
    }
  });
});

describe("notification click", () => {
  const click = async (worker: ReturnType<typeof load>, data: unknown) => {
    const close = vi.fn();
    let done: Promise<unknown> = Promise.resolve();
    worker.handlers.notificationclick!({
      notification: { close, data },
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
    return close;
  };

  const windowClient = (url: string) => ({
    url,
    focus: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
  });

  it("closes the notification and opens the page when no window is open", async () => {
    const worker = load();
    const close = await click(worker, { url: "/?shipment=1" });
    expect(close).toHaveBeenCalledOnce();
    expect(worker.clients.openWindow).toHaveBeenCalledExactlyOnceWith(
      "/?shipment=1",
    );
  });

  it("focuses and steers a window that is already open on this site", async () => {
    const worker = load();
    const existing = windowClient(`${ORIGIN}/settings`);
    worker.clients.matchAll.mockResolvedValue([existing]);

    await click(worker, { url: "/?shipment=1" });

    expect(existing.focus).toHaveBeenCalledOnce();
    expect(existing.navigate).toHaveBeenCalledExactlyOnceWith("/?shipment=1");
    expect(worker.clients.openWindow).not.toHaveBeenCalled();
  });

  it("ignores windows on other sites", async () => {
    const worker = load();
    const foreign = windowClient("https://other.test/");
    worker.clients.matchAll.mockResolvedValue([foreign]);

    await click(worker, { url: "/" });

    expect(foreign.focus).not.toHaveBeenCalled();
    expect(worker.clients.openWindow).toHaveBeenCalledOnce();
  });

  it("opens a new window if the open one cannot be steered", async () => {
    const worker = load();
    const stuck = windowClient(`${ORIGIN}/`);
    stuck.navigate.mockRejectedValue(new TypeError("not controlled"));
    worker.clients.matchAll.mockResolvedValue([stuck]);

    await click(worker, { url: "/?shipment=2" });

    expect(worker.clients.openWindow).toHaveBeenCalledExactlyOnceWith(
      "/?shipment=2",
    );
  });

  it.each([
    ["another site", { url: "https://evil.test/x" }],
    ["a javascript url", { url: "javascript:alert(1)" }],
    ["no data", undefined],
    ["null data", null],
    ["data that is not an object", "x"],
    ["a url that is not a string", { url: 5 }],
  ])("only ever opens this site: %s", async (_name, data) => {
    const worker = load();
    await click(worker, data);
    const target = worker.clients.openWindow.mock.calls[0] as unknown[];
    expect(target).toEqual(["/"]);
  });

  it("drops the origin from a same-origin absolute url", async () => {
    const worker = load();
    await click(worker, { url: `${ORIGIN}/?shipment=9` });
    expect(worker.clients.openWindow).toHaveBeenCalledWith("/?shipment=9");
  });
});
