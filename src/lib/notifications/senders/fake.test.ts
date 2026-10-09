// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeEmailSender, FakePushSender } from "./fake";
import type { EmailMessage, PushPayload, PushTarget } from "./types";

const target: PushTarget = {
  endpoint: "https://push.test/a",
  p256dh: "k",
  auth: "a",
};
const payload: PushPayload = {
  title: "Delivered: Socks",
  body: "Done",
  url: "https://wayfind.test/?shipment=x",
  tag: "shipment-x",
};
const email: EmailMessage = {
  to: "sam@example.test",
  subject: "Delivered: Socks",
  text: "t",
  html: "<p>t</p>",
  idempotencyKey: "key-1",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("FakePushSender", () => {
  it("remembers what it sent and answers sent", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const sender = new FakePushSender();
    await expect(sender.send(target, payload)).resolves.toBe("sent");
    expect(sender.sent).toEqual([{ target, payload }]);
    expect(sender.name).toBe("fake");
  });

  it("answers gone for an endpoint marked gone, and records nothing", async () => {
    const sender = new FakePushSender();
    sender.goneEndpoints.add(target.endpoint);
    await expect(sender.send(target, payload)).resolves.toBe("gone");
    expect(sender.sent).toHaveLength(0);
  });

  it("says so in the log in development, with the title only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await new FakePushSender().send(target, payload);
    expect(JSON.stringify(info.mock.calls)).toContain("Delivered: Socks");
    expect(JSON.stringify(info.mock.calls)).not.toContain("push.test");
  });

  it("stays quiet in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await new FakePushSender().send(target, payload);
    expect(info).not.toHaveBeenCalled();
  });
});

describe("FakeEmailSender", () => {
  it("remembers what it sent", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const sender = new FakeEmailSender();
    await sender.send(email);
    expect(sender.sent).toEqual([email]);
    expect(sender.name).toBe("fake");
  });

  it("sends once for one idempotency key, like the real service", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const sender = new FakeEmailSender();
    await sender.send(email);
    await sender.send(email);
    await sender.send({ ...email, idempotencyKey: "key-2" });
    expect(sender.sent.map((m) => m.idempotencyKey)).toEqual([
      "key-1",
      "key-2",
    ]);
  });

  it("logs only the subject in development, never the recipient", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await new FakeEmailSender().send(email);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain("Delivered: Socks");
    expect(logged).not.toContain("sam@example.test");
  });

  it("stays quiet in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await new FakeEmailSender().send(email);
    expect(info).not.toHaveBeenCalled();
  });
});
