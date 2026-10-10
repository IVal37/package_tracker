import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FailedEmails, type FailedEmailItem } from "./failed-emails";

const ITEM: FailedEmailItem = {
  id: "11111111-1111-4111-8111-111111111111",
  from: "Shop <orders@shop.example>",
  subject: "Your order has shipped",
  received: "2 days ago",
  reason: "We couldn't read it.",
};

const setup = (
  emails: FailedEmailItem[] = [ITEM],
  total = emails.length,
  retryResult = { status: "retried" as const },
) => {
  const retryAction = vi.fn().mockResolvedValue(retryResult);
  const dismissAction = vi.fn().mockResolvedValue({ status: "dismissed" });
  render(
    <FailedEmails
      emails={emails}
      total={total}
      retryAction={retryAction}
      dismissAction={dismissAction}
    />,
  );
  return { retryAction, dismissAction };
};

describe("FailedEmails", () => {
  it("renders nothing when there are none", () => {
    const { container } = render(
      <FailedEmails
        emails={[]}
        total={0}
        retryAction={vi.fn()}
        dismissAction={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each email with its sender, age and reason", () => {
    setup();
    expect(screen.getByText("Your order has shipped")).toBeInTheDocument();
    expect(
      screen.getByText("Shop <orders@shop.example> · 2 days ago"),
    ).toBeInTheDocument();
    expect(screen.getByText("We couldn't read it.")).toBeInTheDocument();
    expect(
      screen.getByText(/1 forwarded email couldn't be read\./),
    ).toBeInTheDocument();
  });

  it("says when only the newest are shown", () => {
    setup([ITEM], 25);
    expect(screen.getByText(/25 forwarded emails/)).toBeInTheDocument();
    expect(screen.getByText(/The newest 1 are shown/)).toBeInTheDocument();
  });

  it("fills in a missing subject or sender", () => {
    setup([{ ...ITEM, subject: null, from: null }]);
    expect(screen.getByText("(no subject)")).toBeInTheDocument();
    expect(screen.getByText(/Unknown sender/)).toBeInTheDocument();
  });

  it("sends the email's id to Try again and says what happened", async () => {
    const { retryAction } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    const formData = retryAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("emailId")).toBe(ITEM.id);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reading it again.",
    );
  });

  it("tells the user when retries are limited", async () => {
    setup([ITEM], 1, { status: "rate_limited" } as never);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Try again in an hour",
    );
  });

  it("sends the email's id to Dismiss", async () => {
    const { dismissAction } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    const formData = dismissAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("emailId")).toBe(ITEM.id);
    expect(await screen.findByRole("status")).toHaveTextContent("Removed.");
  });
});
