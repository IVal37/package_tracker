import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { BRAND_COLOR } from "@/lib/pwa/icons";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wayfind",
  description: "Track every package in one place.",
  // iPhone and iPad take their home-screen icon and look from these.
  appleWebApp: { capable: true, title: "Wayfind", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = { themeColor: BRAND_COLOR };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
