import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ForwardingInstructions } from "./forwarding-instructions";

const ADDRESS = "izaak-7f3k@in.wayfind.test";

describe("ForwardingInstructions on a computer", () => {
  it("gives Gmail and Outlook steps that name the address", () => {
    render(<ForwardingInstructions address={ADDRESS} device="computer" />);

    for (const name of ["Gmail", "Outlook"]) {
      const section = screen.getByRole("heading", { name }).closest("section")!;
      expect(within(section).getByText(ADDRESS)).toBeInTheDocument();
    }
  });

  it("covers iCloud Mail, Yahoo and any other mail app", () => {
    render(<ForwardingInstructions address={ADDRESS} device="computer" />);
    for (const name of ["iCloud Mail", "Yahoo Mail", "Any other mail app"]) {
      const section = screen.getByRole("heading", { name }).closest("section")!;
      expect(within(section).getAllByText(ADDRESS).length).toBeGreaterThan(0);
    }
  });

  it("mentions the confirmation code only for Gmail", () => {
    render(<ForwardingInstructions address="a@b.test" device="computer" />);
    const gmail = screen
      .getByRole("heading", { name: "Gmail" })
      .closest("section")!;
    const outlook = screen
      .getByRole("heading", { name: "Outlook" })
      .closest("section")!;
    expect(gmail).toHaveTextContent(/confirmation code/);
    expect(outlook).toHaveTextContent(/does not ask for a confirmation code/);
  });

  it("tells iCloud readers not to forward everything, and Yahoo readers to forward by hand", () => {
    render(<ForwardingInstructions address={ADDRESS} device="computer" />);
    expect(
      screen.getByRole("heading", { name: "iCloud Mail" }).closest("section")!,
    ).toHaveTextContent(/forward all my email/);
    expect(
      screen.getByRole("heading", { name: "Yahoo Mail" }).closest("section")!,
    ).toHaveTextContent(/paid plan/);
  });

  it("never links the address", () => {
    const { container } = render(
      <ForwardingInstructions address={ADDRESS} device="computer" />,
    );
    expect(container.querySelector("a")).toBeNull();
  });
});

describe.each(["ios", "android"] as const)(
  "ForwardingInstructions on %s",
  (device) => {
    it("leads with forwarding one email by hand, and points automatic forwarding to a computer", () => {
      render(<ForwardingInstructions address={ADDRESS} device={device} />);
      const byHand = screen
        .getByRole("heading", { name: "Forward an email now" })
        .closest("section")!;
      expect(within(byHand).getByText(ADDRESS)).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Forward them automatically" })
          .parentElement,
      ).toHaveTextContent(/phone apps can.t set that up/);
      expect(
        screen.queryByRole("heading", { name: "Gmail" }),
      ).not.toBeInTheDocument();
    });

    it("switches to the computer steps on request", async () => {
      const onShowComputer = vi.fn();
      render(
        <ForwardingInstructions
          address={ADDRESS}
          device={device}
          onShowComputer={onShowComputer}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Show the computer steps" }),
      );
      expect(onShowComputer).toHaveBeenCalledOnce();
    });
  },
);

describe("ForwardingInstructions app tips", () => {
  it("names Mail on iPhone only on iOS", () => {
    const { rerender } = render(
      <ForwardingInstructions address={ADDRESS} device="ios" />,
    );
    expect(screen.getByText(/Mail on iPhone/)).toBeInTheDocument();
    rerender(<ForwardingInstructions address={ADDRESS} device="android" />);
    expect(screen.queryByText(/Mail on iPhone/)).not.toBeInTheDocument();
    expect(screen.getByText(/Gmail app/)).toBeInTheDocument();
  });
});
