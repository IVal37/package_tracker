import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, redirect } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("next/navigation", () => ({ redirect }));
// Server actions are passed as props but never invoked here.
vi.mock("./actions", () => ({
  signInWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

import SignInPage from "./page";

const renderPage = async (search: { error?: string } = {}) =>
  render(await SignInPage({ searchParams: Promise.resolve(search) }));

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue(null);
});

describe("SignInPage", () => {
  it("shows the email form and the Google button", async () => {
    await renderPage();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["auth", /sign-in link didn't work/],
    ["google", /couldn't start Google sign-in/],
  ])("shows a message for ?error=%s", async (error, message) => {
    await renderPage({ error });
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it("ignores an unknown error code", async () => {
    await renderPage({ error: "<script>" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends an already signed-in user to the list", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", email: "a@example.test" });
    await expect(
      SignInPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT /");
  });
});
