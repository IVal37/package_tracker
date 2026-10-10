import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    SUPPORT_EMAIL: "help@wayfind.test",
    ACTIVE_PACKAGE_CAP: 25,
  }),
}));

import { isPublicPath } from "@/lib/auth/paths";
import TermsPage from "./page";

describe("Terms", () => {
  it("is public", () => {
    expect(isPublicPath("/terms")).toBe(true);
  });

  it("states the package cap, links the privacy policy and gives a contact", async () => {
    render(await TermsPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Terms of use" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/up to 25 packages at once/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "privacy policy" }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      screen.getByRole("link", { name: "help@wayfind.test" }),
    ).toHaveAttribute("href", "mailto:help@wayfind.test");
  });
});
