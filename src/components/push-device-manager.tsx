"use client";

import { useCallback, useEffect, useState } from "react";
import {
  currentPushEnvironment,
  pushSupport,
  registerServiceWorker,
  urlBase64ToUint8Array,
  type PushSupport,
} from "@/lib/pwa/service-worker";
import type { TestPushResult } from "@/lib/notifications/test-push";

interface PushDeviceManagerProps {
  /** The server's VAPID public key, or null when push is not set up there. */
  publicKey: string | null;
  saveAction: (subscription: unknown) => Promise<{ ok: boolean }>;
  removeAction: (endpoint: string) => Promise<void>;
  testAction: () => Promise<TestPushResult>;
}

type Status =
  | { kind: "checking" }
  | { kind: "not_configured" }
  | { kind: "blocked"; reason: Exclude<PushSupport, "available"> }
  | { kind: "off" }
  | { kind: "on" };

const TEST_MESSAGES: Record<TestPushResult["status"], string> = {
  sent: "Test sent. It should appear in a moment.",
  no_devices: "No device is set up for push yet.",
  rate_limited: "That is a lot of tests. Wait a minute and try again.",
  failed: "The test could not be delivered. Try turning push off and on again.",
};

const BLOCKED_MESSAGES: Record<Exclude<PushSupport, "available">, string> = {
  unsupported: "This browser does not support push notifications.",
  needs_install:
    "On iPhone and iPad, push works once Wayfind is installed: tap Share, then Add to Home Screen, and open it from there.",
  denied:
    "Notifications are blocked for this site. Allow them in your browser's site settings, then come back.",
};

/** Turns push on or off for the browser being used, and sends a test. */
export function PushDeviceManager({
  publicKey,
  saveAction,
  removeAction,
  testAction,
}: PushDeviceManagerProps) {
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setStatus({ kind: "not_configured" });
      return;
    }
    const support = pushSupport(currentPushEnvironment());
    if (support !== "available") {
      setStatus({ kind: "blocked", reason: support });
      return;
    }
    const registration = await registerServiceWorker();
    const existing = await registration?.pushManager.getSubscription();
    setStatus({ kind: existing ? "on" : "off" });
  }, [publicKey]);

  useEffect(() => {
    // Reads the browser, so it can only run after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const turnOn = async () => {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      // Asked only now, because the user pressed the button.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus({ kind: "blocked", reason: "denied" });
        return;
      }
      const registration = await registerServiceWorker();
      if (!registration) {
        setStatus({ kind: "blocked", reason: "unsupported" });
        return;
      }
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const saved = await saveAction(subscription.toJSON());
      if (!saved.ok) {
        await subscription.unsubscribe();
        setMessage(
          "This browser's push service isn't supported. Try another browser.",
        );
        return;
      }
      setStatus({ kind: "on" });
    } catch {
      setMessage("Push could not be turned on. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await registerServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removeAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus({ kind: "off" });
    } catch {
      setMessage("Push could not be turned off. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(TEST_MESSAGES[(await testAction()).status]);
    } catch {
      setMessage(TEST_MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="push-heading"
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h3 id="push-heading" className="font-semibold">
        Push on this device
      </h3>

      {status.kind === "checking" && (
        <p className="text-sm text-slate-500">Checking…</p>
      )}
      {status.kind === "not_configured" && (
        <p className="text-sm text-slate-600">
          Push notifications are not set up on this server yet.
        </p>
      )}
      {status.kind === "blocked" && (
        <p className="text-sm text-slate-600">
          {BLOCKED_MESSAGES[status.reason]}
        </p>
      )}
      {status.kind === "off" && (
        <>
          <p className="text-sm text-slate-600">
            Get an alert on this device when a package needs your attention.
          </p>
          <button
            type="button"
            onClick={turnOn}
            disabled={busy}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            Turn on push
          </button>
        </>
      )}
      {status.kind === "on" && (
        <>
          <p className="text-sm text-slate-600">Push is on for this device.</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={sendTest}
              disabled={busy}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
            >
              Send a test
            </button>
            <button
              type="button"
              onClick={turnOff}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-60"
            >
              Turn off push
            </button>
          </div>
        </>
      )}

      {message && (
        <p role="status" className="text-sm text-slate-700">
          {message}
        </p>
      )}
    </section>
  );
}
