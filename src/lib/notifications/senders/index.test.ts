// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requiredEnv, stubRequiredEnv } from "../../../../tests/env";
import { resetEnvCache } from "@/lib/env";
import {
  createEmailSender,
  createPushSender,
  getEmailSender,
  getPushSender,
  resetSenderCache,
} from "./index";

const vapid = {
  VAPID_PUBLIC_KEY: "BPublic_-1",
  VAPID_PRIVATE_KEY: "Private_-1",
  VAPID_SUBJECT: "mailto:ops@example.test",
};

describe("createPushSender", () => {
  it("is the fake by default", () => {
    expect(createPushSender({ PUSH_SENDER: "fake" }).name).toBe("fake");
  });

  it("is web push when asked, with the VAPID settings", () => {
    expect(createPushSender({ PUSH_SENDER: "webpush", ...vapid }).name).toBe(
      "webpush",
    );
  });

  it.each([
    ["public key", { VAPID_PUBLIC_KEY: undefined }],
    ["private key", { VAPID_PRIVATE_KEY: undefined }],
    ["subject", { VAPID_SUBJECT: undefined }],
  ])("refuses web push without the %s", (_name, missing) => {
    expect(() =>
      createPushSender({ PUSH_SENDER: "webpush", ...vapid, ...missing }),
    ).toThrow("Invalid environment: missing VAPID settings");
  });
});

describe("createEmailSender", () => {
  it("is the fake by default", () => {
    expect(createEmailSender({ EMAIL_SENDER: "fake" }).name).toBe("fake");
  });

  it("is Resend when asked, with a key and a from address", () => {
    expect(
      createEmailSender({
        EMAIL_SENDER: "resend",
        RESEND_API_KEY: "re_x",
        EMAIL_FROM: "a@b.test",
      }).name,
    ).toBe("resend");
  });

  it.each([
    ["key", { RESEND_API_KEY: undefined, EMAIL_FROM: "a@b.test" }],
    ["from address", { RESEND_API_KEY: "re_x", EMAIL_FROM: undefined }],
  ])("refuses Resend without the %s", (_name, settings) => {
    expect(() =>
      createEmailSender({ EMAIL_SENDER: "resend", ...settings }),
    ).toThrow("Invalid environment: missing Resend settings");
  });
});

describe("getPushSender / getEmailSender", () => {
  beforeEach(() => {
    stubRequiredEnv();
    resetEnvCache();
    resetSenderCache();
  });

  afterEach(() => {
    resetEnvCache();
    resetSenderCache();
  });

  it("build the sender the environment asks for, once", () => {
    expect(requiredEnv.DATABASE_URL).toBeTruthy();
    const push = getPushSender();
    const email = getEmailSender();
    expect(push.name).toBe("fake");
    expect(email.name).toBe("fake");
    expect(getPushSender()).toBe(push);
    expect(getEmailSender()).toBe(email);
  });

  it("start fresh after a reset", () => {
    const first = getPushSender();
    resetSenderCache();
    expect(getPushSender()).not.toBe(first);
  });
});
