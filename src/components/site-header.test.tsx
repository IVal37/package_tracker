import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("shows the brand, the user's email, Upgrade and Sign out", () => {
    render(<SiteHeader email="a@example.test" signOutAction={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "Wayfind" }),
    ).toBeInTheDocument();
    expect(screen.getByText("a@example.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it("links to Settings", () => {
    render(<SiteHeader email="a@example.test" signOutAction={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("submits the sign-out action", async () => {
    const signOutAction = vi.fn(async () => {});
    render(<SiteHeader email="a@example.test" signOutAction={signOutAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOutAction).toHaveBeenCalledOnce();
  });
});
