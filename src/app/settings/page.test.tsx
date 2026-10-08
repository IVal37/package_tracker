import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  ensureUser: vi.fn(),
  getOrCreateAlias: vi.fn(),
  latestGmailConfirmation: vi.fn(),
  countFailedEmails: vi.fn(),
  db: { marker: "db" },
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/db/users", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/db/forwarding", () => ({
  getOrCreateAlias: mocks.getOrCreateAlias,
}));
vi.mock("@/lib/db/inbound-emails", () => ({
  latestGmailConfirmation: mocks.latestGmailConfirmation,
  countFailedEmails: mocks.countFailedEmails,
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ INBOUND_EMAIL_DOMAIN: "in.wayfind.test" }),
}));
vi.mock("../sign-in/actions", () => ({ signOut: vi.fn() }));
vi.mock("./actions", () => ({ regenerateAddressAction: vi.fn() }));

import SettingsPage from "./page";

const USER = { id: "session-user", email: "izaak@example.test" };

const renderPage = async () => render(await SettingsPage());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
  mocks.getOrCreateAlias.mockResolvedValue("izaak-7f3k");
  mocks.latestGmailConfirmation.mockResolvedValue(null);
  mocks.countFailedEmails.mockResolvedValue(0);
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
