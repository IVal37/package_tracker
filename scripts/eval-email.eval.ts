// Live check: runs example emails through the REAL Claude model and prints how
// many it read correctly. It calls the Anthropic API, so it costs a few cents
// and is never part of `npm test`. Run it with `npm run eval:email`.
//
// Cases:
//  - tests/fixtures/email/retailers.json (synthetic, with expected answers)
//  - tests/fixtures/email/real/*.txt (your own examples; gitignored). A file is
//    "From: ..." and "Subject: ..." lines, a blank line, then the body. Put the
//    answer you expect in a file next to it with the same name and
//    ".expect.json" (same shape as the "model" entries in retailers.json) to
//    have it scored; without one it is only printed.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  createExtractor,
  groundTrackingNumbers,
  parseExtraction,
  type Extraction,
} from "@/lib/email/extract";
import { MODEL_TEXT_CHARS } from "@/lib/email/process";
import {
  parseTextEmail,
  scoreExtraction,
  type EvalExpectation,
  type TextEmail,
} from "@/lib/email/eval-score";
import { htmlToText } from "@/lib/email/html-to-text";

const FIXTURES = join(process.cwd(), "tests", "fixtures", "email");

interface Case {
  name: string;
  email: TextEmail;
  expected: EvalExpectation | null;
}

function loadSyntheticCases(): Case[] {
  const entries = JSON.parse(
    readFileSync(join(FIXTURES, "retailers.json"), "utf8"),
  ) as {
    name: string;
    email: { from: string; subject: string; text?: string; html?: string };
    model: unknown;
  }[];
  return entries.map((entry) => ({
    name: entry.name,
    email: {
      from: entry.email.from,
      subject: entry.email.subject,
      text: entry.email.text ?? "",
      html: entry.email.html ?? "",
    },
    expected: parseExtraction(entry.model),
  }));
}

function loadRealCases(): Case[] {
  const dir = join(FIXTURES, "real");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".txt"))
    .sort()
    .map((file) => {
      const sidecar = join(dir, file.replace(/\.txt$/, ".expect.json"));
      return {
        name: `real/${file}`,
        email: parseTextEmail(readFileSync(join(dir, file), "utf8")),
        expected: existsSync(sidecar)
          ? parseExtraction(JSON.parse(readFileSync(sidecar, "utf8")))
          : null,
      };
    });
}

/** The same text the app gives the model (see processInboundEmail). */
function readableText(email: TextEmail): string {
  const fromHtml = email.html.trim() ? htmlToText(email.html) : "";
  const body =
    fromHtml.length >= 20 || !email.text.trim() ? fromHtml : email.text;
  return body || email.text;
}

describe("email extraction against the real model", () => {
  it(
    "scores the example emails",
    async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY is not set. Add it to .env (never commit it) and run `npm run eval:email` again.",
        );
      }
      const extractor = createExtractor({
        EMAIL_EXTRACTOR: "claude",
        ANTHROPIC_API_KEY: apiKey,
      });

      const cases = [...loadSyntheticCases(), ...loadRealCases()];
      const log = (line: string) => process.stdout.write(`${line}\n`);
      let scored = 0;
      let correct = 0;
      log(`\nRunning ${cases.length} emails through ${extractor.name}...\n`);

      for (const { name, email, expected } of cases) {
        const readable = readableText(email);
        let extraction: Extraction;
        try {
          extraction = await extractor.extract({
            from: email.from,
            subject: email.subject,
            text: readable.slice(0, MODEL_TEXT_CHARS),
          });
        } catch (error) {
          if (expected) scored += 1;
          log(
            `ERROR ${name}: ${error instanceof Error ? error.message : "unknown"}`,
          );
          continue;
        }

        const source = `${email.subject}\n${email.text}\n${email.html}\n${readable}`;
        const trackingNumbers = groundTrackingNumbers(
          extraction.tracking_numbers,
          source,
        ).accepted.map((entry) => entry.trackingNumber);

        if (!expected) {
          log(
            `INFO  ${name}: ${extraction.email_type}, retailer ${extraction.retailer ?? "none"}, item ${extraction.item ?? "none"}, order ${extraction.order_number ?? "none"}, tracking ${trackingNumbers.join(", ") || "none"}`,
          );
          continue;
        }

        scored += 1;
        const differences = scoreExtraction(expected, {
          email_type: extraction.email_type,
          retailer: extraction.retailer,
          order_number: extraction.order_number,
          trackingNumbers,
        });
        if (differences.length === 0) {
          correct += 1;
          log(`PASS  ${name}`);
        } else {
          log(`FAIL  ${name}`);
          for (const difference of differences) log(`        ${difference}`);
        }
      }

      log(`\nCorrect: ${correct} of ${scored} scored emails.\n`);
    },
    15 * 60_000,
  );
});
