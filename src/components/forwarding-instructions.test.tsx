import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ForwardingInstructions } from "./forwarding-instructions";

describe("ForwardingInstructions", () => {
  it("gives Gmail and Outlook steps that name the address", () => {
    render(<ForwardingInstructions address="izaak-7f3k@in.wayfind.test" />);

    for (const name of ["Gmail", "Outlook"]) {
      const section = screen.getByRole("heading", { name }).closest("section")!;
      expect(
        within(section).getByText("izaak-7f3k@in.wayfind.test"),
      ).toBeInTheDocument();
    }
  });

  it("mentions the confirmation code only for Gmail", () => {
    render(<ForwardingInstructions address="a@b.test" />);
    const gmail = screen
      .getByRole("heading", { name: "Gmail" })
      .closest("section")!;
    const outlook = screen
      .getByRole("heading", { name: "Outlook" })
      .closest("section")!;
    expect(gmail).toHaveTextContent(/confirmation code/);
    expect(outlook).toHaveTextContent(/does not ask for a confirmation code/);
  });
});
