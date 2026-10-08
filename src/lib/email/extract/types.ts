import type { Extraction } from "./schema";

export interface ExtractionInput {
  /** The From header as received. */
  from: string;
  subject: string;
  /** Plain text of the email body (HTML already converted and truncated). */
  text: string;
}

export interface Extractor {
  readonly name: "claude" | "fake";
  /** Reads one email. Throws ExtractionError when it cannot produce a valid answer. */
  extract(input: ExtractionInput): Promise<Extraction>;
}

/**
 * The extractor could not produce a usable answer. `retryable` means trying
 * again may help (outage, rate limit); otherwise the email is marked failed.
 */
export class ExtractionError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean }) {
    super(message);
    this.name = "ExtractionError";
    this.retryable = options.retryable;
  }
}
