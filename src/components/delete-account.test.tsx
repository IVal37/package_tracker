import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { forgetThisDevice } = vi.hoisted(() => ({
  forgetThisDevice: vi.fn(),
}));
vi.mock("@/lib/pwa/device-cleanup", () => ({ forgetThisDevice }));

import { DeleteAccount } from "./delete-account";

beforeEach(() => {
  forgetThisDevice.mockReset();
  forgetThisDevice.mockResolvedValue(undefined);
});

describe("DeleteAccount", () => {
  it("stays disabled until the confirmation word is typed", async () => {
    render(<DeleteAccount action={vi.fn()} leave={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Delete my account" });
    expect(button).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/to delete your account/),
      "DELE",
    );
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/to delete your account/), "TE");
    expect(button).toBeEnabled();
  });

  it("clears this device and leaves once the account is deleted", async () => {
    const action = vi
      .fn()
      .mockResolvedValue({ status: "deleted", signInRemoved: true });
    const leave = vi.fn();
    render(<DeleteAccount action={action} leave={leave} />);

    await userEvent.type(screen.getByLabelText(/to delete/), "DELETE");
    await userEvent.click(
      screen.getByRole("button", { name: "Delete my account" }),
    );

    expect((action.mock.calls[0]?.[1] as FormData).get("confirm")).toBe(
      "DELETE",
    );
    await waitFor(() => expect(leave).toHaveBeenCalledWith("/account-deleted"));
    expect(forgetThisDevice).toHaveBeenCalledOnce();
  });

  it("tells the next page when the sign-in could not be removed", async () => {
    const leave = vi.fn();
    render(
      <DeleteAccount
        action={vi.fn().mockResolvedValue({
          status: "deleted",
          signInRemoved: false,
        })}
        leave={leave}
      />,
    );
    await userEvent.type(screen.getByLabelText(/to delete/), "DELETE");
    await userEvent.click(
      screen.getByRole("button", { name: "Delete my account" }),
    );
    await waitFor(() =>
      expect(leave).toHaveBeenCalledWith("/account-deleted?signin=kept"),
    );
  });

  it.each([
    ["unavailable", /Nothing was deleted/],
    ["rate_limited", /Try again in an hour/],
    ["unconfirmed", /Type DELETE to confirm/],
  ])("explains a %s answer and stays put", async (status, message) => {
    const leave = vi.fn();
    render(
      <DeleteAccount
        action={vi.fn().mockResolvedValue({ status })}
        leave={leave}
      />,
    );
    await userEvent.type(screen.getByLabelText(/to delete/), "DELETE");
    await userEvent.click(
      screen.getByRole("button", { name: "Delete my account" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(leave).not.toHaveBeenCalled();
    expect(forgetThisDevice).not.toHaveBeenCalled();
  });
});
