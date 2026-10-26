"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { currentDeviceKind, type DeviceKind } from "@/lib/pwa/service-worker";
import { ForwardingInstructions } from "./forwarding-instructions";
import { InstallCard } from "./install-card";

const DEVICES: { kind: DeviceKind; label: string }[] = [
  { kind: "ios", label: "iPhone & iPad" },
  { kind: "android", label: "Android" },
  { kind: "computer", label: "Computer" },
];

const PANEL_ID = "device-panel";
const tabId = (kind: DeviceKind) => `device-tab-${kind}`;

const INSTALL_STEPS: Record<DeviceKind, ReactNode> = {
  ios: (
    <>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Open Wayfind in Safari.</li>
        <li>
          Tap the Share button, then choose <strong>Add to Home Screen</strong>.
        </li>
        <li>Open Wayfind from the new icon, not from Safari.</li>
      </ol>
      <p className="text-slate-600">
        Push alerts on iPhone and iPad need iOS or iPadOS 16.4 or later, and
        only work once Wayfind is installed this way.
      </p>
    </>
  ),
  android: (
    <ol className="list-decimal space-y-1 pl-5">
      <li>Open Wayfind in Chrome.</li>
      <li>
        Tap the ⋮ menu, then <strong>Install app</strong> (or{" "}
        <strong>Add to Home screen</strong>).
      </li>
      <li>Open Wayfind from the new icon.</li>
    </ol>
  ),
  computer: (
    <>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Chrome or Edge: click the install icon at the right end of the address
          bar, then Install.
        </li>
        <li>Safari on a Mac: choose File → Add to Dock.</li>
      </ul>
      <p className="text-slate-600">
        Firefox can&rsquo;t install the app, but push alerts still work in a
        browser tab.
      </p>
    </>
  ),
};

const ALERT_STEPS: Record<DeviceKind, ReactNode> = {
  ios: (
    <p>
      Install Wayfind first (step 2). Then open it from the Home Screen icon, go
      to Settings and choose <strong>Turn on push</strong>.
    </p>
  ),
  android: (
    <p>
      On this phone, open Settings and choose <strong>Turn on push</strong>,
      then allow notifications when Chrome asks.
    </p>
  ),
  computer: (
    <p>
      In the browser or app you use for Wayfind, open Settings and choose{" "}
      <strong>Turn on push</strong>, then allow notifications when it asks. If
      you said no before, allow them in the browser&rsquo;s site settings.
    </p>
  ),
};

interface DeviceSetupProps {
  /** Null when no address could be made; step 1 then shows only the panel. */
  address: string | null;
  /** From the User-Agent on the server, so the first paint is already right. */
  initialDevice: DeviceKind;
  /** The address, its Copy button and the Gmail code, drawn on the server. */
  addressPanel: ReactNode;
}

/**
 * The Setup walkthrough. It opens on the device being used and lets you read
 * the steps for any other, since the first setup is often done on a computer
 * for a phone.
 */
export function DeviceSetup({
  address,
  initialDevice,
  addressPanel,
}: DeviceSetupProps) {
  const [detected, setDetected] = useState(initialDevice);
  const [selected, setSelected] = useState(initialDevice);

  useEffect(() => {
    // The server only has the User-Agent; the browser can also tell an iPad
    // that poses as a Mac. Reads the browser, so it can only run after mount.
    const actual = currentDeviceKind();
    if (actual === initialDevice) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetected(actual);
    setSelected(actual);
  }, [initialDevice]);

  const choose = (kind: DeviceKind) => {
    setSelected(kind);
    document.getElementById(tabId(kind))?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = DEVICES.findIndex((device) => device.kind === selected);
    const last = DEVICES.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % DEVICES.length
        : event.key === "ArrowLeft"
          ? (index + last) % DEVICES.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    choose(DEVICES[next]!.kind);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-slate-600">Show the steps for:</p>
        <div
          role="tablist"
          aria-label="Your device"
          onKeyDown={onKeyDown}
          className="inline-flex flex-wrap gap-1 rounded-md border border-slate-300 bg-surface p-0.5 text-sm"
        >
          {DEVICES.map((device) => {
            const active = device.kind === selected;
            return (
              <button
                key={device.kind}
                id={tabId(device.kind)}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={PANEL_ID}
                tabIndex={active ? 0 : -1}
                onClick={() => setSelected(device.kind)}
                className={
                  active
                    ? "rounded bg-ink px-3 py-1 font-medium text-on-ink"
                    : "rounded px-3 py-1 text-slate-700 hover:bg-slate-100"
                }
              >
                {device.label}
                {device.kind === detected && (
                  <span className="ml-1.5 text-xs opacity-80">
                    · This device
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={tabId(selected)}
        className="space-y-8"
      >
        <section aria-labelledby="step-forward" className="space-y-3">
          <h2 id="step-forward" className="text-lg font-semibold">
            1. Forward your order emails
          </h2>
          {addressPanel}
          {address && (
            <ForwardingInstructions
              address={address}
              device={selected}
              onShowComputer={() => choose("computer")}
            />
          )}
        </section>

        <section aria-labelledby="step-install" className="space-y-3">
          <h2 id="step-install" className="text-lg font-semibold">
            2. Install Wayfind
          </h2>
          <InstallCard />
          <div className="space-y-2 text-sm text-slate-700">
            {INSTALL_STEPS[selected]}
          </div>
        </section>

        <section aria-labelledby="step-alerts" className="space-y-3">
          <h2 id="step-alerts" className="text-lg font-semibold">
            3. Turn on alerts
          </h2>
          <div className="space-y-2 text-sm text-slate-700">
            <p className="text-slate-600">
              Push alerts are turned on separately on each device you want them
              on.
            </p>
            {ALERT_STEPS[selected]}
            <p>
              <Link
                href="/settings#push-heading"
                className="text-link underline"
              >
                Open Settings
              </Link>{" "}
              to turn on push and choose which alerts you get. Alerts by email
              need nothing on the device.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
