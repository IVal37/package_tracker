// @vitest-environment node
import webhookEvents from "../../../../tests/fixtures/ship24/webhook-events.json";
import { server } from "../../../../tests/msw/server";
import {
  INVALID_NUMBER,
  VALID_NUMBER,
  ship24Handlers,
} from "../../../../tests/msw/ship24-handlers";
import { runProviderContract } from "../contract";
import { Ship24Provider } from "./provider";

const WEBHOOK_SECRET = "contract-webhook-secret";

runProviderContract("Ship24Provider", () => {
  server.use(...ship24Handlers);

  return {
    provider: new Ship24Provider({
      apiKey: "contract-api-key",
      webhookSecret: WEBHOOK_SECRET,
      retry: { sleep: async () => {} },
    }),
    providerName: "ship24",
    validNumber: VALID_NUMBER,
    invalidNumber: INVALID_NUMBER,
    unknownTrackerId: "no-such-tracker",
    webhook: {
      body: JSON.stringify(webhookEvents),
      validHeaders: new Headers({ authorization: `Bearer ${WEBHOOK_SECRET}` }),
      invalidHeaders: new Headers({ authorization: "Bearer wrong" }),
    },
  };
});
