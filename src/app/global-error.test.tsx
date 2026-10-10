import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reportClientErrorAction } = vi.hoisted(() => ({
  reportClientErrorAction: vi.fn(),
}));
vi.mock("./error-actions", () => ({ reportClientErrorAction }));

import GlobalError from "./global-error";

beforeEach(() => {
  reportClientErrorAction.mockReset();
  reportClientErrorAction.mockResolvedValue(undefined);
  // global-error renders its own <html>; React warns about that inside a div.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GlobalError", () => {
  it("apologises and offers to try again", async () => {
    const retry = vi.fn();
    render(<GlobalError error={new Error("x")} retry={retry} />);
    expect(
      screen.getByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("reports a browser-only error by its class name", () => {
    render(
      <GlobalError
        error={new TypeError("for jane@example.test")}
        retry={vi.fn()}
      />,
    );
    expect(reportClientErrorAction).toHaveBeenCalledExactlyOnceWith(
      "TypeError",
    );
  });

  it("does not report a server error again (it has a digest)", () => {
    const error = Object.assign(new Error("hidden"), { digest: "12345" });
    render(<GlobalError error={error} retry={vi.fn()} />);
    expect(reportClientErrorAction).not.toHaveBeenCalled();
  });

  it("survives the report failing", () => {
    reportClientErrorAction.mockRejectedValue(new Error("offline"));
    expect(() =>
      render(<GlobalError error={new Error("x")} retry={vi.fn()} />),
    ).not.toThrow();
  });
});
