// Wayfind service worker. Plain JavaScript on purpose: it is served as-is from
// /public, so it needs no build step, and it is loaded in a Node test sandbox.
//
// It does three things:
//   1. Shows push notifications and opens the right page when one is tapped.
//   2. Keeps a copy of the package list, so it still shows offline.
//   3. Keeps the app's hashed JavaScript and CSS so that copy can run offline.
//
// It never touches anything else. In particular it never caches /api, server
// actions (POSTs), other pages, redirects or errors.

const VERSION = "v1";
const PREFIX = "wayfind-";
const PAGE_CACHE = `${PREFIX}pages-${VERSION}`;
const STATIC_CACHE = `${PREFIX}static-${VERSION}`;
const CURRENT_CACHES = [PAGE_CACHE, STATIC_CACHE];

// The cached list is stored under this key, whatever query the visit had.
const LIST_KEY = "/";
const ICON = "/icons/icon-192.png";

// On localhost the "static" files are not hashed and change as you edit them, so
// serving them from the cache first would show stale code.
const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(
  self.location.hostname,
);

self.addEventListener("install", () => {
  // Take over as soon as the new version is installed.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Remove our caches from older versions; leave anyone else's alone.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) => name.startsWith(PREFIX) && !CURRENT_CACHES.includes(name),
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** A response worth keeping: a plain 200 that was not the result of a redirect. */
function isCacheable(response) {
  return (
    response.status === 200 &&
    response.type === "basic" &&
    response.redirected === false
  );
}

async function networkFirstList(request, url) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    // Only the plain list view is saved. The map and an open drawer are other
    // views of the same address; they are shown fresh or not at all.
    if (url.search === "" && isCacheable(response)) {
      await cache.put(LIST_KEY, response.clone());
    }
    return response;
  } catch (error) {
    const saved = await cache.match(LIST_KEY);
    if (saved) return saved;
    throw error;
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (isCacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function networkFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const saved = await cache.match(request);
    if (saved) return saved;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      IS_LOCAL ? networkFirstStatic(request) : cacheFirstStatic(request),
    );
    return;
  }

  // Only a page load of the list. Client-side navigations and data requests
  // are not "navigate" requests, and pass straight through.
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(networkFirstList(request, url));
  }
});

/** Text from the push payload, never anything but a short string. */
function text(value, fallback, max) {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return value.length > max ? value.slice(0, max) : value;
}

/** The page to open: a path on this site, or the home page. */
function safeTarget(value) {
  // Anything but a string would be turned into one by URL ("undefined", "5").
  if (typeof value !== "string") return "/";
  try {
    const target = new URL(value, self.location.origin);
    return target.origin === self.location.origin
      ? target.pathname + target.search
      : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  if (payload === null || typeof payload !== "object") payload = {};

  const title = text(payload.title, "Wayfind", 100);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: text(payload.body, "", 200),
      // Notifications with the same tag replace each other on the device.
      tag: text(payload.tag, "wayfind", 100),
      icon: ICON,
      badge: ICON,
      data: { url: safeTarget(payload.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const target = safeTarget(data && typeof data === "object" ? data.url : "/");

  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of open) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
          await client.navigate(target);
          return;
        } catch {
          // A window we cannot steer (not controlled by this worker): open a new one.
          break;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
