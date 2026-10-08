import Anthropic from "@anthropic-ai/sdk";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";
import { extractionJsonSchema, type Extraction } from "./schema";
import { ExtractionError, type ExtractionInput, type Extractor } from "./types";
import { parseExtraction } from "./validate";

export const EXTRACTION_MODEL = "claude-haiku-4-5";

export interface ClaudeExtractorConfig {
  apiKey: string;
  /** SDK retries on top of the job's own. Tests pass 0. */
  maxRetries?: number;
}

/**
 * Reads one email with Claude Haiku 4.5. The call has no tools, no thinking and
 * temperature 0; the answer is constrained to a JSON schema and then checked
 * again by zod, because the model's output is still derived from untrusted
 * text. Errors never include the email or the model's raw output.
 */
export class ClaudeExtractor implements Extractor {
  readonly name = "claude";
  private readonly client: Anthropic;

  constructor(config: ClaudeExtractorConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      maxRetries: config.maxRetries ?? 1,
      // Look fetch up on every call instead of letting the SDK keep the one
      // that existed at construction: anything that wraps global fetch later
      // (test mocks, instrumentation) must still see these requests.
      fetch: (input, init) => globalThis.fetch(input, init),
    });
  }

  async extract(input: ExtractionInput): Promise<Extraction> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(input) }],
        output_config: {
          format: { type: "json_schema", schema: extractionJsonSchema },
        },
      });
    } catch (error) {
      throw toExtractionError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new ExtractionError("The model declined to read this email", {
        retryable: false,
      });
    }
    if (response.stop_reason === "max_tokens") {
      throw new ExtractionError("The model's answer was cut off", {
        retryable: false,
      });
    }

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") {
      throw new ExtractionError("The model returned no text", {
        retryable: false,
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(text.text);
    } catch {
      throw new ExtractionError("The model's answer was not valid JSON", {
        retryable: false,
      });
    }
    return parseExtraction(json);
  }
}

/** Outages and rate limits are worth retrying; a bad key or request is not. */
function toExtractionError(error: unknown): ExtractionError {
  if (error instanceof Anthropic.RateLimitError) {
    return new ExtractionError("Anthropic rate limit", { retryable: true });
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new ExtractionError("Anthropic server error", { retryable: true });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ExtractionError("Could not reach Anthropic", {
      retryable: true,
    });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ExtractionError("Anthropic rejected the API key", {
      retryable: false,
    });
  }
  if (error instanceof Anthropic.APIError) {
    // Status only: the message can echo parts of the request.
    return new ExtractionError(`Anthropic error ${error.status ?? "unknown"}`, {
      retryable: (error.status ?? 0) >= 500,
    });
  }
  throw error;
}
