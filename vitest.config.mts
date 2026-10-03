import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    // PGlite (WASM Postgres) boots in beforeAll; give it room on slow runners.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // layout.tsx is declarative boilerplate with nothing to assert.
      exclude: ["src/**/*.test.{ts,tsx}", "src/app/layout.tsx"],
      reporter: ["text", "html"],
    },
  },
});
