// The only entry point the rest of the app uses to read an email. The
// extractors live in ./claude and ./fake and must not be imported from outside
// src/lib/email (enforced by ESLint no-restricted-imports).
import { getEnv, type Env } from "@/lib/env";
import { ClaudeExtractor } from "./claude";
import { FakeExtractor } from "./fake";
import type { Extractor } from "./types";

export { EMAIL_TYPES, type EmailType, type Extraction } from "./schema";
export { ExtractionError, type ExtractionInput, type Extractor } from "./types";
export {
  cleanDisplayText,
  groundTrackingNumbers,
  parseExtraction,
  type GroundedTrackingNumber,
} from "./validate";

type ExtractorEnv = Pick<Env, "EMAIL_EXTRACTOR" | "ANTHROPIC_API_KEY">;

/** Pure: builds the extractor an env asks for. */
export function createExtractor(env: ExtractorEnv): Extractor {
  if (env.EMAIL_EXTRACTOR === "claude") {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error("Invalid environment: missing ANTHROPIC_API_KEY");
    }
    return new ClaudeExtractor({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return new FakeExtractor();
}

let cached: Extractor | undefined;

/** Lazy per-process singleton chosen by EMAIL_EXTRACTOR. */
export function getExtractor(): Extractor {
  cached ??= createExtractor(getEnv());
  return cached;
}

/** Test helper: drop the cached extractor. */
export function resetExtractorCache(): void {
  cached = undefined;
}
