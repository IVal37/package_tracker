import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RegenerateAddress } from "./regenerate-address";

describe("RegenerateAddress", () => {
  it("asks before submitting anything", async () => {
    const action = vi.fn(async () => {});
    render(<RegenerateAddress action={action} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate address" }),
    );

    expect(screen.getByText(/stop working immediately/)).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it("submits the action once confirmed", async () => {
    const action = vi.fn(async () => {});
    render(<RegenerateAddress action={action} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate address" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, regenerate" }),
    );

    expect(action).toHaveBeenCalledOnce();
  });

  it("can be cancelled", async () => {
    const action = vi.fn(async () => {});
    render(<RegenerateAddress action={action} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate address" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: "Regenerate address" }),
    ).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });
});
