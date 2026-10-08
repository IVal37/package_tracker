// Private forwarding addresses: <alias>@<domain>, e.g. izaak-7f3k@in.wayfind.app.
// The alias is the only thing that identifies a user to the inbound webhook, so
// it carries 4 random characters on top of a readable prefix.

/** No 0/o, 1/l/i look-alikes, so an address read aloud or typed from a screen is safe. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SUFFIX_LENGTH = 4;
const SLUG_MAX = 12;

export type RandomBytes = (length: number) => Uint8Array;

const defaultRandom: RandomBytes = (length) =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

/** Lower-case letters and digits from the part before the "@", at most 12. */
export function slugFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const slug = local
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, SLUG_MAX);
  return slug || "user";
}

/** A new alias such as "izaak-7f3k". Not guaranteed unique: the caller retries on conflict. */
export function generateAlias(
  email: string,
  random: RandomBytes = defaultRandom,
): string {
  let suffix = "";
  // 31 characters in the alphabet: reject bytes that would bias the choice.
  const limit = 256 - (256 % ALPHABET.length);
  while (suffix.length < SUFFIX_LENGTH) {
    for (const byte of random(SUFFIX_LENGTH * 2)) {
      if (byte < limit && suffix.length < SUFFIX_LENGTH) {
        suffix += ALPHABET[byte % ALPHABET.length];
      }
    }
  }
  return `${slugFromEmail(email)}-${suffix}`;
}

export function formatAddress(alias: string, domain: string): string {
  return `${alias}@${domain}`;
}

const ALIAS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The alias in an envelope recipient, or null if it is not an address of ours.
 * Accepts "a@b" and "Name <a@b>". Anything with a second "@", "+", spaces or
 * another domain is refused: a prober learns nothing from the difference.
 */
export function aliasFromRecipient(
  recipient: string,
  domain: string,
): string | null {
  const trimmed = recipient.trim();
  const bracketed = /<([^<>]*)>\s*$/.exec(trimmed);
  const address = (bracketed ? bracketed[1]! : trimmed).trim().toLowerCase();

  const parts = address.split("@");
  if (parts.length !== 2) return null;
  const [local, host] = parts as [string, string];
  if (host !== domain.toLowerCase()) return null;
  if (local.length === 0 || local.length > 40 || !ALIAS.test(local))
    return null;
  return local;
}
