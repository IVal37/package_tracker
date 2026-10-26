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

  it("links to Setup, just before Settings", () => {
    render(<SiteHeader email="a@example.test" signOutAction={vi.fn()} />);
    const links = screen.getAllByRole("link").map((link) => link.textContent);
    expect(screen.getByRole("link", { name: "Setup" })).toHaveAttribute(
      "href",
      "/setup",
    );
    expect(links.indexOf("Setup")).toBe(links.indexOf("Settings") - 1);
  });

  it("marks only the tab being shown as the current page", () => {
    const { rerender } = render(
      <SiteHeader email="a@example.test" signOutAction={vi.fn()} />,
    );
    expect(screen.getByRole("link", { name: "Setup" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute(
      "aria-current",
    );

    rerender(
      <SiteHeader
        email="a@example.test"
        signOutAction={vi.fn()}
        current="setup"
      />,
    );
    expect(screen.getByRole("link", { name: "Setup" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute(
      "aria-current",
    );

    rerender(
      <SiteHeader
        email="a@example.test"
        signOutAction={vi.fn()}
        current="settings"
      />,
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("submits the sign-out action", async () => {
    const signOutAction = vi.fn(async () => {});
    render(<SiteHeader email="a@example.test" signOutAction={signOutAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOutAction).toHaveBeenCalledOnce();
  });
});
