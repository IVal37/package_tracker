import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timeline } from "./timeline";

const item = (
  id: string,
  overrides: Partial<
    Parameters<typeof Timeline>[0]["checkpoints"][number]
  > = {},
) => ({
  id,
  status: "InTransit" as const,
  message: `message ${id}`,
  locationText: `place ${id}`,
  occurredAt: new Date("2026-03-04T17:12:00Z"),
  ...overrides,
});

describe("Timeline", () => {
  it("renders checkpoints in the order given (newest first)", () => {
    render(
      <Timeline
        checkpoints={[
          item("new", { occurredAt: new Date("2026-03-04T17:12:00Z") }),
          item("old", { occurredAt: new Date("2026-03-01T08:00:00Z") }),
        ]}
      />,
    );
    const messages = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(messages[0]).toContain("message new");
    expect(messages[1]).toContain("message old");
  });

  it("formats times in UTC and sets a machine-readable datetime", () => {
    render(<Timeline checkpoints={[item("a")]} />);
    const time = screen.getByText(/Mar 4, 2026, 5:12 PM UTC/);
    expect(time).toHaveAttribute("datetime", "2026-03-04T17:12:00.000Z");
  });

  it("falls back to 'Update' without a message and hides a missing location", () => {
    render(
      <Timeline
        checkpoints={[item("a", { message: null, locationText: null })]}
      />,
    );
    expect(screen.getByText("Update")).toBeInTheDocument();
    expect(screen.queryByText("place a")).not.toBeInTheDocument();
  });

  it("shows an empty message when there are no events", () => {
    render(<Timeline checkpoints={[]} />);
    expect(screen.getByText("No tracking events yet.")).toBeInTheDocument();
  });
});
