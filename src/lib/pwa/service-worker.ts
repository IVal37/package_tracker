// Browser-side helpers for the service worker and push. Safe to import in
// client components (no Node, no server code).

export const SERVICE_WORKER_URL = "/sw.js";

/**
 * Registers the app's service worker, which handles push and caches the list.
 * Registering twice is harmless. Returns null where service workers do not exist.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
      scope: "/",
      updateViaCache: "none",
    });
  } catch {
    return null;
  }
}

/** The VAPID public key in the form `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  /** `Notification.permission`, when the API exists. */
  permission: NotificationPermission | null;
  isIos: boolean;
  /** Running as an installed app rather than in a browser tab. */
  isStandalone: boolean;
}

export type PushSupport =
  /** The browser cannot do web push at all. */
  | "unsupported"
  /** iPhone or iPad in a browser tab: push works only once installed to the Home Screen. */
  | "needs_install"
  /** The user said no; only the browser's own settings can change that. */
  | "denied"
  /** Can ask for permission, or already has it. */
  | "available";

/** What this device can do about push. Pure, so every case is testable. */
export function pushSupport(env: PushEnvironment): PushSupport {
  if (env.isIos && !env.isStandalone) return "needs_install";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) {
    return "unsupported";
  }
  if (env.permission === "denied") return "denied";
  return "available";
}

/** Reads the real browser. Only call in an effect or event handler. */
export function currentPushEnvironment(): PushEnvironment {
  const userAgent = navigator.userAgent;
  return {
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    permission: "Notification" in window ? Notification.permission : null,
    // iPadOS reports itself as a Mac with a touch screen.
    isIos:
      /iPad|iPhone|iPod/.test(userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    isStandalone:
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
}
