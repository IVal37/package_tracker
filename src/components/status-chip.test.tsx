import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { STATUSES } from "@/lib/tracking";
import { StatusChip } from "./status-chip";

const EXPECTED_LABELS = {
  Pending: "Pending",
  InfoReceived: "Info received",
  InTransit: "In transit",
  OutForDelivery: "Out for delivery",
  AttemptFail: "Delivery attempted",
  Delivered: "Delivered",
  AvailableForPickup: "Ready for pickup",
  Exception: "Exception",
  Expired: "Expired",
} as const;

describe("StatusChip", () => {
  it.each(STATUSES)("renders the right chip for %s", (status) => {
    render(<StatusChip status={status} />);
    const chip = screen.getByText(EXPECTED_LABELS[status]);
    expect(chip).toHaveAttribute("data-status", status);
  });

  it("gives problem statuses a distinct colour from delivered", () => {
    render(
      <>
        <StatusChip status="Exception" />
        <StatusChip status="Delivered" />
      </>,
    );
    expect(screen.getByText("Exception").className).toContain("red");
    expect(screen.getByText("Delivered").className).toContain("green");
  });
});
