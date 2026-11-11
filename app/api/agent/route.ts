import { getDB } from "@/lib/db";
import { runAgent } from "@/lib/agent";
import { openaiLLM, LLMError, type ChatMessage } from "@/lib/llm";
import { logAudit } from "@/lib/audit";
import { badRequest, getUserId, json, rateLimited } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const userId = getUserId(req);
  if (!userId) return badRequest("Missing or invalid user id.");
  if (rateLimited(userId)) return json({ error: "Too many requests. Please wait a minute." }, 429);

  let body: { message?: unknown; history?: unknown };
  try { body = await req.json(); } catch { return badRequest("Body must be JSON."); }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return badRequest("Message is empty.");
  if (message.length > 1000) return badRequest("Message is too long (max 1000 characters).");
  const history = Array.isArray(body.history)
    ? (body.history as ChatMessage[]).filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    : [];

  const db = await getDB();
  try {
    const result = await runAgent({ db, userId, message, history, llm: openaiLLM });
    return json(result);
  } catch (err) {
    const userMessage = err instanceof LLMError ? err.userMessage : "Something went wrong on the server.";
    console.error("[api/agent]", err);
    await logAudit(db, { userId, event: "error", status: "error", message: userMessage });
    return json({ error: userMessage }, err instanceof LLMError && err.retryable ? 503 : 500);
  }
}
