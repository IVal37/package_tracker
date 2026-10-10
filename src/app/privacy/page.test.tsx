import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { connection } = vi.hoisted(() => ({ connection: vi.fn() }));
vi.mock("next/server", () => ({ connection }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ SUPPORT_EMAIL: "help@wayfind.test", EXPIRE_AFTER_DAYS: 60 }),
}));

import { isPublicPath } from "@/lib/auth/paths";
import { SERVICES } from "@/lib/legal/services";
import PrivacyPage from "./page";

beforeEach(() => connection.mockReset());

describe("Privacy policy", () => {
  it("is public", () => {
    expect(isPublicPath("/privacy")).toBe(true);
  });

  it("renders per request, so it needs no env at build time", async () => {
    render(await PrivacyPage());
    expect(connection).toHaveBeenCalledOnce();
  });

  it("names every service that sees personal data, and what it sees", async () => {
    render(await PrivacyPage());
    const list = screen.getByRole("heading", { name: "Who else sees it" })
      .nextElementSibling as HTMLElement;
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(SERVICES.length);
    for (const service of SERVICES) {
      expect(within(list).getByText(service.name)).toBeInTheDocument();
      expect(list).toHaveTextContent(service.sees);
    }
  });

  it("covers the services the launch plan requires", () => {
    const names = SERVICES.map((s) => s.name).join(" | ");
    for (const required of [
      "Supabase",
      "Vercel",
      "Ship24",
      "Nominatim",
      "OpenFreeMap",
      "Anthropic",
      "Cloudflare",
      "Resend",
      "Inngest",
      "Sentry",
      "push service",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("states the retention rules from the same numbers the cleanup jobs use", async () => {
    render(await PrivacyPage());
    expect(
      screen.getByText("Forwarded emails: 30 days, then deleted."),
    ).toBeInTheDocument();
    expect(screen.getByText("Alert history: 90 days.")).toBeInTheDocument();
    expect(
      screen.getByText("Orders that never shipped: 90 days."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no news for 60 days is marked expired/),
    ).toBeInTheDocument();
  });

  it("says how to export and delete, and whom to ask", async () => {
    render(await PrivacyPage());
    expect(screen.getByText("Download your data")).toBeInTheDocument();
    expect(screen.getByText("Delete your account")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "help@wayfind.test" }),
    ).toHaveAttribute("href", "mailto:help@wayfind.test");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
  });
});
