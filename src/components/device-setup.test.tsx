import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentDeviceKind: vi.fn() }));

vi.mock("@/lib/pwa/service-worker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pwa/service-worker")>()),
  currentDeviceKind: mocks.currentDeviceKind,
  currentPushEnvironment: () => ({
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    permission: "default",
    isIos: false,
    isStandalone: true,
  }),
}));

import type { DeviceKind } from "@/lib/pwa/service-worker";
import { DeviceSetup } from "./device-setup";

const ADDRESS = "izaak-7f3k@in.wayfind.test";

/** `actual` is what the browser reports; it matches the server unless a test says not. */
const renderSetup = (
  initialDevice: DeviceKind = "computer",
  actual: DeviceKind = initialDevice,
) => {
  mocks.currentDeviceKind.mockReturnValue(actual);
  return render(
    <DeviceSetup
      address={ADDRESS}
      initialDevice={initialDevice}
      addressPanel={<p>the address panel</p>}
    />,
  );
};

const tab = (name: RegExp | string) => screen.getByRole("tab", { name });

beforeEach(() => {
  mocks.currentDeviceKind.mockReset();
  mocks.currentDeviceKind.mockReturnValue("computer");
});

describe("DeviceSetup: choosing a device", () => {
  it("offers the three devices as tabs", () => {
    renderSetup();
    expect(
      screen.getAllByRole("tab").map((element) => element.textContent),
    ).toEqual([
      "iPhone & iPad",
      "Android",
      expect.stringContaining("Computer"),
    ]);
  });

  it.each([
    ["ios", /iPhone & iPad/],
    ["android", /Android/],
    ["computer", /Computer/],
  ] as const)(
    "opens on the %s tab and marks it as this device",
    (device, name) => {
      renderSetup(device);
      expect(tab(name)).toHaveAttribute("aria-selected", "true");
      expect(tab(name)).toHaveTextContent("This device");
      expect(screen.getAllByText("· This device")).toHaveLength(1);
      expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
    },
  );

  it("shows the steps for the starting device", () => {
    renderSetup("ios");
    expect(
      screen.getByRole("heading", { name: "Forward an email now" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Gmail" })).toBeNull();
  });

  it("trusts the browser over the server when they disagree (an iPad posing as a Mac)", () => {
    renderSetup("computer", "ios");
    expect(tab(/iPhone & iPad/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/iPhone & iPad/)).toHaveTextContent("This device");
    expect(tab(/Computer/)).not.toHaveTextContent("This device");
  });

  it("changes every step when another tab is chosen, keeping this device marked", async () => {
    renderSetup("computer");
    expect(screen.getByRole("heading", { name: "Gmail" })).toBeInTheDocument();

    await userEvent.click(tab("Android"));

    expect(tab("Android")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Gmail" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Forward an email now" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Install app/)).toBeInTheDocument();
    expect(tab(/Computer/)).toHaveTextContent("This device");
  });

  it("moves between tabs with the arrow keys, Home and End", async () => {
    renderSetup("computer");
    tab(/Computer/).focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(tab(/iPhone & iPad/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/iPhone & iPad/)).toHaveFocus();

    await userEvent.keyboard("{ArrowLeft}");
    expect(tab(/Computer/)).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{Home}");
    expect(tab(/iPhone & iPad/)).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{End}");
    expect(tab(/Computer/)).toHaveAttribute("aria-selected", "true");
  });

  it("makes only the selected tab a tab stop", () => {
    renderSetup("android");
    expect(tab(/Android/)).toHaveAttribute("tabindex", "0");
    expect(tab("iPhone & iPad")).toHaveAttribute("tabindex", "-1");
  });

  it("labels the panel by the selected tab", async () => {
    renderSetup("computer");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAccessibleName(/Computer/);
    await userEvent.click(tab("Android"));
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Android");
  });

  it("jumps from the phone steps to the computer steps", async () => {
    renderSetup("android");
    await userEvent.click(
      screen.getByRole("button", { name: "Show the computer steps" }),
    );
    expect(tab(/Computer/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Gmail" })).toBeInTheDocument();
  });
});

describe("DeviceSetup: the three steps", () => {
  it("shows the server-drawn address panel inside step 1", () => {
    renderSetup();
    const step = screen
      .getByRole("heading", { name: "1. Forward your order emails" })
      .closest("section")!;
    expect(within(step).getByText("the address panel")).toBeInTheDocument();
  });

  it.each([
    ["ios", /16\.4/],
    ["android", /Chrome/],
    ["computer", /address bar/],
  ] as const)("gives install steps for %s", (device, text) => {
    renderSetup(device);
    const step = screen
      .getByRole("heading", { name: "2. Install Wayfind" })
      .closest("section")!;
    expect(step).toHaveTextContent(text);
  });

  it("says push is set up on each device, and links to Settings", () => {
    renderSetup("ios");
    const step = screen
      .getByRole("heading", { name: "3. Turn on alerts" })
      .closest("section")!;
    expect(step).toHaveTextContent(/separately on each device/);
    expect(step).toHaveTextContent(/Install Wayfind first/);
    expect(
      within(step).getByRole("link", { name: "Open Settings" }),
    ).toHaveAttribute("href", "/settings#push-heading");
  });

  it("does not repeat the iPhone install note once the app is installed", () => {
    const { container } = renderSetup("ios");
    expect(
      container.querySelectorAll("[aria-label='Install Wayfind']"),
    ).toHaveLength(0);
  });
});
