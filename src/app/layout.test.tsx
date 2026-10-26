import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import RootLayout, { metadata, viewport } from "./layout";

describe("root layout metadata", () => {
  it("names the app and links the icons", () => {
    expect(metadata.title).toBe("Wayfind");
    expect(metadata.icons).toEqual({
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: "/icons/apple-touch-icon.png",
    });
  });

  it("lets iPhone and iPad open it as an app", () => {
    expect(metadata.appleWebApp).toEqual({
      capable: true,
      title: "Wayfind",
      statusBarStyle: "default",
    });
  });

  it("colours the browser chrome with the brand colour", () => {
    expect(viewport.themeColor).toBe("#2563eb");
  });

  it("applies a saved light or dark choice before the page paints", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>page</p>
      </RootLayout>,
    );
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head).toContain("<script>");
    expect(head).toContain("wayfind-theme");
    expect(THEME_BOOT_SCRIPT).toContain("wayfind-theme");
    expect(html).toContain("<p>page</p>");
  });
});
