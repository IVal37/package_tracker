// Turns an HTML email into plain text for the model and the pattern matcher.
// Not a general HTML parser: it removes what could hide or mislead (scripts,
// styles, comments), keeps what carries meaning (text, link targets, line
// breaks) and decodes entities. Untrusted input in, plain text out.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  copy: "(c)",
  reg: "(R)",
  trade: "(TM)",
  zwnj: "",
  zwj: "",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body.startsWith("#")) {
        const code =
          body[1]?.toLowerCase() === "x"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        // Refuse control characters and anything outside Unicode.
        if (!Number.isFinite(code) || code > 0x10ffff || code < 0x20)
          return " ";
        if (code >= 0xd800 && code <= 0xdfff) return " ";
        return String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

const MAX_LINK_LENGTH = 500;

export interface HtmlToTextOptions {
  /** Cut the result to this many characters. Default: no limit. */
  maxChars?: number;
}

export function htmlToText(
  html: string,
  { maxChars }: HtmlToTextOptions = {},
): string {
  let text = html
    // Things that never show: comments, scripts, styles, the head.
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    // Links keep their target, because tracking numbers often live in the href.
    .replace(
      /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi,
      (
        _match,
        dq: string | undefined,
        sq: string | undefined,
        label: string,
      ) => {
        const href = decodeEntities((dq ?? sq ?? "").trim());
        const inner = label.replace(/<[^>]*>/g, " ").trim();
        if (!/^https?:\/\//i.test(href) || href.length > MAX_LINK_LENGTH) {
          return inner;
        }
        return inner && inner !== href ? `${inner} (${href})` : href;
      },
    )
    // Line and cell structure.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|tr|li|ul|ol|table|h[1-6]|section|article|blockquote)\s*>/gi,
      "\n",
    )
    .replace(/<hr\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)\s*>/gi, " ")
    // Whatever tags are left (including broken ones).
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/<\/?[a-z][^>]*$/gi, " ");

  text = decodeEntities(text)
    .replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "") // invisible padding
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return maxChars !== undefined && text.length > maxChars
    ? text.slice(0, maxChars)
    : text;
}
