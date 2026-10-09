import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "./offline-banner";

const RENDERED = "2026-06-10T15:30:00.000Z";

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OfflineBanner", () => {
  it("shows nothing while online", () => {
    setOnline(true);
    const { container } = render(<OfflineBanner renderedAt={RENDERED} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says so when the page is opened offline, and when the list is from", () => {
    setOnline(false);
    render(<OfflineBanner renderedAt={RENDERED} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("You're offline.");
    expect(banner).toHaveTextContent("Showing your list as it was on");
    expect(banner).toHaveTextContent("2026");
  });

  it("appears when the connection drops and goes away when it returns", () => {
    setOnline(true);
    render(<OfflineBanner renderedAt={RENDERED} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("still says it is a saved copy if the time cannot be read", () => {
    setOnline(false);
    render(<OfflineBanner renderedAt="not a date" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing a saved copy of your list.",
    );
  });

  it("stops listening when removed", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    setOnline(true);
    const { unmount } = render(<OfflineBanner renderedAt={RENDERED} />);
    unmount();
    const removed = remove.mock.calls.map((call) => call[0]);
    expect(removed).toEqual(expect.arrayContaining(["online", "offline"]));
  });
});
