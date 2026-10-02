import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Wordmark } from "./wordmark";

describe("Wordmark", () => {
  it("renders the app name and tagline", () => {
    render(<Wordmark />);
    expect(
      screen.getByRole("heading", { name: "Wayfind" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Every package, one place.")).toBeInTheDocument();
  });
});
