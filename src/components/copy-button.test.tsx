import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CopyButton } from "./copy-button";

describe("CopyButton", () => {
  it("copies the text and says so", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText");
    render(<CopyButton text="izaak-7f3k@in.wayfind.test" />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(write).toHaveBeenCalledWith("izaak-7f3k@in.wayfind.test");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("stays quiet when the browser refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );
    render(<CopyButton text="x" />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});
