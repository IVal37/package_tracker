import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Every page and route: HSTS, no sniffing, no framing, a strict
        // referrer, no camera/microphone/location, and the content policy.
        source: "/:path*",
        headers: securityHeaders({
          dev: process.env.NODE_ENV === "development",
        }),
      },
      {
        // The service worker must always be fetched fresh, or a bad version
        // could stay installed. Its own, stricter policy keeps it to its own
        // origin's scripts (it replaces the page policy for this file).
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
