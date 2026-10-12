import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Every database test boots its own WASM Postgres (PGlite). With one worker per
// core, a 16-core machine starts 15 of them at once and Windows kills workers
// for lack of memory. CI (4 cores) keeps its usual 3.
const maxWorkers = Math.max(1, Math.min(8, availableParallelism() - 1));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["tests/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
      "workers/**/*.test.ts",
    ],
    maxWorkers,
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
