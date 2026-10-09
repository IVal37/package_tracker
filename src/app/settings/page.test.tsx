import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  ensureUser: vi.fn(),
  getOrCreateAlias: vi.fn(),
  latestGmailConfirmation: vi.fn(),
  countFailedEmails: vi.fn(),
  getNotificationPrefs: vi.fn(),
  getEnv: vi.fn(),
  db: { marker: "db" },
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/db/users", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/db/notification-settings", () => ({
  getNotificationPrefs: mocks.getNotificationPrefs,
}));
vi.mock("@/lib/db/forwarding", () => ({
  getOrCreateAlias: mocks.getOrCreateAlias,
}));
vi.mock("@/lib/db/inbound-emails", () => ({
  latestGmailConfirmation: mocks.latestGmailConfirmation,
  countFailedEmails: mocks.countFailedEmails,
}));
vi.mock("@/lib/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("../sign-in/actions", () => ({ signOut: vi.fn() }));
vi.mock("./actions", () => ({
  regenerateAddressAction: vi.fn(),
  saveNotificationSettingsAction: vi.fn(),
  savePushSubscriptionAction: vi.fn(),
  removePushSubscriptionAction: vi.fn(),
  sendTestPushAction: vi.fn(),
}));

import { DEFAULT_PREFS } from "@/lib/notifications/prefs";
import SettingsPage from "./page";

const USER = { id: "session-user", email: "izaak@example.test" };

const renderPage = async () => render(await SettingsPage());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
  mocks.getOrCreateAlias.mockResolvedValue("izaak-7f3k");
  mocks.latestGmailConfirmation.mockResolvedValue(null);
  mocks.countFailedEmails.mockResolvedValue(0);
  mocks.getNotificationPrefs.mockResolvedValue(structuredClone(DEFAULT_PREFS));
  mocks.getEnv.mockReturnValue({
    INBOUND_EMAIL_DOMAIN: "in.wayfind.test",
    PUSH_SENDER: "fake",
  });
});

describe("Settings page", () => {
  it("requires sign-in before reading anything", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /sign-in"));
    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.getOrCreateAlias).not.toHaveBeenCalled();
    expect(mocks.countFailedEmails).not.toHaveBeenCalled();
  });

  it("shows the session user's own address, asking for it once", async () => {
    await renderPage();

    expect(mocks.ensureUser).toHaveBeenCalledWith(mocks.db, USER);
    expect(mocks.getOrCreateAlias).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
    );
    expect(
      screen.getByText("izaak-7f3k@in.wayfind.test", { selector: "code" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Regenerate address" }),
    ).toBeInTheDocument();
  });

  it("explains Gmail and Outlook forwarding with the address", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Gmail" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Outlook" }),
    ).toBeInTheDocument();
  });

  it("looks up the confirmation code and failures for the session user only", async () => {
    const before = Date.now();
    await renderPage();

    expect(mocks.countFailedEmails).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
    );
    const [db, userId, since] = mocks.latestGmailConfirmation.mock.calls[0]!;
    expect(db).toBe(mocks.db);
    expect(userId).toBe("session-user");
    // Only the last 3 days count.
    const ageMs = before - (since as Date).getTime();
    expect(Math.abs(ageMs - 3 * 86_400_000)).toBeLessThan(5_000);
  });

  it("shows a recent Gmail confirmation code", async () => {
    mocks.latestGmailConfirmation.mockResolvedValue({
      code: "12345678",
      receivedAt: new Date(Date.now() - 5 * 60_000),
    });
    await renderPage();

    expect(
      screen.getByRole("heading", { name: "Gmail confirmation code" }),
    ).toBeInTheDocument();
    expect(screen.getByText("12345678")).toBeInTheDocument();
  });

  it("shows no confirmation section when there is no recent code", async () => {
    await renderPage();
    expect(
      screen.queryByRole("heading", { name: "Gmail confirmation code" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [0, null],
    [1, "1 forwarded email couldn't be read."],
    [3, "3 forwarded emails couldn't be read."],
  ])("reports %i unreadable emails", async (count, text) => {
    mocks.countFailedEmails.mockResolvedValue(count);
    await renderPage();
    if (text) {
      expect(screen.getByRole("status")).toHaveTextContent(text);
    } else {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    }
  });

  it("degrades to a message when no address could be made", async () => {
    mocks.getOrCreateAlias.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByText(/could not be created/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy" }),
    ).not.toBeInTheDocument();
  });
});

describe("Settings page: notifications", () => {
  it("shows the notifications section above email forwarding", async () => {
    await renderPage();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Notifications", "Email forwarding"]);
  });

  it("loads the preferences for the session user only", async () => {
    await renderPage();
    expect(mocks.getNotificationPrefs).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
    );
  });

  it("fills the form with the stored preferences", async () => {
    const prefs = structuredClone(DEFAULT_PREFS);
    prefs.push.delay = false;
    prefs.email.out_for_delivery = true;
    prefs.quiet = {
      enabled: true,
      start: 23 * 60,
      end: 6 * 60 + 30,
      timeZone: "Europe/Paris",
    };
    mocks.getNotificationPrefs.mockResolvedValue(prefs);
    await renderPage();

    expect(screen.getByLabelText("Delays by push")).not.toBeChecked();
    expect(screen.getByLabelText("Out for delivery by email")).toBeChecked();
    expect(
      screen.getByLabelText(
        "Hold alerts during quiet hours and send them when they end",
      ),
    ).toBeChecked();
    expect(screen.getByLabelText("From")).toHaveValue("23:00");
    expect(screen.getByLabelText("Until")).toHaveValue("06:30");
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Paris");
  });

  it("says push is not set up when the server has the fake sender", async () => {
    await renderPage();
    expect(
      await screen.findByText(
        /Push notifications are not set up on this server/,
      ),
    ).toBeInTheDocument();
  });

  it("offers the VAPID public key to the push section when web push is on", async () => {
    mocks.getEnv.mockReturnValue({
      INBOUND_EMAIL_DOMAIN: "in.wayfind.test",
      PUSH_SENDER: "webpush",
      VAPID_PUBLIC_KEY: "BPublicKey",
      VAPID_PRIVATE_KEY: "secret-private-key",
    });
    const { container } = await renderPage();
    // The private key must never reach the page.
    expect(container.innerHTML).not.toContain("secret-private-key");
    expect(
      screen.queryByText(/Push notifications are not set up on this server/),
    ).not.toBeInTheDocument();
  });
});
