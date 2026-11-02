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
      expect(within(section).getAllByText(ADDRESS).length).toBeGreaterThan(0);
    }
  });

  it("covers iCloud Mail, Yahoo and any other mail app", () => {
    render(<ForwardingInstructions address={ADDRESS} device="computer" />);
    for (const name of ["iCloud Mail", "Yahoo Mail", "Any other mail app"]) {
      const section = screen.getByRole("heading", { name }).closest("section")!;
      expect(within(section).getAllByText(ADDRESS).length).toBeGreaterThan(0);
    }
  });

  it("mentions the confirmation link or code only for Gmail", () => {
    render(<ForwardingInstructions address="a@b.test" device="computer" />);
    const gmail = screen
      .getByRole("heading", { name: "Gmail" })
      .closest("section")!;
    const outlook = screen
      .getByRole("heading", { name: "Outlook" })
      .closest("section")!;
    expect(gmail).toHaveTextContent(/confirmation link/);
    expect(gmail).toHaveTextContent(/code/);
    expect(outlook).toHaveTextContent(/does not ask for a confirmation code/);
  });

  it("walks through the Gmail filter, including the pitfalls", () => {
    render(<ForwardingInstructions address={ADDRESS} device="computer" />);
    const gmail = screen
      .getByRole("heading", { name: "Gmail" })
      .closest("section")!;
    expect(gmail).toHaveTextContent(/Filters and Blocked Addresses/);
    expect(gmail).toHaveTextContent(/Subject, paste this, with OR in capitals/);
    expect(
      within(gmail).getByText(
        "order OR shipped OR shipping OR delivered OR tracking",
      ),
    ).toBeInTheDocument();
    expect(gmail).toHaveTextContent(/It stays grey until a box has something/);
    expect(gmail).toHaveTextContent(/tick Forward it to/);
    expect(gmail).toHaveTextContent(/Also apply filter to matching/);
    expect(gmail).toHaveTextContent(/only catches new mail/);
  });

  it("numbers the Gmail steps and names every button in its own element", () => {
    render(<ForwardingInstructions address={ADDRESS} device="computer" />);
    const gmail = screen
      .getByRole("heading", { name: "Gmail" })
      .closest("section")!;
    expect(gmail.querySelectorAll("ol > li")).toHaveLength(10);
    const buttons = Array.from(gmail.querySelectorAll("strong")).map(
      (element) => element.textContent,
    );
    expect(buttons).toEqual(
      expect.arrayContaining([
        "Settings",
        "See all settings",
        "Forwarding and POP/IMAP",
        "Add a forwarding address",
        "Filters and Blocked Addresses",
        "Create a new filter",
        "Create filter",
        "Forward it to",
      ]),
    );
  });

  it("puts the address and the subject in copy boxes", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText");
    render(<ForwardingInstructions address={ADDRESS} device="computer" />);
    const gmail = screen
      .getByRole("heading", { name: "Gmail" })
      .closest("section")!;
    const boxes = within(gmail).getAllByTitle("Click to copy");
    expect(boxes.map((box) => box.textContent)).toEqual([
      `${ADDRESS}Click to copy`,
      "order OR shipped OR shipping OR delivered OR tracking" + "Click to copy",
      `${ADDRESS}Click to copy`,
    ]);

    await user.click(boxes[1]!);
    expect(write).toHaveBeenLastCalledWith(
      "order OR shipped OR shipping OR delivered OR tracking",
    );
    expect(boxes[1]).toHaveTextContent("Copied");
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
