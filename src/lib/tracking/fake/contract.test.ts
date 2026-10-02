// @vitest-environment node
import { runProviderContract } from "../contract";
import { FakeProvider } from "./provider";

const WEBHOOK_SECRET = "contract-webhook-secret";
const VALID_NUMBER = "FAKE-OFD-1";

runProviderContract("FakeProvider", async () => {
  const provider = new FakeProvider({
    webhookSecret: WEBHOOK_SECRET,
    now: () => new Date("2026-06-01T12:00:00.000Z"),
  });

  // Fake webhook bodies are serialized NormalizedShipments. Repeat the newest
  // event so the contract can check de-duplication.
  const shipment = await provider.createTracking({
    trackingNumber: VALID_NUMBER,
  });
  const [newest] = shipment.events;
  const body = JSON.stringify({
    trackings: [{ ...shipment, events: [...shipment.events, newest] }],
  });

  return {
    provider,
    providerName: "fake",
    validNumber: VALID_NUMBER,
    invalidNumber: "FAKE-INVALID-1",
    unknownTrackerId: "no-such-tracker",
    webhook: {
      body,
      validHeaders: new Headers({ authorization: `Bearer ${WEBHOOK_SECRET}` }),
      invalidHeaders: new Headers({ authorization: "Bearer wrong" }),
    },
  };
});
