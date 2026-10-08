// @vitest-environment node
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Runs the real eslint.config.mjs against snippets "located" at a given path,
// so the import restrictions are proven, not just configured.
const eslint = new ESLint();

async function restrictedImportErrors(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter(
    (m) => m.ruleId === "no-restricted-imports",
  );
}

const TRACKER_SYNC = `import { applyTrackerUpdate } from "@/lib/db/tracker-sync";\nexport const x = applyTrackerUpdate;\n`;
const PROVIDER = `import { FakeProvider } from "@/lib/tracking/fake/provider";\nexport const x = FakeProvider;\n`;

describe("tracker-sync import guard", () => {
  it.each([
    "src/app/page.tsx",
    "src/app/actions.ts",
    "src/app/api/webhooks/tracking/route.ts",
    "src/components/shipment-list.tsx",
  ])("rejects an import from %s", async (file) => {
    const errors = await restrictedImportErrors(file, TRACKER_SYNC);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("system-scope");
  });

  it("rejects a relative import path too", async () => {
    const errors = await restrictedImportErrors(
      "src/app/page.tsx",
      `import { applyTrackerUpdate } from "../lib/db/tracker-sync";\nexport const x = applyTrackerUpdate;\n`,
    );
    expect(errors).toHaveLength(1);
  });

  it.each([
    "src/lib/shipments/sync/handle-webhook.ts",
    "src/jobs/refetch-stale.ts",
    "src/lib/db/tracker-sync.test.ts",
  ])("allows an import from %s", async (file) => {
    expect(await restrictedImportErrors(file, TRACKER_SYNC)).toHaveLength(0);
  });
});

describe("provider import guard", () => {
  it.each(["src/app/page.tsx", "src/jobs/refetch-stale.ts"])(
    "still rejects importing a specific provider from %s",
    async (file) => {
      const errors = await restrictedImportErrors(file, PROVIDER);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain("TrackingProvider");
    },
  );

  it("allows provider imports inside src/lib/tracking", async () => {
    expect(
      await restrictedImportErrors("src/lib/tracking/index.ts", PROVIDER),
    ).toHaveLength(0);
  });
});
