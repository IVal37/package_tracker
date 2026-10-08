import { describe, expect, it } from "vitest";
import { findTrackingCandidates, isValidUpsNumber } from "./tracking-patterns";

const UPS_VALID = "1Z999AA10123456784";

describe("isValidUpsNumber", () => {
  it("accepts a number whose check digit is right", () => {
    expect(isValidUpsNumber(UPS_VALID)).toBe(true);
    expect(isValidUpsNumber(UPS_VALID.toLowerCase())).toBe(true);
  });

  it("rejects every other check digit", () => {
    for (const digit of "012356789") {
      expect(isValidUpsNumber(`${UPS_VALID.slice(0, 17)}${digit}`)).toBe(false);
    }
  });

  it("rejects a number with any one character changed", () => {
    for (const [index, replacement] of [
      [2, "8"],
      [5, "B"], // the letter mapping matters: A=2, B=3
      [8, "2"],
      [12, "9"],
      [16, "5"],
    ] as const) {
      const changed =
        UPS_VALID.slice(0, index) + replacement + UPS_VALID.slice(index + 1);
      expect(isValidUpsNumber(changed), changed).toBe(false);
    }
  });

  it.each([
    ["too short", "1Z999AA1012345678"],
    ["too long", "1Z999AA101234567845"],
    ["no 1Z prefix", "2Z999AA10123456784"],
    ["symbols", "1Z999AA1012345-784"],
    ["empty", ""],
  ])("rejects %s", (_name, value) => {
    expect(isValidUpsNumber(value)).toBe(false);
  });
});

describe("findTrackingCandidates: UPS", () => {
  it("finds a valid number and marks it strong", () => {
    expect(findTrackingCandidates(`Track: ${UPS_VALID} today`)).toEqual([
      { trackingNumber: UPS_VALID, carrier: "ups", strong: true },
    ]);
  });

  it("finds one written with spaces, in lower case", () => {
    expect(findTrackingCandidates("1z 999 aa1 01 2345 6784")).toEqual([
      { trackingNumber: UPS_VALID, carrier: "ups", strong: true },
    ]);
  });

  it("keeps a 1Z number with a bad check digit but does not trust it", () => {
    expect(findTrackingCandidates("1Z999AA10123456785")).toEqual([
      { trackingNumber: "1Z999AA10123456785", carrier: "ups", strong: false },
    ]);
  });

  it("finds one inside a link", () => {
    const text = `Track (https://wwwapps.ups.com/track?tracknum=${UPS_VALID}&loc=en_US)`;
    expect(findTrackingCandidates(text).map((c) => c.trackingNumber)).toEqual([
      UPS_VALID,
    ]);
  });

  it("does not take a match out of the middle of a longer word", () => {
    expect(findTrackingCandidates(`X${UPS_VALID}`)).toEqual([]);
    expect(findTrackingCandidates(`${UPS_VALID}9`)).toEqual([]);
  });
});

describe("findTrackingCandidates: USPS", () => {
  it.each([
    ["22 digits", "9400111899223197428490"],
    ["22 digits in groups", "9400 1118 9922 3197 4284 90"],
    ["20 digits", "92611234567890123456"],
    ["a 93 prefix", "9361289878905010412345"],
    ["a 95 prefix", "9505511234567890123456"],
  ])("finds %s", (_name, text) => {
    const [candidate] = findTrackingCandidates(`Your parcel: ${text}.`);
    expect(candidate).toMatchObject({ carrier: "usps", strong: true });
    expect(candidate?.trackingNumber).toBe(text.replace(/ /g, ""));
  });

  it.each([
    ["a 91 prefix", "9100111899223197428490"],
    ["21 digits", "940011189922319742849"],
    ["23 digits", "94001118992231974284901"],
  ])("ignores %s", (_name, text) => {
    expect(
      findTrackingCandidates(text).filter((c) => c.carrier === "usps"),
    ).toEqual([]);
  });
});

describe("findTrackingCandidates: Amazon, FedEx and DHL", () => {
  it("finds an Amazon Logistics number, any case", () => {
    expect(findTrackingCandidates("Tracking ID: tba123456789012")).toEqual([
      { trackingNumber: "TBA123456789012", carrier: "amazon", strong: true },
    ]);
  });

  it("does not trust a bare 12-digit number as FedEx", () => {
    expect(findTrackingCandidates("Order reference 123456789012")).toEqual([
      { trackingNumber: "123456789012", carrier: "fedex", strong: false },
    ]);
  });

  it.each([
    ["12 digits", "FedEx tracking number: 123456789012"],
    ["15 digits", "Shipped with FedEx Ground, tracking 123456789012345"],
    ["a spaced name", "Fed Ex tracking 123456789012"],
  ])("trusts %s when FedEx is named just before", (_name, text) => {
    const [candidate] = findTrackingCandidates(text);
    expect(candidate).toMatchObject({ carrier: "fedex", strong: true });
  });

  it("does not trust FedEx named far away or after the number", () => {
    expect(
      findTrackingCandidates(`123456789012 ${"x".repeat(250)} FedEx`)[0],
    ).toMatchObject({
      strong: false,
    });
    expect(
      findTrackingCandidates(`FedEx${" ".repeat(250)}123456789012`)[0],
    ).toMatchObject({ strong: false });
  });

  it("trusts a 10-digit number only when DHL is named", () => {
    expect(findTrackingCandidates("DHL Express waybill 1234567890")[0]).toEqual(
      {
        trackingNumber: "1234567890",
        carrier: "dhl",
        strong: true,
      },
    );
    expect(findTrackingCandidates("Call 4155550132 for help")[0]).toMatchObject(
      {
        carrier: "dhl",
        strong: false,
      },
    );
  });
});

describe("findTrackingCandidates: look-alikes and ordering", () => {
  it.each([
    ["an Amazon order id", "Order # 112-4455667-8899001"],
    ["a phone number", "Call (415) 555-0132 or +1 415 555 0132"],
    ["a price", "Total $1,234.56"],
    ["a US zip code", "Ship to 94901-1234"],
    ["a date", "Ordered 2026-10-08"],
    ["a short number", "Qty 12345"],
    ["an email address", "izaak-7f3k@in.wayfind.app"],
    ["plain words", "Thanks for your order!"],
    ["nothing", ""],
  ])("finds nothing in %s", (_name, text) => {
    expect(findTrackingCandidates(text)).toEqual([]);
  });

  it("does not match digits inside a longer run", () => {
    expect(findTrackingCandidates("1234567890123456789012345")).toEqual([]);
  });

  it("returns candidates in order of appearance, without duplicates", () => {
    const text = [
      "Package 1: TBA123456789012",
      `Package 2: ${UPS_VALID}`,
      "Again: TBA123456789012",
      `Link: https://t.test/?n=${UPS_VALID}`,
      "USPS 9400111899223197428490",
    ].join("\n");

    expect(findTrackingCandidates(text).map((c) => c.trackingNumber)).toEqual([
      "TBA123456789012",
      UPS_VALID,
      "9400111899223197428490",
    ]);
  });

  it("copes with a large input quickly", () => {
    const text = "word 1234 ".repeat(50_000);
    const started = Date.now();
    findTrackingCandidates(text);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
