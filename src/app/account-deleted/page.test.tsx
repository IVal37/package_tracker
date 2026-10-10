import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/clear-offline-cache", () => ({
  ClearOfflineCache: () => <span data-testid="clear-cache" />,
}));

import AccountDeletedPage from "./page";

const renderPage = async (signin?: string) =>
  render(
    await AccountDeletedPage({
      searchParams: Promise.resolve(signin ? { signin } : {}),
    }),
  );

describe("Account deleted page", () => {
  it("confirms the deletion and clears this device's saved list", async () => {
    await renderPage();
    expect(
      screen.getByRole("heading", { name: "Your account is deleted" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("clear-cache")).toBeInTheDocument();
    expect(screen.queryByText(/could not be removed/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to sign-in" }),
    ).toHaveAttribute("href", "/sign-in");
  });

  it("says so when the sign-in could not be removed", async () => {
    await renderPage("kept");
    expect(screen.getByText(/could not be removed/)).toBeInTheDocument();
  });
});
