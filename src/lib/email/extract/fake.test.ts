import { describe, expect, it } from "vitest";
import { FakeExtractor } from "./fake";
import { parseExtraction } from "./validate";

const extractor = new FakeExtractor();
const run = (from: string, subject: string, text: string) =>
  extractor.extract({ from, subject, text });

describe("FakeExtractor: email type", () => {
  it.each([
    ["Your order has shipped!", "Hi Sam,", "shipping_confirmation"],
    ["Your package is on its way", "Hi", "shipping_confirmation"],
    ["Shipment confirmation", "", "shipping_confirmation"],
    ["Order update", "Your tracking number is below.", "shipping_confirmation"],
    [
      "Thanks for your order",
      "We'll email you when it ships.",
      "order_confirmation",
    ],
    ["Order confirmation #123", "", "order_confirmation"],
    ["Your order", "We have received your order.", "order_confirmation"],
    ["Delivered: your package", "", "delivery_update"],
    ["Update", "Your package was delivered at 3pm.", "delivery_update"],
    ["Weekend sale: 30% off", "Shop now", "other"],
    ["", "", "other"],
  ])("%j / %j -> %s", async (subject, text, expected) => {
    await expect(
      run("Shop <a@shop.test>", subject, text),
    ).resolves.toMatchObject({ email_type: expected });
  });
});

describe("FakeExtractor: retailer", () => {
  it.each([
    ["Amazon.com <shipment-tracking@amazon.com>", "Amazon.com"],
    ['"Target Orders" <orders@target.com>', "Target Orders"],
    ["orders@bestbuy.com", "Bestbuy"],
    ["Store <orders@mail.example-store.co.uk>", "Store"],
    ["no-address-here", null],
    ["", null],
  ])("%j -> %j", async (from, expected) => {
    expect((await run(from, "x", "y")).retailer).toBe(expected);
  });
});

describe("FakeExtractor: item and order number", () => {
  it("reads an Item line", async () => {
    const result = await run(
      "S <a@s.test>",
      "Order confirmation",
      "Order #AB-12345\nItem: Merino running socks\nQty 1",
    );
    expect(result.item).toBe("Merino running socks");
    expect(result.order_number).toBe("AB-12345");
  });

  it.each([
    ["Order number: 112-4455667-8899001", "112-4455667-8899001"],
    ["Order # 55501", "55501"],
    ["Your order 1001-A has shipped", "1001-A"],
    ["No order mentioned", null],
  ])("order number from %j -> %j", async (text, expected) => {
    expect((await run("S <a@s.test>", "x", text)).order_number).toBe(expected);
  });

  it("returns null when there is no item line", async () => {
    expect((await run("S <a@s.test>", "x", "Just some words")).item).toBeNull();
  });

  it("keeps long values within the schema limits", async () => {
    const result = await run(
      "S <a@s.test>",
      "Thanks for your order",
      `Item: ${"x".repeat(300)}\nOrder number: ${"9".repeat(100)}`,
    );
    expect(() => parseExtraction(result)).not.toThrow();
  });
});

describe("FakeExtractor: tracking numbers", () => {
  const UPS = "1Z999AA10123456784";

  it("returns strong carrier numbers for a shipping email", async () => {
    const result = await run(
      "S <a@s.test>",
      "Your order has shipped",
      `Tracking: ${UPS}\nAlso TBA123456789012`,
    );
    expect(result.tracking_numbers).toEqual([
      { tracking_number: UPS, carrier: "UPS" },
      { tracking_number: "TBA123456789012", carrier: "AMAZON" },
    ]);
  });

  it("leaves out weak look-alike numbers", async () => {
    const result = await run(
      "S <a@s.test>",
      "Your order has shipped",
      "Reference 123456789012 and order 5550123456",
    );
    expect(result.tracking_numbers).toEqual([]);
  });

  it("finds nothing in an order confirmation, even if a number is there", async () => {
    const result = await run(
      "S <a@s.test>",
      "Thanks for your order",
      `Ref ${UPS}`,
    );
    expect(result.tracking_numbers).toEqual([]);
  });

  it("returns at most five", async () => {
    const numbers = Array.from(
      { length: 8 },
      (_, i) => `TBA00000000000${i}`,
    ).join(" ");
    const result = await run("S <a@s.test>", "Your order has shipped", numbers);
    expect(result.tracking_numbers).toHaveLength(5);
  });

  it("always produces output the real schema accepts", async () => {
    const result = await run(
      "S <a@s.test>",
      "Your order has shipped",
      `Item: Lamp\nOrder #77777\n${UPS}`,
    );
    expect(() => parseExtraction(result)).not.toThrow();
  });

  it("has the name fake and never needs the network", () => {
    expect(extractor.name).toBe("fake");
  });
});
