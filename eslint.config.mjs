import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Import restrictions. Each pattern names a module that only certain folders
// may import. A later flat-config block REPLACES an earlier one for the same
// rule, so every folder below lists exactly the patterns that still apply to it.

// Everything goes through TrackingProvider (CLAUDE.md): no importing a
// specific provider from outside src/lib/tracking.
const providerImportPattern = {
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
};

// Same idea for geocoding: only src/lib/geo may touch a specific geocoder.
const geocoderImportPattern = {
  group: [
    "@/lib/geo/geocoder/nominatim",
    "@/lib/geo/geocoder/fake",
    "**/geocoder/nominatim",
    "**/geocoder/fake",
  ],
  message:
    "Import from @/lib/geo/geocoder (the Geocoder interface), not a specific geocoder.",
};

// System-scope queries (not filtered by user) for webhooks and jobs.
const trackerSyncImportPattern = {
  group: ["@/lib/db/tracker-sync", "**/db/tracker-sync"],
  message:
    "tracker-sync is system-scope (not filtered by user). Only src/lib/shipments/sync and src/jobs may import it.",
};

const geoSyncImportPattern = {
  group: ["@/lib/db/geo-sync", "**/db/geo-sync"],
  message:
    "geo-sync is system-scope (reads every user's place text). Only src/lib/geo and src/jobs may import it.",
};

const restrict = (...patterns) => ["error", { patterns }];

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
    // Default: pages, actions, routes and components may import none of these.
    rules: {
      "no-restricted-imports": restrict(
        providerImportPattern,
        geocoderImportPattern,
        trackerSyncImportPattern,
        geoSyncImportPattern,
      ),
    },
  },
  {
    files: ["src/lib/shipments/sync/**"],
    rules: {
      "no-restricted-imports": restrict(
        providerImportPattern,
        geocoderImportPattern,
        geoSyncImportPattern,
      ),
    },
  },
  {
    files: ["src/lib/db/**", "src/jobs/**"],
    rules: {
      "no-restricted-imports": restrict(
        providerImportPattern,
        geocoderImportPattern,
      ),
    },
  },
  {
    files: ["src/lib/geo/**"],
    rules: {
      "no-restricted-imports": restrict(
        providerImportPattern,
        trackerSyncImportPattern,
      ),
    },
  },
  { files: ["src/lib/tracking/**"], rules: { "no-restricted-imports": "off" } },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "public/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
