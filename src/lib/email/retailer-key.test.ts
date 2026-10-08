import { describe, expect, it } from "vitest";
import { retailerKey } from "./retailer-key";

describe("retailerKey", () => {
  it.each([
    ["Amazon", "amazon"],
    ["Amazon.com", "amazon"],
    ["AMAZON.COM, Inc.", "amazon"],
    ["amazon.com", "amazon"],
    ["Target", "target"],
    ["Target Corporation", "target"],
    ["Walmart.com", "walmart"],
    ["Best Buy", "bestbuy"],
    ["BestBuy.com", "bestbuy"],
    ["The Home Depot", "homedepot"],
    ["eBay Inc.", "ebay"],
    ["Etsy, Inc.", "etsy"],
    ["Apple", "apple"],
    ["Nike.com", "nike"],
    ["Nike, Inc.", "nike"],
    ["Allbirds", "allbirds"],
    ["Café Roma Store", "caferoma"],
    ["  Trail & Tide Co.  ", "trailtide"],
    ["Store One", "one"],
    ["Mom's Shop LLC", "moms"],
    ["BBC.co.uk", "bbc"],
  ])("%j -> %j", (name, key) => {
    expect(retailerKey(name)).toBe(key);
  });

  it("gives the same key for every spelling of one retailer", () => {
    const keys = new Set(
      [
        "Amazon",
        "Amazon.com",
        "AMAZON.COM, Inc.",
        "amazon",
        "The Amazon Store",
      ].map(retailerKey),
    );
    expect(keys).toEqual(new Set(["amazon"]));
  });

  it("keeps different retailers apart", () => {
    expect(retailerKey("Store One")).not.toBe(retailerKey("Store Two"));
    expect(retailerKey("Target")).not.toBe(retailerKey("Walmart"));
  });

  it.each([
    ["only filler words", "The Shop", "theshop"],
    ["only filler words, punctuated", "Co. Inc.", "coinc"],
  ])("falls back to the whole name for %s", (_name, name, key) => {
    expect(retailerKey(name)).toBe(key);
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["spaces", "   "],
    ["punctuation only", "...---"],
    ["a non-Latin name", "日本"],
  ])("returns null for %s", (_name, name) => {
    expect(retailerKey(name)).toBeNull();
  });
});
