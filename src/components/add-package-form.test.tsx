import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ADD_PACKAGE_MESSAGES,
  type AddPackageState,
} from "@/lib/shipments/form-state";
import { AddPackageForm } from "./add-package-form";

const values = { trackingNumber: "ABC12345", nickname: "Boots" };

const submit = async () => {
  await userEvent.type(screen.getByLabelText("Tracking number"), "ABC12345");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
};

const withState = (state: AddPackageState) =>
  vi.fn(async (): Promise<AddPackageState> => state);

describe("AddPackageForm", () => {
  it("renders the fields and an enabled Add button", () => {
    render(<AddPackageForm action={vi.fn()} />);
    expect(screen.getByLabelText("Tracking number")).toBeRequired();
    expect(screen.getByLabelText("Nickname (optional)")).not.toBeRequired();
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("submits both fields to the action", async () => {
    const action = vi.fn(
      async (
        _s: AddPackageState,
        formData: FormData,
      ): Promise<AddPackageState> => {
        expect(formData.get("trackingNumber")).toBe("ABC12345");
        expect(formData.get("nickname")).toBe("Boots");
        return { status: "success" };
      },
    );
    render(<AddPackageForm action={action} />);
    await userEvent.type(screen.getByLabelText("Nickname (optional)"), "Boots");
    await submit();
    expect(action).toHaveBeenCalledOnce();
  });

  it("confirms a successful add", async () => {
    render(<AddPackageForm action={withState({ status: "success" })} />);
    await submit();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Package added.",
    );
  });

  it.each(["duplicate", "not_found", "unavailable"] as const)(
    "shows the %s message",
    async (error) => {
      render(
        <AddPackageForm
          action={withState({
            status: "error",
            error,
            fieldErrors: {},
            values,
          })}
        />,
      );
      await submit();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        ADD_PACKAGE_MESSAGES[error],
      );
    },
  );

  it("shows field errors next to the inputs and marks them invalid", async () => {
    render(
      <AddPackageForm
        action={withState({
          status: "error",
          error: "invalid",
          fieldErrors: {
            trackingNumber: "Tracking numbers are at least 5 characters.",
            nickname: "Nicknames are at most 60 characters.",
          },
          values,
        })}
      />,
    );
    await submit();

    const tracking = await screen.findByLabelText("Tracking number");
    expect(tracking).toHaveAttribute("aria-invalid", "true");
    expect(tracking).toHaveAccessibleDescription(
      "Tracking numbers are at least 5 characters.",
    );
    expect(
      screen.getByLabelText("Nickname (optional)"),
    ).toHaveAccessibleDescription("Nicknames are at most 60 characters.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps what the user typed after an error", async () => {
    render(
      <AddPackageForm
        action={withState({
          status: "error",
          error: "duplicate",
          fieldErrors: {},
          values,
        })}
      />,
    );
    await submit();
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Tracking number")).toHaveValue("ABC12345");
    expect(screen.getByLabelText("Nickname (optional)")).toHaveValue("Boots");
  });

  it("disables the button while the action is pending", async () => {
    let finish: (state: AddPackageState) => void = () => {};
    const action = () =>
      new Promise<AddPackageState>((resolve) => {
        finish = resolve;
      });
    render(<AddPackageForm action={action} />);
    await submit();

    expect(
      await screen.findByRole("button", { name: "Adding…" }),
    ).toBeDisabled();
    finish({ status: "success" });
    expect(await screen.findByRole("button", { name: "Add" })).toBeEnabled();
  });
});
