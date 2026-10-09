// Removing what this device holds for the signed-in user: the offline copy of
// their package list, and their push subscription. A shared or handed-on device
// must not keep showing the last person's packages or buzzing for them.
// Browser-side; every step is best effort and none may block signing out.

/** Everything the service worker caches starts with this (see public/sw.js). */
export const CACHE_PREFIX = "wayfind-";

type CacheKeys = Pick<CacheStorage, "keys" | "delete">;

/** Deletes the offline copies. Quietly does nothing where there is no cache. */
export async function clearOfflineCaches(
  storage: CacheKeys | undefined = typeof caches === "undefined"
    ? undefined
    : caches,
): Promise<void> {
  if (!storage) return;
  try {
    const names = await storage.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX))
        .map((name) => storage.delete(name)),
    );
  } catch {
    // Nothing more can be done.
  }
}

/** How long signing out waits for this clean-up before carrying on. */
export const CLEANUP_TIMEOUT_MS = 3000;

/**
 * Forgets this device: tells the server to stop sending it alerts, drops the
 * push subscription in the browser, and deletes the offline copies. Never
 * throws and never takes longer than the timeout.
 */
export async function forgetThisDevice(options: {
  /** Tells the server to forget one device (needs the session, so run before sign-out). */
  removeFromServer: (endpoint: string) => Promise<void>;
  timeoutMs?: number;
}): Promise<void> {
  const work = (async () => {
    try {
      const registration =
        typeof navigator !== "undefined" && "serviceWorker" in navigator
          ? await navigator.serviceWorker.getRegistration()
          : undefined;
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        // Server first: if it fails the browser still unsubscribes below.
        try {
          await options.removeFromServer(subscription.endpoint);
        } catch {
          // Stale rows are removed when the push service reports them gone.
        }
        await subscription.unsubscribe();
      }
    } catch {
      // No push on this device, or the browser refused.
    }
    await clearOfflineCaches();
  })();

  await Promise.race([
    work,
    new Promise<void>((resolve) =>
      setTimeout(resolve, options.timeoutMs ?? CLEANUP_TIMEOUT_MS),
    ),
  ]);
}
