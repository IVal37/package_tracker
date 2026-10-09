// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_CREATED,
  buildNotificationEvents,
  buildSweepEvents,
  notificationCreatedSchema,
} from "./events";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("buildNotificationEvents", () => {
  it("makes one event per alert, with a stable id so a repeat send is dropped", () => {
    expect(buildNotificationEvents([ID_A, ID_B])).toEqual([
      {
        id: `notification-${ID_A}`,
        name: NOTIFICATION_CREATED,
        data: { notificationId: ID_A },
      },
      {
        id: `notification-${ID_B}`,
        name: NOTIFICATION_CREATED,
        data: { notificationId: ID_B },
      },
    ]);
  });

  it("makes none for none", () => {
    expect(buildNotificationEvents([])).toEqual([]);
  });
});

describe("buildSweepEvents", () => {
  it("allows one retry per hour per alert", () => {
    const hour1 = buildSweepEvents([ID_A], new Date("2026-06-10T10:05:00Z"));
    const same = buildSweepEvents([ID_A], new Date("2026-06-10T10:55:00Z"));
    const hour2 = buildSweepEvents([ID_A], new Date("2026-06-10T11:05:00Z"));
    expect(hour1[0]?.id).toBe(same[0]?.id);
    expect(hour1[0]?.id).not.toBe(hour2[0]?.id);
  });

  it("never reuses the id of the first send", () => {
    const [sweep] = buildSweepEvents([ID_A], new Date("2026-06-10T10:05:00Z"));
    expect(sweep?.id).not.toBe(buildNotificationEvents([ID_A])[0]?.id);
    expect(sweep?.data).toEqual({ notificationId: ID_A });
  });
});

describe("notificationCreatedSchema", () => {
  it("accepts a uuid", () => {
    expect(
      notificationCreatedSchema.safeParse({ notificationId: ID_A }).success,
    ).toBe(true);
  });

  it.each([
    [{}],
    [{ notificationId: "" }],
    [{ notificationId: "not-a-uuid" }],
    [{ notificationId: 5 }],
    [null],
  ])("rejects %j", (data) => {
    expect(notificationCreatedSchema.safeParse(data).success).toBe(false);
  });
});
