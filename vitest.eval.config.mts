import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Only for `npm run eval:email`. Deliberately has no setup file: the normal one
// blocks network calls, and this check exists to make one real call per email.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["scripts/eval-email.eval.ts"],
  },
});
