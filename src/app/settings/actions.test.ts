// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  ensureUser: vi.fn(),
  rotateAlias: vi.fn(),
  saveNotificationPrefs: vi.fn(),
  savePushSubscription: vi.fn(),
  removePushSubscription: vi.fn(),
  sendTestPush: vi.fn(),
  revalidatePath: vi.fn(),
  db: { marker: "db" },
  sender: { marker: "push-sender" },
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/db/forwarding", () => ({ rotateAlias: mocks.rotateAlias }));
vi.mock("@/lib/db/users", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/db/notification-settings", () => ({
  saveNotificationPrefs: mocks.saveNotificationPrefs,
}));
vi.mock("@/lib/db/push-subscriptions", () => ({
  savePushSubscription: mocks.savePushSubscription,
  removePushSubscription: mocks.removePushSubscription,
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ APP_URL: "https://wayfind.example.test" }),
}));
vi.mock("@/lib/notifications/senders", () => ({
  getPushSender: () => mocks.sender,
}));
vi.mock("@/lib/notifications/test-push", () => ({
  sendTestPush: mocks.sendTestPush,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { FIELD } from "@/lib/notifications/form";
import {
  regenerateAddressAction,
  removePushSubscriptionAction,
  saveNotificationSettingsAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from "./actions";

const USER = { id: "session-user", email: "a@example.test" };
const SIGNED_OUT = new Error("NEXT_REDIRECT /sign-in");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
});

describe("regenerateAddressAction", () => {
  it("redirects an unauthenticated caller and rotates nothing", async () => {
    mocks.requireUser.mockRejectedValue(SIGNED_OUT);
    await expect(regenerateAddressAction()).rejects.toThrow(
      "NEXT_REDIRECT /sign-in",
    );
    expect(mocks.rotateAlias).not.toHaveBeenCalled();
  });

  it("rotates the session user's alias and refreshes the page", async () => {
    mocks.rotateAlias.mockResolvedValue("new-alias");
    await regenerateAddressAction();
    expect(mocks.rotateAlias).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("takes no input, so no form field can name another user", () => {
    expect(regenerateAddressAction.length).toBe(0);
  });
});

describe("saveNotificationSettingsAction", () => {
  const form = (extra: Record<string, string> = {}) => {
    const data = new FormData();
    data.set(FIELD.push("delivered"), "on");
    data.set(FIELD.email("problem"), "on");
    data.set(FIELD.quietEnabled, "on");
    data.set(FIELD.quietStart, "22:00");
    data.set(FIELD.quietEnd, "07:00");
    data.set(FIELD.timeZone, "America/Chicago");
    for (const [key, value] of Object.entries(extra)) data.set(key, value);
    return data;
  };

  it("redirects an unauthenticated caller and saves nothing", async () => {
    mocks.requireUser.mockRejectedValue(SIGNED_OUT);
    await expect(
      saveNotificationSettingsAction({ status: "idle" }, form()),
    ).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.saveNotificationPrefs).not.toHaveBeenCalled();
  });

  it("saves the parsed preferences for the session user, ignoring any user id in the form", async () => {
    const state = await saveNotificationSettingsAction(
      { status: "idle" },
      form({ userId: "someone-else", user_id: "someone-else" }),
    );

    expect(state).toEqual({ status: "saved" });
    expect(mocks.ensureUser).toHaveBeenCalledWith(mocks.db, USER);
    expect(mocks.saveNotificationPrefs).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
      expect.objectContaining({
        push: expect.objectContaining({ delivered: true, delay: false }),
        email: expect.objectContaining({ problem: true, delivered: false }),
        quiet: {
          enabled: true,
          start: 22 * 60,
          end: 7 * 60,
          timeZone: "America/Chicago",
        },
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("returns a message and saves nothing for a bad time or time zone", async () => {
    const badTime = await saveNotificationSettingsAction(
      { status: "idle" },
      form({ [FIELD.quietStart]: "25:00" }),
    );
    expect(badTime).toEqual({
      status: "error",
      message: "Enter quiet hours as times, like 22:00.",
    });

    const badZone = await saveNotificationSettingsAction(
      { status: "idle" },
      form({ [FIELD.timeZone]: "Mars/Olympus" }),
    );
    expect(badZone.status).toBe("error");

    expect(mocks.saveNotificationPrefs).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("savePushSubscriptionAction", () => {
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
  };

  it("redirects an unauthenticated caller and stores nothing", async () => {
    mocks.requireUser.mockRejectedValue(SIGNED_OUT);
    await expect(savePushSubscriptionAction(subscription)).rejects.toThrow(
      "NEXT_REDIRECT /sign-in",
    );
    expect(mocks.savePushSubscription).not.toHaveBeenCalled();
  });

  it("stores the device for the session user, never for one named in the input", async () => {
    const result = await savePushSubscriptionAction({
      ...subscription,
      userId: "someone-else",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.ensureUser).toHaveBeenCalledWith(mocks.db, USER);
    expect(mocks.savePushSubscription).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it.each([
    [
      "an endpoint that is not a push service",
      { ...subscription, endpoint: "https://169.254.169.254/x" },
    ],
    ["http", { ...subscription, endpoint: "http://fcm.googleapis.com/x" }],
    ["missing keys", { endpoint: subscription.endpoint }],
    ["nothing", undefined],
    ["a string", "https://fcm.googleapis.com/x"],
  ])("refuses %s without storing anything", async (_name, input) => {
    expect(await savePushSubscriptionAction(input)).toEqual({ ok: false });
    expect(mocks.savePushSubscription).not.toHaveBeenCalled();
    expect(mocks.ensureUser).not.toHaveBeenCalled();
  });
});

describe("removePushSubscriptionAction", () => {
  it("redirects an unauthenticated caller and removes nothing", async () => {
    mocks.requireUser.mockRejectedValue(SIGNED_OUT);
    await expect(
      removePushSubscriptionAction("https://x.test"),
    ).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.removePushSubscription).not.toHaveBeenCalled();
  });

  it("removes the endpoint as the session user", async () => {
    await removePushSubscriptionAction(
      "https://fcm.googleapis.com/fcm/send/abc",
    );
    expect(mocks.removePushSubscription).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
      "https://fcm.googleapis.com/fcm/send/abc",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it.each([undefined, null, 5, {}, ["a"], "x".repeat(2049)])(
    "ignores an endpoint of %j",
    async (value) => {
      await removePushSubscriptionAction(value);
      expect(mocks.removePushSubscription).not.toHaveBeenCalled();
    },
  );
});

describe("sendTestPushAction", () => {
  it("redirects an unauthenticated caller and sends nothing", async () => {
    mocks.requireUser.mockRejectedValue(SIGNED_OUT);
    await expect(sendTestPushAction()).rejects.toThrow(
      "NEXT_REDIRECT /sign-in",
    );
    expect(mocks.sendTestPush).not.toHaveBeenCalled();
  });

  it("tests the session user's devices with the configured sender", async () => {
    mocks.sendTestPush.mockResolvedValue({ status: "sent", devices: 2 });

    expect(await sendTestPushAction()).toEqual({ status: "sent", devices: 2 });
    expect(mocks.sendTestPush).toHaveBeenCalledExactlyOnceWith({
      db: mocks.db,
      sender: mocks.sender,
      userId: "session-user",
      appUrl: "https://wayfind.example.test",
      now: expect.any(Date),
    });
  });

  it("takes no input, so no argument can name another user", () => {
    expect(sendTestPushAction.length).toBe(0);
  });
});
