/**
 * LLM integration module (OpenAI).
 * - Sends prompts and returns text
 * - JSON mode for structured output
 * - Retries with exponential backoff + jitter on rate limits (429) and server errors (5xx),
 *   honouring the Retry-After header when present
 * - Timeouts, and clear user-facing messages for auth/quota/config errors
 */
import OpenAI, { APIError } from "openai";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type LLMClient = (messages: ChatMessage[], opts?: { json?: boolean; maxTokens?: number }) => Promise<string>;

export class LLMError extends Error {
  constructor(message: string, public userMessage: string, public retryable = false) {
    super(message);
  }
}

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 800;
const TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let client: OpenAI | null = null;
function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LLMError("OPENAI_API_KEY missing", "The server has no OpenAI API key configured (set OPENAI_API_KEY).");
  }
  // We disable the SDK's built-in retries so our own backoff policy is explicit and logged.
  client ??= new OpenAI({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS });
  return client;
}

function classify(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (err instanceof APIError) {
    const code = (err as APIError & { code?: string }).code;
    if (err.status === 401) return new LLMError(err.message, "The OpenAI API key is invalid.");
    if (err.status === 429 && code === "insufficient_quota")
      return new LLMError(err.message, "The OpenAI account is out of credits.");
    if (err.status === 429) return new LLMError(err.message, "The AI service is rate limiting us. Please try again in a moment.", true);
    if (err.status === 404) return new LLMError(err.message, `Model "${model()}" was not found. Check OPENAI_MODEL.`);
    if (err.status && err.status >= 500) return new LLMError(err.message, "The AI service had a temporary error.", true);
    return new LLMError(err.message, `The AI service rejected the request (${err.status}).`);
  }
  const msg = err instanceof Error ? err.message : String(err);
  const isTimeout = /timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg);
  return new LLMError(msg, isTimeout ? "The AI service took too long to respond." : "Could not reach the AI service.", isTimeout);
}

function retryAfterMs(err: unknown): number | null {
  const header = err instanceof APIError ? err.headers?.get?.("retry-after") : null;
  const secs = header ? Number(header) : NaN;
  return Number.isFinite(secs) ? Math.min(secs * 1000, 10_000) : null;
}

export const model = () => process.env.OPENAI_MODEL || "gpt-4o-mini";

export const openaiLLM: LLMClient = async (messages, opts = {}) => {
  const openai = getClient();
  let lastErr: LLMError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await openai.chat.completions.create({
        model: model(),
        messages,
        max_completion_tokens: opts.maxTokens ?? 1200,
        ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
      });
      const text = res.choices[0]?.message?.content;
      if (!text) throw new LLMError("empty completion", "The AI returned an empty response.", true);
      return text;
    } catch (err) {
      lastErr = classify(err);
      if (!lastErr.retryable || attempt === MAX_ATTEMPTS) break;
      const delay = retryAfterMs(err) ?? BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 300;
      console.warn(`[llm] attempt ${attempt} failed (${lastErr.message}); retrying in ${Math.round(delay)}ms`);
      await sleep(delay);
    }
  }
  throw lastErr!;
};

/** Extract a JSON object from model text (handles stray ```json fences). */
export function parseJSON(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("response was not valid JSON");
  }
}
