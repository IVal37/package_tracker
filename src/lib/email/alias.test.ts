import { describe, expect, it } from "vitest";
import {
  aliasFromRecipient,
  formatAddress,
  generateAlias,
  slugFromEmail,
} from "./alias";

describe("slugFromEmail", () => {
  it.each([
    ["izaak.valadez@gmail.com", "izaakvaladez"],
    ["Izaak@Example.COM", "izaak"],
    ["very.long.local.part.indeed@x.test", "verylongloca"],
    ["josé.müller@x.test", "josemuller"],
    ["a_b-c+tag@x.test", "abctag"],
    ["@x.test", "user"],
    ["...@x.test", "user"],
    ["日本語@x.test", "user"],
    ["", "user"],
  ])("%j -> %j", (email, slug) => {
    expect(slugFromEmail(email)).toBe(slug);
  });

  it("never exceeds 12 characters", () => {
    expect(slugFromEmail("abcdefghijklmnopqrstuvwxyz@x.test")).toHaveLength(12);
  });
});

describe("generateAlias", () => {
  const fixed = (bytes: number[]) => () => new Uint8Array(bytes);

  it("is the slug, a dash and 4 characters from the safe alphabet", () => {
    const alias = generateAlias(
      "izaak@x.test",
      fixed([0, 1, 2, 3, 4, 5, 6, 7]),
    );
    expect(alias).toBe("izaak-abcd");
  });

  it("uses only characters that cannot be mistaken for each other", () => {
    for (let i = 0; i < 300; i++) {
      const alias = generateAlias("izaak@x.test");
      expect(alias).toMatch(/^izaak-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/);
    }
  });

  it("skips random bytes that would bias the choice and draws again", () => {
    // 248..255 are rejected (256 % 31 = 8); only the in-range bytes count.
    let call = 0;
    const alias = generateAlias("a@x.test", () => {
      call += 1;
      return call === 1
        ? new Uint8Array([255, 254, 253, 252, 251, 250, 249, 248])
        : new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    });
    expect(alias).toBe("a-abcd");
    expect(call).toBe(2);
  });

  it("gives different aliases from the real random source", () => {
    const aliases = new Set(
      Array.from({ length: 50 }, () => generateAlias("izaak@x.test")),
    );
    expect(aliases.size).toBeGreaterThan(45);
  });

  it("produces a valid alias even for an unusable email", () => {
    expect(generateAlias("", fixed([0, 1, 2, 3, 4, 5, 6, 7]))).toBe(
      "user-abcd",
    );
  });
});

describe("formatAddress", () => {
  it("joins alias and domain", () => {
    expect(formatAddress("izaak-7f3k", "in.wayfind.app")).toBe(
      "izaak-7f3k@in.wayfind.app",
    );
  });
});

describe("aliasFromRecipient", () => {
  const DOMAIN = "in.wayfind.app";

  it.each([
    ["izaak-7f3k@in.wayfind.app", "izaak-7f3k"],
    ["  izaak-7f3k@in.wayfind.app  ", "izaak-7f3k"],
    ["IZAAK-7F3K@IN.WAYFIND.APP", "izaak-7f3k"],
    ["Izaak <izaak-7f3k@in.wayfind.app>", "izaak-7f3k"],
    ["<izaak-7f3k@in.wayfind.app>", "izaak-7f3k"],
    ['"Doe, J" <izaak-7f3k@in.wayfind.app>', "izaak-7f3k"],
    ["a1@in.wayfind.app", "a1"],
  ])("accepts %j", (recipient, alias) => {
    expect(aliasFromRecipient(recipient, DOMAIN)).toBe(alias);
  });

  it.each([
    ["wrong domain", "izaak-7f3k@evil.example"],
    ["sub-domain of ours", "izaak-7f3k@x.in.wayfind.app"],
    ["domain with ours as a prefix", "izaak-7f3k@in.wayfind.app.evil.test"],
    ["plus addressing", "izaak-7f3k+orders@in.wayfind.app"],
    ["two at signs", "a@b@in.wayfind.app"],
    ["no at sign", "izaak-7f3k"],
    ["empty local part", "@in.wayfind.app"],
    ["spaces inside", "iza ak@in.wayfind.app"],
    ["dots", "iza.ak@in.wayfind.app"],
    ["underscore", "iza_ak@in.wayfind.app"],
    ["leading dash", "-izaak@in.wayfind.app"],
    ["double dash", "iza--ak@in.wayfind.app"],
    ["too long", `${"a".repeat(41)}@in.wayfind.app`],
    ["empty", ""],
    ["whitespace", "   "],
    ["header injection", "a@in.wayfind.app\r\nBcc: x@y.test"],
  ])("refuses %s", (_name, recipient) => {
    expect(aliasFromRecipient(recipient, DOMAIN)).toBeNull();
  });

  it("compares the domain case-insensitively", () => {
    expect(aliasFromRecipient("a1@in.wayfind.app", "IN.Wayfind.APP")).toBe(
      "a1",
    );
  });
});
