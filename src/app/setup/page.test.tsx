import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireLiveAccount: vi.fn(),
  getOrCreateAlias: vi.fn(),
  latestGmailConfirmation: vi.fn(),
  getSetupAnswer: vi.fn(),
  loadSetupSignals: vi.fn(),
  getEnv: vi.fn(),
  headers: vi.fn(),
  db: { marker: "db" },
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/auth/account", () => ({
  requireLiveAccount: mocks.requireLiveAccount,
}));
vi.mock("@/lib/db/forwarding", () => ({
  getOrCreateAlias: mocks.getOrCreateAlias,
}));
vi.mock("@/lib/db/inbound-emails", () => ({
  latestGmailConfirmation: mocks.latestGmailConfirmation,
}));
vi.mock("@/lib/db/setup", () => ({
  getSetupAnswer: mocks.getSetupAnswer,
  loadSetupSignals: mocks.loadSetupSignals,
}));
vi.mock("../actions", () => ({
  completeSetupAction: vi.fn(),
  skipSetupAction: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("../sign-in/actions", () => ({ signOut: vi.fn() }));
vi.mock("../settings/actions", () => ({
  removePushSubscriptionAction: vi.fn(),
}));

import SetupPage from "./page";

const USER = { id: "session-user", email: "izaak@example.test" };

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130";

const renderPage = async () => render(await SetupPage());

/** The server sees this header and the browser reports the same device. */
const withUserAgent = (userAgent: string | null) => {
  mocks.headers.mockResolvedValue(
    new Headers(userAgent ? { "user-agent": userAgent } : {}),
  );
  Object.defineProperty(navigator, "userAgent", {
    value: userAgent ?? "",
    configurable: true,
  });
};

afterEach(() => {
  // Back to jsdom's own user agent.
  Reflect.deleteProperty(navigator, "userAgent");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
  mocks.getOrCreateAlias.mockResolvedValue("izaak-7f3k");
  mocks.latestGmailConfirmation.mockResolvedValue(null);
  mocks.getSetupAnswer.mockResolvedValue({
    completedAt: null,
    skippedAt: null,
  });
  mocks.loadSetupSignals.mockResolvedValue({
    emailsArriving: false,
    pushDevices: 0,
  });
  mocks.getEnv.mockReturnValue({ INBOUND_EMAIL_DOMAIN: "in.wayfind.test" });
  withUserAgent(DESKTOP_UA);
});

describe("Setup page", () => {
  it("requires sign-in before reading anything", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /sign-in"));
    await expect(SetupPage()).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.getOrCreateAlias).not.toHaveBeenCalled();
    expect(mocks.latestGmailConfirmation).not.toHaveBeenCalled();
    expect(mocks.getSetupAnswer).not.toHaveBeenCalled();
    expect(mocks.loadSetupSignals).not.toHaveBeenCalled();
  });

  it("shows the session user's own address, asking for it once", async () => {
    await renderPage();

    expect(mocks.requireLiveAccount).toHaveBeenCalledWith(mocks.db, USER);
    expect(mocks.getOrCreateAlias).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
    );
    expect(
      screen.getByText("izaak-7f3k@in.wayfind.test", { selector: "code" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("does not offer to regenerate the address (that stays in Settings)", async () => {
    await renderPage();
    expect(
      screen.queryByRole("button", { name: "Regenerate address" }),
    ).not.toBeInTheDocument();
    const address = screen
      .getByRole("heading", { name: "Your private address" })
      .closest("section")!;
    expect(
      within(address).getByRole("link", { name: "Settings" }),
    ).toHaveAttribute("href", "/settings");
  });

  it("marks Setup as the current tab", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: "Setup" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("explains Gmail and Outlook forwarding with the address", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Gmail" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Outlook" }),
    ).toBeInTheDocument();
  });

  it("lays out the three steps", async () => {
    await renderPage();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      "Your setup",
      "1. Forward your order emails",
      "2. Install Wayfind",
      "3. Turn on alerts",
    ]);
  });
});

describe("Setup page: the Gmail confirmation", () => {
  it("looks it up for the session user only, over the last 3 days", async () => {
    const before = Date.now();
    await renderPage();

    const [db, userId, since] = mocks.latestGmailConfirmation.mock.calls[0]!;
    expect(db).toBe(mocks.db);
    expect(userId).toBe("session-user");
    const ageMs = before - (since as Date).getTime();
    expect(Math.abs(ageMs - 3 * 86_400_000)).toBeLessThan(5_000);
  });

  const LINK = "https://mail-settings.google.com/mail/vf-abc123";

  it("shows a recent code", async () => {
    mocks.latestGmailConfirmation.mockResolvedValue({
      code: "12345678",
      link: null,
      receivedAt: new Date(Date.now() - 5 * 60_000),
    });
    await renderPage();

    expect(
      screen.getByRole("heading", { name: "Gmail confirmation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("12345678")).toBeInTheDocument();
    expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Confirm in Gmail" }),
    ).not.toBeInTheDocument();
  });

  it("shows a link when Gmail sent a link and no code", async () => {
    mocks.latestGmailConfirmation.mockResolvedValue({
      code: null,
      link: LINK,
      receivedAt: new Date(),
    });
    await renderPage();

    const link = screen.getByRole("link", { name: "Confirm in Gmail" });
    expect(link).toHaveAttribute("href", LINK);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText(/^\d{6,10}$/)).not.toBeInTheDocument();
  });

  it("shows both when Gmail sent both", async () => {
    mocks.latestGmailConfirmation.mockResolvedValue({
      code: "12345678",
      link: LINK,
      receivedAt: new Date(),
    });
    await renderPage();
    expect(
      screen.getByRole("link", { name: "Confirm in Gmail" }),
    ).toBeInTheDocument();
    expect(screen.getByText("12345678")).toBeInTheDocument();
  });

  it("shows no confirmation section when there is no recent one", async () => {
    await renderPage();
    expect(
      screen.queryByRole("heading", { name: "Gmail confirmation" }),
    ).not.toBeInTheDocument();
  });

  it("keeps checking for the code until there is one", async () => {
    await renderPage();
    expect(
      screen.getByRole("button", { name: "Check now" }),
    ).toBeInTheDocument();
  });

  it("stops checking once the code is shown", async () => {
    mocks.latestGmailConfirmation.mockResolvedValue({
      code: "12345678",
      link: null,
      receivedAt: new Date(),
    });
    await renderPage();
    expect(
      screen.queryByRole("button", { name: "Check now" }),
    ).not.toBeInTheDocument();
  });
});

describe("Setup page: which device it opens on", () => {
  it.each([
    ["an iPhone", IPHONE_UA, /iPhone & iPad/],
    ["an Android phone", ANDROID_UA, /Android/],
    ["a computer", DESKTOP_UA, /Computer/],
    ["a request with no user agent", null, /Computer/],
  ])("opens on the right tab for %s", async (_name, userAgent, tab) => {
    withUserAgent(userAgent);
    await renderPage();
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(tab);
  });

  it("still lets the reader open the other devices", async () => {
    withUserAgent(IPHONE_UA);
    await renderPage();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(
      screen.getByRole("heading", { name: "Forward an email now" }),
    ).toBeInTheDocument();
  });
});

describe("Setup page: no address", () => {
  it("degrades to a message but keeps the install and alert steps", async () => {
    mocks.getOrCreateAlias.mockResolvedValue(null);
    await renderPage();

    expect(screen.getByText(/could not be created/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Gmail" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "2. Install Wayfind" }),
    ).toBeInTheDocument();
  });

  it("reads the setup answer and signals for the session user only", async () => {
    await renderPage();
    expect(mocks.getSetupAnswer).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
    );
    expect(mocks.loadSetupSignals).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
    );
  });

  it("shows 'Not started' with done and skip for a new user", async () => {
    await renderPage();
    const status = screen
      .getByRole("heading", { name: "Your setup" })
      .closest("section")!;
    expect(within(status).getByText("Not started")).toBeInTheDocument();
    expect(
      within(status).getByRole("button", { name: "Skip for now" }),
    ).toBeInTheDocument();
  });

  it("shows when setup was completed, and what the app can see", async () => {
    mocks.getSetupAnswer.mockResolvedValue({
      completedAt: new Date("2026-10-30T12:00:00Z"),
      skippedAt: null,
    });
    mocks.loadSetupSignals.mockResolvedValue({
      emailsArriving: true,
      pushDevices: 1,
    });
    await renderPage();
    expect(screen.getByText("Completed on 30 Oct 2026")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark as not done" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Emails are reaching your private address."),
    ).toBeInTheDocument();
    expect(screen.getByText("Alerts are on for 1 device.")).toBeInTheDocument();
  });

  it("shows when setup was skipped", async () => {
    mocks.getSetupAnswer.mockResolvedValue({
      completedAt: null,
      skippedAt: new Date("2026-10-30T12:00:00Z"),
    });
    await renderPage();
    expect(screen.getByText("Skipped on 30 Oct 2026")).toBeInTheDocument();
  });
});
