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

const GEOCODER = `import { NominatimGeocoder } from "@/lib/geo/geocoder/nominatim";\nexport const x = NominatimGeocoder;\n`;
const FAKE_GEOCODER = `import { FakeGeocoder } from "../lib/geo/geocoder/fake";\nexport const x = FakeGeocoder;\n`;
const GEO_SYNC = `import { findPendingPlaces } from "@/lib/db/geo-sync";\nexport const x = findPendingPlaces;\n`;

describe("geocoder import guard", () => {
  it.each([
    "src/app/page.tsx",
    "src/app/api/webhooks/tracking/route.ts",
    "src/jobs/geocode.ts",
    "src/lib/db/shipments.ts",
    "src/lib/shipments/sync/handle-webhook.ts",
  ])("rejects a specific geocoder from %s", async (file) => {
    for (const source of [GEOCODER, FAKE_GEOCODER]) {
      const errors = await restrictedImportErrors(file, source);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain("Geocoder interface");
    }
  });

  it.each([
    "src/lib/geo/geocode-place.ts",
    "src/lib/geo/geocoder/index.ts",
    "src/lib/geo/geocoder/nominatim.test.ts",
  ])("allows a specific geocoder inside %s", async (file) => {
    expect(await restrictedImportErrors(file, GEOCODER)).toHaveLength(0);
    expect(await restrictedImportErrors(file, FAKE_GEOCODER)).toHaveLength(0);
  });
});

describe("geo-sync import guard", () => {
  it.each([
    "src/app/page.tsx",
    "src/app/actions.ts",
    "src/components/shipment-map.tsx",
    "src/lib/shipments/sync/handle-webhook.ts",
  ])("rejects an import from %s", async (file) => {
    const errors = await restrictedImportErrors(file, GEO_SYNC);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("geo-sync");
  });

  it.each([
    "src/lib/geo/geocode-place.ts",
    "src/jobs/geocode.ts",
    "src/lib/db/geo-sync.test.ts",
  ])("allows an import from %s", async (file) => {
    expect(await restrictedImportErrors(file, GEO_SYNC)).toHaveLength(0);
  });

  it("keeps tracker-sync off limits to the geo folder", async () => {
    expect(
      await restrictedImportErrors(
        "src/lib/geo/geocode-place.ts",
        TRACKER_SYNC,
      ),
    ).toHaveLength(1);
  });
});

const INBOUND_SYNC = `import { findUserIdByAlias } from "@/lib/db/inbound-sync";\nexport const x = findUserIdByAlias;\n`;
const EXTRACTOR = `import { ClaudeExtractor } from "@/lib/email/extract/claude";\nexport const x = ClaudeExtractor;\n`;
const FAKE_EXTRACTOR = `import { FakeExtractor } from "../lib/email/extract/fake";\nexport const x = FakeExtractor;\n`;

describe("inbound-sync import guard", () => {
  it.each([
    "src/app/page.tsx",
    "src/app/api/webhooks/inbound-email/route.ts",
    "src/components/settings-form.tsx",
    "src/lib/geo/geocode-place.ts",
    "src/lib/shipments/sync/handle-webhook.ts",
  ])("rejects an import from %s", async (file) => {
    const errors = await restrictedImportErrors(file, INBOUND_SYNC);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("inbound-sync");
  });

  it.each([
    "src/lib/email/receive.ts",
    "src/jobs/inbound-email.ts",
    "src/lib/db/forwarding.test.ts",
  ])("allows an import from %s", async (file) => {
    expect(await restrictedImportErrors(file, INBOUND_SYNC)).toHaveLength(0);
  });

  it("keeps the other system-scope modules off limits to the email folder", async () => {
    expect(
      await restrictedImportErrors("src/lib/email/receive.ts", TRACKER_SYNC),
    ).toHaveLength(1);
    expect(
      await restrictedImportErrors("src/lib/email/receive.ts", GEO_SYNC),
    ).toHaveLength(1);
  });
});

describe("extractor import guard", () => {
  it.each([
    "src/app/page.tsx",
    "src/app/api/webhooks/inbound-email/route.ts",
    "src/jobs/inbound-email.ts",
    "src/lib/db/orders.ts",
    "src/lib/geo/geocode-place.ts",
    "src/lib/shipments/sync/handle-webhook.ts",
  ])("rejects a specific extractor from %s", async (file) => {
    for (const source of [EXTRACTOR, FAKE_EXTRACTOR]) {
      const errors = await restrictedImportErrors(file, source);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain("Extractor interface");
    }
  });

  it.each([
    "src/lib/email/process.ts",
    "src/lib/email/extract/index.ts",
    "src/lib/email/extract/claude.test.ts",
  ])("allows a specific extractor inside %s", async (file) => {
    expect(await restrictedImportErrors(file, EXTRACTOR)).toHaveLength(0);
    expect(await restrictedImportErrors(file, FAKE_EXTRACTOR)).toHaveLength(0);
  });
});

describe("provider import guard", () => {
  it.each([
    "src/app/page.tsx",
    "src/jobs/refetch-stale.ts",
    "src/lib/geo/geocode-place.ts",
  ])("still rejects importing a specific provider from %s", async (file) => {
    const errors = await restrictedImportErrors(file, PROVIDER);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("TrackingProvider");
  });

  it("allows provider imports inside src/lib/tracking", async () => {
    expect(
      await restrictedImportErrors("src/lib/tracking/index.ts", PROVIDER),
    ).toHaveLength(0);
  });
});

const NOTIFY_SYNC = `import { insertOverdueAlerts } from "@/lib/db/notify-sync";\nexport const x = insertOverdueAlerts;\n`;

describe("notify-sync import guard", () => {
  it.each([
    "src/app/page.tsx",
    "src/app/actions.ts",
    "src/app/settings/actions.ts",
    "src/app/api/webhooks/tracking/route.ts",
    "src/components/settings-form.tsx",
    "src/lib/geo/geocode-place.ts",
    "src/lib/email/process.ts",
    "src/lib/shipments/sync/handle-webhook.ts",
  ])("rejects an import from %s", async (file) => {
    const errors = await restrictedImportErrors(file, NOTIFY_SYNC);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("notify-sync");
  });

  it("rejects a relative import path too", async () => {
    const errors = await restrictedImportErrors(
      "src/app/page.tsx",
      `import { insertOverdueAlerts } from "../lib/db/notify-sync";\nexport const x = insertOverdueAlerts;\n`,
    );
    expect(errors).toHaveLength(1);
  });

  it.each([
    "src/lib/notifications/send.ts",
    "src/jobs/notifications.ts",
    "src/lib/db/notify-sync.test.ts",
  ])("allows an import from %s", async (file) => {
    expect(await restrictedImportErrors(file, NOTIFY_SYNC)).toHaveLength(0);
  });

  it("keeps the other system-scope modules off limits to the notifications folder", async () => {
    for (const source of [TRACKER_SYNC, GEO_SYNC, INBOUND_SYNC]) {
      expect(
        await restrictedImportErrors("src/lib/notifications/send.ts", source),
      ).toHaveLength(1);
    }
  });

  it("keeps notify-sync off limits to the other system-scope folders", async () => {
    for (const file of [
      "src/lib/shipments/sync/handle-webhook.ts",
      "src/lib/geo/geocode-place.ts",
      "src/lib/email/receive.ts",
    ]) {
      expect(await restrictedImportErrors(file, NOTIFY_SYNC)).toHaveLength(1);
    }
  });
});
