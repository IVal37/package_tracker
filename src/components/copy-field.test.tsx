import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CopyField } from "./copy-field";

describe("CopyField", () => {
  it("shows the text and copies it on one click", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText");
    render(<CopyField text="order OR shipped" />);

    const box = screen.getByRole("button");
    expect(box).toHaveTextContent("order OR shipped");
    expect(box).toHaveTextContent("Click to copy");

    await user.click(box);

    expect(write).toHaveBeenCalledWith("order OR shipped");
    expect(box).toHaveTextContent("Copied");
  });

  it("stays quiet when the browser refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );
    render(<CopyField text="x" />);

    await user.click(screen.getByRole("button"));

    expect(screen.getByRole("button")).toHaveTextContent("Click to copy");
  });
});
