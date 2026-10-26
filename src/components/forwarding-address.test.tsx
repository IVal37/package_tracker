import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ForwardingAddress } from "./forwarding-address";

const ADDRESS = "izaak-7f3k@in.wayfind.test";

describe("ForwardingAddress", () => {
  it("shows the address as text with a Copy button", () => {
    render(<ForwardingAddress address={ADDRESS} />);
    expect(screen.getByText(ADDRESS, { selector: "code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("offers Regenerate only when given an action", () => {
    const { rerender } = render(<ForwardingAddress address={ADDRESS} />);
    expect(
      screen.queryByRole("button", { name: "Regenerate address" }),
    ).not.toBeInTheDocument();

    rerender(
      <ForwardingAddress address={ADDRESS} regenerateAction={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Regenerate address" }),
    ).toBeInTheDocument();
  });

  it("never turns the address into a link", () => {
    const { container } = render(<ForwardingAddress address={ADDRESS} />);
    expect(container.querySelector("a")).toBeNull();
  });
});
