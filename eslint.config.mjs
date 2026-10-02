import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Everything goes through TrackingProvider (CLAUDE.md): no importing a
    // specific provider from outside src/lib/tracking.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/tracking/ship24",
                "@/lib/tracking/ship24/*",
                "@/lib/tracking/fake",
                "@/lib/tracking/fake/*",
                "**/tracking/ship24",
                "**/tracking/ship24/*",
                "**/tracking/fake",
                "**/tracking/fake/*",
              ],
              message:
                "Import from @/lib/tracking (the TrackingProvider interface), not a specific provider.",
            },
          ],
        },
      ],
    },
  },
  { files: ["src/lib/tracking/**"], rules: { "no-restricted-imports": "off" } },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
