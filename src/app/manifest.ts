import type { MetadataRoute } from "next";
import { BRAND_COLOR } from "@/lib/pwa/icons";

/** Lets Wayfind be installed to the home screen and opened like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wayfind",
    short_name: "Wayfind",
    description: "Every package, one place.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: BRAND_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
