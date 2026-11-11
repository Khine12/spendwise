/**
 * Agent orchestrator: Plan → Validate (self-repair) → Safety gate → Execute → Report.
 *
 *   user request ──► LLM planner (JSON) ──► schema validation ──┐
 *                          ▲                                    │ invalid → repair prompt (max 2)
 *                          └────────────────────────────────────┘
 *   valid actions ──► needs confirmation? ── yes ─► pending (user clicks Confirm/Cancel)
 *                                        └─ no ──► executor ──► results ──► LLM summariser ──► reply
 * Every step is written to the audit log.
 */
import { randomUUID } from "crypto";
import type { DB } from "./db";
import { AgentPlan, needsConfirmation, validateAction, type Action } from "./actions";
import { executeAction, findExpenses, ActionFailure, defaultDeps, type Deps, type ExpenseRow, type ResultData } from "./executor";
import { buildRepairPrompt, buildSystemPrompt, SUMMARY_SYSTEM_PROMPT } from "./prompts";
import { parseJSON, LLMError, type ChatMessage, type LLMClient } from "./llm";
import { logAudit } from "./audit";

export type ActionStatus = "success" | "error" | "rejected" | "pending_confirmation" | "cancelled";

export interface ActionResult {
  index: number;
  type: string;
  status: ActionStatus;
  message: string;
  params?: unknown;
  data?: ResultData;
  pendingId?: string;
  preview?: ExpenseRow[];
}

export interface AgentResponse {
  requestId: string;
  reasoning: string;
  clarification: string | null;
  results: ActionResult[];
  reply: string;
  attempts: number;
}

const MAX_REPAIRS = 2;
const PENDING_TTL_MIN = 15;

export function todayInfo(timezone = process.env.APP_TIMEZONE || "America/Los_Angeles", now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(now);
  return { today, weekday, timezone };
}

export async function runAgent(opts: {
  db: DB; userId: string; message: string; history?: ChatMessage[]; llm: LLMClient; deps?: Deps; now?: Date;
}): Promise<AgentResponse> {
  const { db, userId, message, llm } = opts;
  const deps = opts.deps ?? defaultDeps;
  const requestId = randomUUID();
  const { today, weekday, timezone } = todayInfo(undefined, opts.now);
  await logAudit(db, { userId, requestId, event: "request", status: "info", message });

  // 1. Context injection
  const recentExpenses = await findExpenses(db, userId, {}, 15);
  const budgets = await db.query<{ category: string; monthly_limit: number }>(
    `SELECT category, monthly_limit::float8 AS monthly_limit FROM budgets WHERE user_id=$1 ORDER BY category`, [userId]);
  const system = buildSystemPrompt({ today, weekday, timezone, recentExpenses, budgets });

  const history = (opts.history ?? []).slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 1500) }) as ChatMessage);
  const messages: ChatMessage[] = [{ role: "system", content: system }, ...history, { role: "user", content: message }];

  // 2. Plan with validation + self-repair loop
  let plan: AgentPlan | null = null;
  let valid: Action[] = [];
  let invalid: { index: number; type: string; error: string; raw: unknown }[] = [];
  let attempts = 0;

  for (attempts = 1; attempts <= MAX_REPAIRS + 1; attempts++) {
    const raw = await llm(messages, { json: true });
    const errors: string[] = [];
    try {
      const parsed = AgentPlan.safeParse(parseJSON(raw));
      if (!parsed.success) {
        errors.push(...parsed.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`));
      } else {
        plan = parsed.data;
        valid = []; invalid = [];
        plan.actions.forEach((a, index) => {
          const v = validateAction(a);
          if (v.ok) valid.push(v.action);
          else invalid.push({ index, type: v.type, error: v.error, raw: a });
        });
        errors.push(...invalid.map((i) => `actions[${i.index}] (${i.type}): ${i.error}`));
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "invalid JSON");
    }

    await logAudit(db, { userId, requestId, event: "plan", status: errors.length ? "invalid" : "ok",
      message: errors.length ? errors.join("; ") : `${plan?.actions.length ?? 0} action(s) planned`, detail: { attempt: attempts, output: safeTruncate(raw) } });

    if (!errors.length) break;
    if (attempts <= MAX_REPAIRS) {
      messages.push({ role: "assistant", content: raw }, { role: "user", content: buildRepairPrompt(errors) });
    } else if (!plan) {
      throw new LLMError("unrepairable output", "The AI could not produce a valid plan for that request. Try rephrasing it.");
    }
  }
  plan = plan!;

  if (plan.needs_clarification) {
    const q = plan.clarification_question || "Could you give me a bit more detail?";
    await logAudit(db, { userId, requestId, event: "clarify", status: "info", message: q });
    return { requestId, reasoning: plan.reasoning, clarification: q, results: [], reply: q, attempts };
  }

  // 3. Rejected actions (still invalid after repairs)
  const results: ActionResult[] = invalid.map((i) => ({ index: i.index, type: i.type, status: "rejected", message: `Rejected: ${i.error}`, params: i.raw }));
  for (const r of results) await logAudit(db, { userId, requestId, event: "action", actionType: r.type, status: "rejected", message: r.message, detail: r.params });

  // 4. Safety gate + execution, in the order the LLM planned them
  let i = 0;
  for (const action of valid) {
    const index = i++;
    const reason = needsConfirmation(action);
    try {
      if (reason) {
        results.push(await createPending(db, userId, requestId, action, reason, index));
      } else {
        const out = await executeAction(db, userId, action, { today }, deps);
        results.push({ index, type: action.type, status: "success", params: action, ...out });
        await logAudit(db, { userId, requestId, event: "action", actionType: action.type, status: "success", message: out.message, detail: action });
      }
    } catch (err) {
      const msg = err instanceof ActionFailure ? err.message : "Unexpected error while running this action.";
      if (!(err instanceof ActionFailure)) console.error("[agent] action crashed", err);
      results.push({ index, type: action.type, status: "error", message: msg, params: action });
      await logAudit(db, { userId, requestId, event: "action", actionType: action.type, status: "error", message: msg, detail: action });
    }
  }

  // 5. Report: a second prompt turns raw results into a short answer (falls back to a template)
  const reply = results.length ? await summarise(llm, message, results).catch(() => templateReply(plan!.reply, results)) : plan.reply || "I couldn't find anything to do for that request.";
  return { requestId, reasoning: plan.reasoning, clarification: null, results, reply, attempts };
}

async function createPending(db: DB, userId: string, requestId: string, action: Action, reason: string, index: number): Promise<ActionResult> {
  let stored: Action = action;
  let preview: ExpenseRow[] | undefined;
  let summary = reason;

  if (action.type === "delete_expenses") {
    // Resolve filters to concrete ids NOW, so the user confirms exactly the rows they see.
    const rows = action.ids
      ? (await findExpenses(db, userId, {}, 500)).filter((r) => action.ids!.includes(r.id))
      : await findExpenses(db, userId, action.filters ?? {}, 50);
    if (!rows.length) throw new ActionFailure("No matching expenses found, so nothing was deleted.");
    stored = { type: "delete_expenses", ids: rows.map((r) => r.id) };
    preview = rows;
    summary = `Delete ${rows.length} expense${rows.length === 1 ? "" : "s"} totalling $${rows.reduce((s, r) => s + r.amount_usd, 0).toFixed(2)}? ${reason}`;
  }

  const pendingId = randomUUID();
  await db.query(`INSERT INTO pending_actions (id, user_id, request_id, action, summary) VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [pendingId, userId, requestId, JSON.stringify(stored), summary]);
  await logAudit(db, { userId, requestId, event: "action", actionType: action.type, status: "pending_confirmation", message: summary, detail: stored });
  return { index, type: action.type, status: "pending_confirmation", message: summary, params: stored, pendingId, preview };
}

/** Called when the user clicks Confirm or Cancel on a pending action. */
export async function resolvePending(opts: { db: DB; userId: string; pendingId: string; decision: "confirm" | "cancel"; deps?: Deps; now?: Date }): Promise<ActionResult> {
  const { db, userId, pendingId, decision } = opts;
  // Atomic status flip prevents double execution (e.g. double click).
  const rows = await db.query<{ request_id: string; action: unknown }>(
    `UPDATE pending_actions SET status=$3 WHERE id=$1 AND user_id=$2 AND status='pending'
       AND created_at > now() - interval '${PENDING_TTL_MIN} minutes'
     RETURNING request_id, action`, [pendingId, userId, decision === "confirm" ? "confirmed" : "cancelled"]);
  if (!rows.length) return { index: 0, type: "unknown", status: "error", message: "This request expired or was already handled." };

  const { request_id: requestId } = rows[0];
  const rawAction = typeof rows[0].action === "string" ? JSON.parse(rows[0].action) : rows[0].action;
  const v = validateAction(rawAction); // re-validate, never trust stored state blindly
  if (!v.ok) return { index: 0, type: v.type, status: "error", message: `Stored action invalid: ${v.error}` };

  if (decision === "cancel") {
    await logAudit(db, { userId, requestId, event: "confirm", actionType: v.action.type, status: "cancelled", message: "User cancelled", detail: v.action });
    return { index: 0, type: v.action.type, status: "cancelled", message: "Cancelled. Nothing was changed.", params: v.action };
  }
  try {
    const out = await executeAction(db, userId, v.action, { today: todayInfo(undefined, opts.now).today }, opts.deps ?? defaultDeps);
    await logAudit(db, { userId, requestId, event: "confirm", actionType: v.action.type, status: "success", message: out.message, detail: v.action });
    return { index: 0, type: v.action.type, status: "success", params: v.action, ...out };
  } catch (err) {
    const msg = err instanceof ActionFailure ? err.message : "Unexpected error while running this action.";
    await logAudit(db, { userId, requestId, event: "confirm", actionType: v.action.type, status: "error", message: msg, detail: v.action });
    return { index: 0, type: v.action.type, status: "error", message: msg, params: v.action };
  }
}

async function summarise(llm: LLMClient, request: string, results: ActionResult[]): Promise<string> {
  const compact = results.map((r) => ({
    action: r.type, status: r.status, message: r.message,
    data: r.data?.kind === "file" ? { filename: r.data.filename, rows: r.data.rows }
      : r.data?.kind === "table" ? { count: r.data.rows.length, total_usd: r.data.total_usd, sample: r.data.rows.slice(0, 5) }
      : r.data,
  }));
  const text = await llm([
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    { role: "user", content: `User request: ${request}\n\nExecution results:\n${JSON.stringify(compact).slice(0, 6000)}` },
  ], { maxTokens: 300 });
  return text.trim();
}

function templateReply(planReply: string, results: ActionResult[]) {
  return [planReply, ...results.map((r) => `• ${r.message}`)].filter(Boolean).join("\n");
}

const safeTruncate = (s: string) => (s.length > 4000 ? s.slice(0, 4000) + "…" : s);
