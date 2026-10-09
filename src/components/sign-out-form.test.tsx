import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ forgetThisDevice: vi.fn() }));

vi.mock("@/lib/pwa/device-cleanup", () => ({
  forgetThisDevice: mocks.forgetThisDevice,
}));

import { SignOutForm } from "./sign-out-form";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.forgetThisDevice.mockResolvedValue(undefined);
});

describe("SignOutForm", () => {
  it("forgets this device first, then signs out", async () => {
    const order: string[] = [];
    mocks.forgetThisDevice.mockImplementation(async () => {
      order.push("forget");
    });
    const signOutAction = vi.fn(async () => {
      order.push("sign out");
    });
    const removeDeviceAction = vi.fn(async () => {});
    render(
      <SignOutForm
        signOutAction={signOutAction}
        removeDeviceAction={removeDeviceAction}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce());
    expect(order).toEqual(["forget", "sign out"]);
    expect(mocks.forgetThisDevice).toHaveBeenCalledExactlyOnceWith({
      removeFromServer: removeDeviceAction,
    });
  });

  it("does not sign out until the clean-up has finished", async () => {
    let release!: () => void;
    mocks.forgetThisDevice.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const signOutAction = vi.fn(async () => {});
    render(<SignOutForm signOutAction={signOutAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOutAction).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce());
  });

  it("signs out even if the clean-up throws", async () => {
    mocks.forgetThisDevice.mockRejectedValue(new Error("boom"));
    const signOutAction = vi.fn(async () => {});
    render(<SignOutForm signOutAction={signOutAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce());
  });

  it("works without a device action, using a no-op", async () => {
    const signOutAction = vi.fn(async () => {});
    render(<SignOutForm signOutAction={signOutAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce());
    const { removeFromServer } = mocks.forgetThisDevice.mock.calls[0]![0] as {
      removeFromServer: (endpoint: string) => Promise<void>;
    };
    await expect(removeFromServer("https://x.test")).resolves.toBeUndefined();
  });

  it("cleans up once, however many times it is submitted", async () => {
    const signOutAction = vi.fn(async () => {});
    render(<SignOutForm signOutAction={signOutAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce());
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOutAction).toHaveBeenCalledTimes(2));
    expect(mocks.forgetThisDevice).toHaveBeenCalledOnce();
  });
});
