import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  loadAdminStats: vi.fn(),
  getEnv: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => "db" }));
vi.mock("@/lib/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin")>()),
  loadAdminStats: mocks.loadAdminStats,
}));

import AdminPage from "./page";

const days = Array.from({ length: 30 }, (_, i) => ({
  day: `2026-09-${String(10 + i).padStart(2, "0")}`,
  count: i === 29 ? 3 : 0,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEnv.mockReturnValue({
    ADMIN_EMAILS: ["ops@example.test"],
    TRACKING_PROVIDER: "ship24",
    SHIP24_MONTHLY_ALLOWANCE: 200,
  });
  mocks.loadAdminStats.mockResolvedValue({
    provider: "ship24",
    trackersPerDay: days,
    monthSoFar: 50,
    allowance: 200,
    users: 12,
    activeShipments: 34,
    failedEmails: 2,
    failedNotifications: 1,
    oldestPendingEmail: null,
    oldestPendingNotification: new Date(Date.now() - 2 * 3_600_000),
  });
});

describe("Admin page", () => {
  it("is a 404 to someone signed out, and reads nothing", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.loadAdminStats).not.toHaveBeenCalled();
  });

  it("is a 404 to a signed-in user who is not an admin", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "u",
      email: "someone@example.test",
    });
    await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.loadAdminStats).not.toHaveBeenCalled();
  });

  it("is a 404 to everyone when no admin is configured", async () => {
    mocks.getEnv.mockReturnValue({ ADMIN_EMAILS: [] });
    mocks.getCurrentUser.mockResolvedValue({
      id: "u",
      email: "ops@example.test",
    });
    await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows usage against the allowance and the health counts to an admin", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "u",
      email: "Ops@Example.test",
    });
    render(await AdminPage());

    expect(mocks.loadAdminStats).toHaveBeenCalledWith({
      db: "db",
      provider: "ship24",
      allowance: 200,
      now: expect.any(Date),
    });
    expect(screen.getByText(/This month so far/)).toHaveTextContent(
      "This month so far: 50 of 200 (25%).",
    );
    expect(screen.getAllByRole("row")).toHaveLength(31);
    expect(screen.getByText("Active packages").nextSibling).toHaveTextContent(
      "34",
    );
    expect(
      screen.getByText("Oldest email waiting to be read").nextSibling,
    ).toHaveTextContent("None");
  });

  it("says when the allowance is not set", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "u",
      email: "ops@example.test",
    });
    mocks.loadAdminStats.mockResolvedValue({
      ...(await mocks.loadAdminStats()),
      allowance: null,
    });
    render(await AdminPage());
    expect(screen.getByText(/not set/)).toBeInTheDocument();
  });
});
