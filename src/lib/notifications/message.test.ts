// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Status } from "@/lib/tracking/status";
import {
  buildMessage,
  escapeHtml,
  shipmentUrl,
  type AlertSubject,
} from "./message";
import type { NotificationKind } from "./rules";

const ID = "11111111-1111-4111-8111-111111111111";
const APP = "https://wayfind.example.test";

const subject = (overrides: Partial<AlertSubject> = {}): AlertSubject => ({
  nickname: "Merino socks",
  trackingNumber: "1Z999AA10123456784",
  status: "Delivered",
  eta: null,
  lastCheckpoint: {
    message: "Left at front door",
    locationText: "MEMPHIS, TN",
  },
  ...overrides,
});

const build = (
  kind: NotificationKind,
  overrides: Partial<AlertSubject> = {},
  appUrl = APP,
) =>
  buildMessage({ kind, subject: subject(overrides), shipmentId: ID, appUrl });

describe("titles", () => {
  it.each<[NotificationKind, Status, string]>([
    ["out_for_delivery", "OutForDelivery", "Out for delivery: Merino socks"],
    ["delivered", "Delivered", "Delivered: Merino socks"],
    ["delivered", "AvailableForPickup", "Ready for pickup: Merino socks"],
    ["problem", "Exception", "Delivery problem: Merino socks"],
    ["problem", "AttemptFail", "Delivery attempted: Merino socks"],
    ["delay", "InTransit", "Running late: Merino socks"],
  ])("%s / %s -> %s", (kind, status, title) => {
    const message = build(kind, { status });
    expect(message.push.title).toBe(title);
    expect(message.email.subject).toBe(title);
  });

  it("calls an unnamed package 'Your package'", () => {
    expect(build("delivered", { nickname: null }).push.title).toBe(
      "Delivered: Your package",
    );
    expect(build("delivered", { nickname: "   " }).push.title).toBe(
      "Delivered: Your package",
    );
  });

  it("never puts the tracking number in the title or push body (lock screens)", () => {
    for (const kind of [
      "out_for_delivery",
      "delivered",
      "problem",
      "delay",
    ] as const) {
      const { push } = build(kind, { nickname: null, lastCheckpoint: null });
      expect(push.title).not.toContain("1Z999");
      expect(push.body).not.toContain("1Z999");
    }
  });

  it("cuts a very long name and flattens line breaks and control characters", () => {
    const { push } = build("delivered", {
      nickname: `Line one\nLine two\u0007 ${"x".repeat(300)}`,
    });
    expect(push.title.length).toBeLessThanOrEqual(100);
    expect(push.title).not.toMatch(/[\n\u0007]/);
    expect(push.title.startsWith("Delivered: Line one Line two")).toBe(true);
  });
});

describe("push body", () => {
  it("uses the courier's words and the place", () => {
    expect(build("delivered").push.body).toBe(
      "Left at front door · MEMPHIS, TN",
    );
  });

  it("falls back to a sentence for each kind when there is no checkpoint", () => {
    const bodies = (
      [
        ["out_for_delivery", "OutForDelivery"],
        ["delivered", "Delivered"],
        ["delivered", "AvailableForPickup"],
        ["problem", "Exception"],
        ["problem", "AttemptFail"],
        ["delay", "InTransit"],
      ] as const
    ).map(
      ([kind, status]) =>
        build(kind, { status, lastCheckpoint: null }).push.body,
    );
    expect(new Set(bodies).size).toBe(bodies.length);
    for (const body of bodies) expect(body.length).toBeGreaterThan(10);
  });

  it("uses whichever of message and place exists", () => {
    expect(
      build("delivered", {
        lastCheckpoint: { message: null, locationText: "MEMPHIS, TN" },
      }).push.body,
    ).toBe("MEMPHIS, TN");
    expect(
      build("delivered", {
        lastCheckpoint: { message: "Delivered", locationText: null },
      }).push.body,
    ).toBe("Delivered");
  });

  it("adds the new estimated delivery day to a delay alert, in UTC", () => {
    const { push } = build("delay", {
      status: "InTransit",
      eta: new Date("2026-06-25T23:30:00Z"),
    });
    expect(push.body).toContain("Estimated delivery: Thursday, Jun 25.");
  });

  it("does not mention an ETA for other kinds", () => {
    expect(
      build("delivered", { eta: new Date("2026-06-25T12:00:00Z") }).push.body,
    ).not.toContain("Estimated");
  });

  it("is cut to a sensible length", () => {
    const long = "word ".repeat(200);
    const { push } = build("delivered", {
      lastCheckpoint: { message: long, locationText: long },
    });
    expect(push.body.length).toBeLessThanOrEqual(200);
  });
});

describe("links and tag", () => {
  it("opens the shipment in the app and groups by shipment", () => {
    const { push } = build("delivered");
    expect(push.url).toBe(`${APP}/?shipment=${ID}`);
    expect(push.tag).toBe(`shipment-${ID}`);
  });

  it("tolerates a trailing slash on the app url", () => {
    expect(build("delivered", {}, `${APP}/`).push.url).toBe(
      `${APP}/?shipment=${ID}`,
    );
    expect(build("delivered", {}, `${APP}///`).email.text).toContain(
      `${APP}/settings`,
    );
  });

  it("only ever builds a link from a UUID", () => {
    expect(shipmentUrl(APP, ID)).toBe(`${APP}/?shipment=${ID}`);
    for (const bad of [
      "",
      "not-an-id",
      `${ID}"><script>`,
      `${ID}&x=1`,
      "../../etc/passwd",
    ]) {
      expect(() => shipmentUrl(APP, bad)).toThrow();
      expect(() =>
        buildMessage({
          kind: "delivered",
          subject: subject(),
          shipmentId: bad,
          appUrl: APP,
        }),
      ).toThrow();
    }
  });
});

describe("email", () => {
  it("has plain text with the tracking number, the link and a way to change settings", () => {
    const { text } = build("delivered").email;
    expect(text).toContain("Left at front door · MEMPHIS, TN");
    expect(text).toContain("Tracking number: 1Z999AA10123456784");
    expect(text).toContain(`View it: ${APP}/?shipment=${ID}`);
    expect(text).toContain(`${APP}/settings`);
  });

  it("has HTML with the same content", () => {
    const { html } = build("delivered").email;
    expect(html).toContain("<h2");
    expect(html).toContain("Delivered: Merino socks");
    expect(html).toContain("1Z999AA10123456784");
    expect(html).toContain(`href="${APP}/?shipment=${ID}"`);
    expect(html).toContain(`href="${APP}/settings"`);
  });

  it("escapes every untrusted value in the HTML", () => {
    const { html, text } = build("delivered", {
      nickname: '<script>alert("x")</script>',
      trackingNumber: "<img src=x onerror=alert(1)>",
      lastCheckpoint: {
        message: "<b onmouseover=alert(1)>hi</b>",
        locationText: `"><svg/onload=alert(1)>`,
      },
    }).email;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b ");
    expect(html).not.toContain("<svg");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x");
    // Plain text is shown as it is: a text/plain part cannot run markup.
    expect(text).toContain("<img src=x onerror=alert(1)>");
  });

  it("adds an ETA line to a delay email", () => {
    const { text, html } = build("delay", {
      status: "InTransit",
      eta: new Date("2026-06-25T12:00:00Z"),
    }).email;
    expect(text).toContain("Estimated delivery: Thursday, Jun 25.");
    expect(html).toContain("Estimated delivery: Thursday, Jun 25.");
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("leaves safe text alone and escapes ampersands first, once", () => {
    expect(escapeHtml("Socks and shoes")).toBe("Socks and shoes");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});
