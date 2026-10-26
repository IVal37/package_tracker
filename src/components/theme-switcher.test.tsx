import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { ThemeSwitcher } from "./theme-switcher";

const root = document.documentElement;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  root.removeAttribute("data-theme");
});

describe("ThemeSwitcher", () => {
  it("defaults to matching the device", () => {
    render(<ThemeSwitcher />);
    expect(screen.getByLabelText(/Match device/)).toBeChecked();
    expect(screen.getByLabelText(/^Light/)).not.toBeChecked();
    expect(screen.getByLabelText(/^Dark/)).not.toBeChecked();
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("shows the saved choice", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeSwitcher />);
    expect(await screen.findByLabelText(/^Dark/)).toBeChecked();
  });

  it("applies and saves Dark at once", async () => {
    render(<ThemeSwitcher />);
    await userEvent.click(screen.getByLabelText(/^Dark/));
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByLabelText(/^Dark/)).toBeChecked();
  });

  it("switches to Light, then back to matching the device", async () => {
    render(<ThemeSwitcher />);
    await userEvent.click(screen.getByLabelText(/^Light/));
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await userEvent.click(screen.getByLabelText(/Match device/));
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("still switches this visit when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ThemeSwitcher />);
    expect(screen.getByLabelText(/Match device/)).toBeChecked();
    await userEvent.click(screen.getByLabelText(/^Dark/));
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("copes with localStorage itself being unreachable", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    render(<ThemeSwitcher />);
    await userEvent.click(screen.getByLabelText(/^Light/));
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("says the choice belongs to this device", () => {
    render(<ThemeSwitcher />);
    expect(screen.getByText("Saved on this device.")).toBeInTheDocument();
  });
});
