// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireLiveAccount: vi.fn(),
  rotateAlias: vi.fn(),
  saveNotificationPrefs: vi.fn(),
  savePushSubscription: vi.fn(),
  removePushSubscription: vi.fn(),
  sendTestPush: vi.fn(),
  retryFailedEmail: vi.fn(),
  deleteFailedEmail: vi.fn(),
  requestEmailRetry: vi.fn(),
  deleteAccount: vi.fn(),
  signOut: vi.fn(),
  provider: { marker: "provider" },
  revalidatePath: vi.fn(),
  db: { marker: "db" },
  sender: { marker: "push-sender" },
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/db/forwarding", () => ({ rotateAlias: mocks.rotateAlias }));
vi.mock("@/lib/auth/account", () => ({
  requireLiveAccount: mocks.requireLiveAccount,
}));
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
vi.mock("@/lib/email/failed", () => ({
  retryFailedEmail: mocks.retryFailedEmail,
}));
vi.mock("@/lib/db/inbound-emails", () => ({
  deleteFailedEmail: mocks.deleteFailedEmail,
}));
vi.mock("@/lib/privacy/delete-account", () => ({
  deleteAccount: mocks.deleteAccount,
}));
vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signOut: mocks.signOut },
  }),
}));
vi.mock("@/lib/tracking", () => ({
  getTrackingProvider: () => mocks.provider,
}));
vi.mock("@/jobs/events", () => ({
  requestEmailRetry: mocks.requestEmailRetry,
}));

import { FIELD } from "@/lib/notifications/form";
import {
  deleteAccountAction,
  dismissEmailAction,
  regenerateAddressAction,
  retryEmailAction,
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
    expect(mocks.requireLiveAccount).toHaveBeenCalledWith(mocks.db, USER);
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
    expect(mocks.requireLiveAccount).toHaveBeenCalledWith(mocks.db, USER);
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
    expect(mocks.requireLiveAccount).not.toHaveBeenCalled();
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

describe("retryEmailAction and dismissEmailAction", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const form = () => {
    const data = new FormData();
    data.set("emailId", ID);
    data.set("userId", "someone-else");
    return data;
  };

  it("retries the session user's email and queues it again", async () => {
    mocks.retryFailedEmail.mockResolvedValue("retried");
    const state = await retryEmailAction({ status: "idle" }, form());
    expect(state).toEqual({ status: "retried" });
    expect(mocks.retryFailedEmail).toHaveBeenCalledWith({
      db: mocks.db,
      userId: "session-user",
      emailId: ID,
      now: expect.any(Date),
    });
    expect(mocks.requestEmailRetry).toHaveBeenCalledWith(ID, expect.any(Date));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it.each(["not_found", "rate_limited"] as const)(
    "queues nothing when the retry is %s",
    async (result) => {
      mocks.retryFailedEmail.mockResolvedValue(result);
      expect(await retryEmailAction({ status: "idle" }, form())).toEqual({
        status: result,
      });
      expect(mocks.requestEmailRetry).not.toHaveBeenCalled();
    },
  );

  it("dismisses the session user's email only", async () => {
    mocks.deleteFailedEmail.mockResolvedValue(true);
    expect(await dismissEmailAction({ status: "idle" }, form())).toEqual({
      status: "dismissed",
    });
    expect(mocks.deleteFailedEmail).toHaveBeenCalledWith(
      mocks.db,
      "session-user",
      ID,
    );
    mocks.deleteFailedEmail.mockResolvedValue(false);
    expect(await dismissEmailAction({ status: "idle" }, form())).toEqual({
      status: "not_found",
    });
  });

  it("does nothing for a signed-out caller", async () => {
    mocks.requireUser.mockRejectedValue(SIGNED_OUT);
    await expect(
      retryEmailAction({ status: "idle" }, form()),
    ).rejects.toThrow();
    await expect(
      dismissEmailAction({ status: "idle" }, form()),
    ).rejects.toThrow();
    expect(mocks.retryFailedEmail).not.toHaveBeenCalled();
    expect(mocks.deleteFailedEmail).not.toHaveBeenCalled();
  });
});

describe("deleteAccountAction", () => {
  const confirm = (word: string) => {
    const data = new FormData();
    data.set("confirm", word);
    data.set("userId", "someone-else");
    return data;
  };

  beforeEach(() => {
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("deletes the session user's account and signs this browser out", async () => {
    mocks.deleteAccount.mockResolvedValue({
      status: "deleted",
      signInRemoved: true,
    });
    expect(
      await deleteAccountAction({ status: "idle" }, confirm(" DELETE ")),
    ).toEqual({ status: "deleted", signInRemoved: true });
    expect(mocks.deleteAccount).toHaveBeenCalledWith({
      db: mocks.db,
      provider: mocks.provider,
      userId: "session-user",
      now: expect.any(Date),
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it.each(["", "delete", "DELETE ME"])(
    "deletes nothing without the exact confirmation (%j)",
    async (word) => {
      expect(
        await deleteAccountAction({ status: "idle" }, confirm(word)),
      ).toEqual({ status: "unconfirmed" });
      expect(mocks.deleteAccount).not.toHaveBeenCalled();
    },
  );

  it.each(["rate_limited", "unavailable"] as const)(
    "passes on %s and stays signed in",
    async (status) => {
      mocks.deleteAccount.mockResolvedValue({ status });
      expect(
        await deleteAccountAction({ status: "idle" }, confirm("DELETE")),
      ).toEqual({ status });
      expect(mocks.signOut).not.toHaveBeenCalled();
    },
  );

  it("does nothing for a signed-out caller", async () => {
    mocks.requireUser.mockRejectedValue(SIGNED_OUT);
    await expect(
      deleteAccountAction({ status: "idle" }, confirm("DELETE")),
    ).rejects.toThrow();
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });
});
