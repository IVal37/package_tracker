import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SignInState } from "@/app/sign-in/actions";
import { SignInForm } from "./sign-in-form";

const submit = async (email = "a@example.test") => {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.click(
    screen.getByRole("button", { name: "Email me a sign-in link" }),
  );
};

describe("SignInForm", () => {
  it("renders an email field and submit button", () => {
    render(<SignInForm action={vi.fn()} />);
    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    ).toBeEnabled();
  });

  it("submits the email and shows the confirmation", async () => {
    const action = vi.fn(
      async (_state: SignInState, formData: FormData): Promise<SignInState> => {
        expect(formData.get("email")).toBe("a@example.test");
        return { status: "sent" };
      },
    );
    render(<SignInForm action={action} />);
    await submit();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Check your email for a sign-in link.",
    );
    expect(action).toHaveBeenCalledOnce();
  });

  it("shows the error message returned by the action", async () => {
    const action = async (): Promise<SignInState> => ({
      status: "error",
      message: "Enter a valid email address.",
    });
    render(<SignInForm action={action} />);
    await submit("x@example.test");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a valid email address.",
    );
  });
});
