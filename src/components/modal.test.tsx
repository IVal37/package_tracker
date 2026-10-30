import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./modal";

describe("Modal", () => {
  it("closes on Escape, on the backdrop and on ×", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Hello" onClose={onClose}>
        body
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("modal-backdrop"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("cannot be dismissed without an onClose: no ×, and Escape and backdrop do nothing", () => {
    render(<Modal title="Hello">body</Modal>);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("modal-backdrop"));
    expect(screen.getByRole("dialog", { name: "Hello" })).toBeInTheDocument();
  });
});
