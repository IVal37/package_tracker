import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewToggle } from "./view-toggle";

describe("ViewToggle", () => {
  it("links to the list and the map", () => {
    render(<ViewToggle view="list" />);
    expect(screen.getByRole("link", { name: "List" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute(
      "href",
      "/?view=map",
    );
  });

  it("marks the list as current in list view", () => {
    render(<ViewToggle view="list" />);
    expect(screen.getByRole("link", { name: "List" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Map" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks the map as current in map view", () => {
    render(<ViewToggle view="map" />);
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "List" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("is a labelled navigation landmark", () => {
    render(<ViewToggle view="list" />);
    expect(
      screen.getByRole("navigation", { name: "View" }),
    ).toBeInTheDocument();
  });
});
