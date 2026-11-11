/**
 * End-to-end tests for the agent pipeline with a scripted (fake) LLM and a mocked
 * exchange-rate API. Uses a throwaway in-memory Postgres (PGlite).
 * Run: npm test
 */
process.env.PGLITE_DIR = "memory";
process.env.APP_TIMEZONE = "America/Los_Angeles";

import assert from "node:assert/strict";
import { getDB } from "../lib/db";
import { runAgent, resolvePending, type AgentResponse } from "../lib/agent";
import type { LLMClient, ChatMessage } from "../lib/llm";
import type { Deps } from "../lib/executor";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-10T20:00:00Z"); // Tue Nov 10 2026, LA

const fakeDeps: Deps = {
  fetch: (async (url: string) => {
    const u = new URL(url);
    const rates: Record<string, number> = { EUR: 1.08, GBP: 1.27, JPY: 0.0066 };
    const from = u.searchParams.get("from")!, to = u.searchParams.get("to")!;
    if (from === "XXX") return new Response("{}", { status: 404 });
    const rate = to === "USD" ? rates[from] : from === "USD" ? 1 / rates[to] : rates[from] / rates[to];
    return Response.json({ date: "2026-11-10", rates: { [to]: rate } });
  }) as unknown as typeof fetch,
};

/** A fake LLM that returns queued responses; summariser calls get a fixed line. */
function scripted(...plans: unknown[]): LLMClient & { calls: ChatMessage[][] } {
  const queue = [...plans];
  const fn = (async (messages: ChatMessage[], opts?: { json?: boolean }) => {
    fn.calls.push(messages);
    if (!opts?.json) return "summary ok";
    const next = queue.shift();
    if (next === undefined) throw new Error("fake LLM ran out of responses");
    return typeof next === "string" ? next : JSON.stringify(next);
  }) as LLMClient & { calls: ChatMessage[][] };
  fn.calls = [];
  return fn;
}
const plan = (actions: unknown[], extra: object = {}) => ({ reasoning: "test", needs_clarification: false, clarification_question: null, actions, reply: "ok", ...extra });

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n`, e); process.exitCode = 1; }
}

async function main() {
  const db = await getDB();
  const run = (llm: LLMClient, message = "test", userId = USER): Promise<AgentResponse> =>
    runAgent({ db, userId, message, llm, deps: fakeDeps, now: NOW });

  console.log("Agent pipeline");

  await test("adds an expense", async () => {
    const r = await run(scripted(plan([{ type: "add_expense", amount: 12.5, currency: "USD", category: "Food", merchant: "Chipotle", note: "lunch", date: "2026-11-10" }])));
    assert.equal(r.results[0].status, "success");
    assert.equal(r.reply, "summary ok");
  });

  await test("multi-action request incl. foreign currency (API call)", async () => {
    const r = await run(scripted(plan([
      { type: "add_expense", amount: 20, currency: "eur", category: "Travel", merchant: "Paris Metro", note: null, date: "2026-11-09" },
      { type: "add_expense", amount: 40, category: "Transport", merchant: null, note: "gas", date: "2026-11-09" },
      { type: "add_expense", amount: 15.99, category: "Subscriptions", merchant: "Netflix", date: "2026-11-02" },
    ])));
    assert.deepEqual(r.results.map((x) => x.status), ["success", "success", "success"]);
    const e = r.results[0].data;
    assert.ok(e?.kind === "expense" && e.expense.currency === "EUR" && e.expense.amount_usd === 21.6);
  });

  await test("injects recent expenses with ids into the system prompt", async () => {
    const llm = scripted(plan([{ type: "list_expenses", filters: {}, limit: 5 }]));
    await run(llm);
    const sys = llm.calls[0][0].content;
    assert.match(sys, /Chipotle/);
    assert.match(sys, /Today is Tuesday, 2026-11-10/);
  });

  await test("summarize by category with date filter", async () => {
    const r = await run(scripted(plan([{ type: "summarize_spending", group_by: "category", filters: { from: "2026-11-01", to: "2026-11-30" } }])));
    const d = r.results[0].data;
    assert.ok(d?.kind === "summary");
    assert.equal(d.total_usd, 90.09); // 12.5 + 21.6 + 40 + 15.99
  });

  await test("self-repair: invalid output is sent back and fixed", async () => {
    const llm = scripted(
      plan([{ type: "add_expense", amount: -5, category: "Snacks", date: "yesterday" }]),
      plan([{ type: "add_expense", amount: 5, category: "Food", date: "2026-11-09" }]),
    );
    const r = await run(llm);
    assert.equal(r.attempts, 2);
    assert.equal(r.results[0].status, "success");
    const repairMsg = llm.calls[1].at(-1)!.content;
    assert.match(repairMsg, /amount must be positive/);
    assert.match(repairMsg, /date must be YYYY-MM-DD/);
  });

  await test("non-JSON output is repaired", async () => {
    const r = await run(scripted("Sure! I'll add that for you.", plan([{ type: "list_expenses", filters: {}, limit: 1 }])));
    assert.equal(r.attempts, 2);
    assert.equal(r.results[0].status, "success");
  });

  await test("unknown/unsafe action is rejected after repairs, never executed", async () => {
    const bad = plan([{ type: "run_shell", command: "rm -rf /" }]);
    const r = await run(scripted(bad, bad, bad));
    assert.equal(r.results[0].status, "rejected");
    assert.match(r.results[0].message, /unknown action type/);
  });

  await test("clarification returns a question and no actions", async () => {
    const r = await run(scripted({ reasoning: "no amount", needs_clarification: true, clarification_question: "How much was it?", actions: [], reply: "" }));
    assert.equal(r.clarification, "How much was it?");
    assert.equal(r.results.length, 0);
  });

  await test("delete by filter requires confirmation and previews rows", async () => {
    const r = await run(scripted(plan([{ type: "delete_expenses", filters: { search: "netflix" } }])));
    const p = r.results[0];
    assert.equal(p.status, "pending_confirmation");
    assert.equal(p.preview?.length, 1);
    const before = await db.query(`SELECT count(*)::int AS n FROM expenses WHERE user_id=$1`, [USER]);
    assert.equal((before[0] as { n: number }).n, 5, "nothing deleted before confirmation");

    const cancelled = await resolvePending({ db, userId: USER, pendingId: p.pendingId!, decision: "cancel", deps: fakeDeps });
    assert.equal(cancelled.status, "cancelled");
    const again = await resolvePending({ db, userId: USER, pendingId: p.pendingId!, decision: "confirm", deps: fakeDeps });
    assert.equal(again.status, "error", "a handled request cannot be re-used");
  });

  await test("confirming a delete deletes exactly the previewed rows", async () => {
    const r = await run(scripted(plan([{ type: "delete_expenses", filters: { search: "netflix" } }])));
    const done = await resolvePending({ db, userId: USER, pendingId: r.results[0].pendingId!, decision: "confirm", deps: fakeDeps });
    assert.equal(done.status, "success");
    assert.ok(done.data?.kind === "deleted" && done.data.count === 1);
  });

  await test("delete with no filters is refused by validation", async () => {
    const bad = plan([{ type: "delete_expenses", filters: {} }]);
    const r = await run(scripted(bad, bad, bad));
    assert.equal(r.results[0].status, "rejected");
  });

  await test("large amount asks for confirmation", async () => {
    const r = await run(scripted(plan([{ type: "add_expense", amount: 2400, category: "Housing", merchant: "Landlord", date: "2026-11-01" }])));
    assert.equal(r.results[0].status, "pending_confirmation");
  });

  await test("users cannot see or change each other's data", async () => {
    const r = await run(scripted(plan([{ type: "list_expenses", filters: {}, limit: 50 }])), "list", OTHER);
    assert.ok(r.results[0].data?.kind === "table" && r.results[0].data.rows.length === 0);
    const u = await run(scripted(plan([{ type: "update_expense", id: 1, changes: { amount: 1 } }])), "x", OTHER);
    assert.equal(u.results[0].status, "error");
  });

  await test("update, budgets, chart, conversion, CSV export", async () => {
    const r = await run(scripted(plan([
      { type: "update_expense", id: 1, changes: { amount: 13.75, note: "lunch + drink" } },
      { type: "set_budget", category: "Food", monthly_limit: 15 },
      { type: "check_budget" },
      { type: "show_chart", group_by: "category", chart: "pie", filters: {} },
      { type: "convert_currency", amount: 100, from: "USD", to: "GBP" },
      { type: "export_csv", filters: {}, filename: "november" },
    ])));
    assert.deepEqual(r.results.map((x) => x.status), Array(6).fill("success"));
    const budget = r.results[2].data;
    assert.ok(budget?.kind === "budget" && budget.items[0].remaining < 0, "Food is over budget (18.75 > 15)");
    const file = r.results[5].data;
    assert.ok(file?.kind === "file" && file.filename === "november.csv" && file.content.startsWith("id,date"));
  });

  await test("CSV export neutralises formula injection", async () => {
    await run(scripted(plan([{ type: "add_expense", amount: 1, category: "Other", note: "=HYPERLINK(\"evil\")", date: "2026-11-10" }])));
    const r = await run(scripted(plan([{ type: "export_csv", filters: { category: "Other" } }])));
    const f = r.results[0].data;
    assert.ok(f?.kind === "file" && f.content.includes(`"'=HYPERLINK`));
  });

  await test("external API failure is reported, not crashed", async () => {
    const r = await run(scripted(plan([{ type: "convert_currency", amount: 5, from: "XXX", to: "USD" }])));
    assert.equal(r.results[0].status, "error");
    assert.match(r.results[0].message, /Unsupported currency/);
  });

  await test("SQL-ish search text is treated as data", async () => {
    const r = await run(scripted(plan([{ type: "list_expenses", filters: { search: "'; DROP TABLE expenses; --" }, limit: 5 }])));
    assert.equal(r.results[0].status, "success");
    const n = await db.query(`SELECT count(*)::int AS n FROM expenses`);
    assert.ok((n[0] as { n: number }).n > 0);
  });

  await test("every step is in the audit log", async () => {
    const rows = await db.query<{ event: string; status: string }>(`SELECT event, status FROM audit_log WHERE user_id=$1`, [USER]);
    const has = (ev: string, st: string) => rows.some((x) => x.event === ev && x.status === st);
    for (const [ev, st] of [["request", "info"], ["plan", "invalid"], ["action", "success"], ["action", "rejected"],
      ["action", "pending_confirmation"], ["confirm", "cancelled"], ["confirm", "success"], ["clarify", "info"]]) {
      assert.ok(has(ev, st), `missing audit ${ev}/${st}`);
    }
  });

  console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
}

main();
