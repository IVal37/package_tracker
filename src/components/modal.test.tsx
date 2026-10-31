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

describe("Modal focus", () => {
  const renderWithButtons = () =>
    render(
      <>
        <button type="button">Behind</button>
        <Modal title="Choose">
          <button type="button">First</button>
          <button type="button">Last</button>
        </Modal>
      </>,
    );

  it("wraps Tab from the last control back to the first", () => {
    renderWithButtons();
    screen.getByRole("button", { name: "Last" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("wraps Shift+Tab from the first control to the last", () => {
    renderWithButtons();
    screen.getByRole("button", { name: "First" }).focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });

  it("pulls focus back inside if it got behind the dialog", () => {
    renderWithButtons();
    screen.getByRole("button", { name: "Behind" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("gives focus back to the opener when it closes", () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button type="button">Opener</button>
          {open && <Modal title="Temp">body</Modal>}
        </>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    screen.getByRole("button", { name: "Opener" }).focus();
    rerender(<Harness open />);
    expect(screen.getByRole("dialog")).toHaveFocus();
    rerender(<Harness open={false} />);
    expect(screen.getByRole("button", { name: "Opener" })).toHaveFocus();
  });
});
