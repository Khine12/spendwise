"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ExpenseRow } from "@/lib/executor";
import { api, money } from "./api";
import { BudgetBars, ExpenseTable } from "./ResultCard";

const Chart = dynamic(() => import("./Chart"), { ssr: false });

type Overview = { month: string; expenses: ExpenseRow[]; byCategory: { label: string; value: number }[]; budgets: { category: string; monthly_limit: number }[] };
type Audit = { id: number; request_id: string | null; event: string; action_type: string | null; status: string; message: string | null; detail: unknown; created_at: string };

const STATUS_CLS: Record<string, string> = {
  success: "text-accent", ok: "text-accent", info: "text-muted", error: "text-bad", rejected: "text-bad",
  invalid: "text-warn", pending_confirmation: "text-warn", cancelled: "text-muted",
};

export default function Sidebar({ refreshKey, onDataChanged }: { refreshKey: number; onDataChanged: () => void }) {
  const [tab, setTab] = useState<"ledger" | "month" | "audit">("ledger");
  const [data, setData] = useState<Overview | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, a] = await Promise.all([api<Overview>("/api/expenses"), api<{ entries: Audit[] }>("/api/audit")]);
      setData(o); setAudit(a.entries); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function seed() { await api("/api/seed", {}); onDataChanged(); }
  async function reset() {
    if (!window.confirm("Delete ALL your expenses and budgets in this demo? This cannot be undone.")) return;
    await api("/api/reset", {}); onDataChanged();
  }

  const monthTotal = data?.byCategory.reduce((s, c) => s + c.value, 0) ?? 0;
  const budgetItems = (data?.budgets ?? []).map((b) => {
    const spent = data?.byCategory.find((c) => c.label === b.category)?.value ?? 0;
    return { category: b.category, limit: b.monthly_limit, spent, pct: Math.round((spent / b.monthly_limit) * 100) };
  });

  return (
    <aside className="flex min-h-[28rem] flex-col rounded-2xl border border-line bg-card lg:h-full lg:min-h-0">
      <div className="flex items-center gap-1 border-b border-line p-2">
        {([["ledger", "Ledger"], ["month", "This month"], ["audit", "Audit log"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-ink text-paper" : "text-muted hover:bg-paper"}`}>{label}</button>
        ))}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        {err && <p className="mb-3 rounded-lg bg-bad-soft p-2 text-sm text-bad">{err}</p>}
        {!data ? <p className="text-sm text-muted">Loading…</p> : tab === "ledger" ? (
          data.expenses.length ? (
            <>
              <p className="mb-2 text-xs text-muted">{data.expenses.length} expenses · newest first</p>
              <ExpenseTable rows={data.expenses} max={25} />
            </>
          ) : (
            <div className="py-10 text-center">
              <p className="font-serif text-lg">Your ledger is empty</p>
              <p className="mt-1 text-sm text-muted">Tell the agent about a purchase, or load sample data.</p>
              <button onClick={seed} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90">Load sample data</button>
            </div>
          )
        ) : tab === "month" ? (
          <div className="space-y-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Spent in {data.month}</p>
              <p className="num font-serif text-3xl">{money(monthTotal)}</p>
            </div>
            {data.byCategory.length > 0 && <Chart type="pie" points={data.byCategory} />}
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted">Budgets</p>
              {budgetItems.length ? <BudgetBars items={budgetItems} /> : <p className="text-sm text-muted">No budgets yet. Try “set a $200 food budget”.</p>}
            </div>
          </div>
        ) : (
          <ol className="space-y-1">
            {audit.length === 0 && <p className="text-sm text-muted">Nothing logged yet.</p>}
            {audit.map((a) => (
              <li key={a.id} className="rounded-lg border border-line/70 text-xs">
                <button onClick={() => setOpenRow(openRow === a.id ? null : a.id)} className="flex w-full items-start gap-2 p-2 text-left hover:bg-paper">
                  <span className="num shrink-0 text-muted">{new Date(a.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  <span className="shrink-0 font-semibold uppercase tracking-wide">{a.event}</span>
                  {a.action_type && <span className="shrink-0 rounded bg-paper px-1">{a.action_type}</span>}
                  <span className={`shrink-0 ${STATUS_CLS[a.status] ?? ""}`}>{a.status}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{a.message}</span>
                </button>
                {openRow === a.id && (
                  <pre className="scroll-thin max-h-56 overflow-auto border-t border-line bg-paper p-2 text-[11px] whitespace-pre-wrap break-all">
{a.message}{a.detail ? "\n\n" + JSON.stringify(a.detail, null, 2) : ""}{a.request_id ? `\n\nrequest ${a.request_id}` : ""}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
        <span>Data is private to this browser</span>
        <span className="flex gap-3">
          <button onClick={seed} className="hover:text-ink">Load sample</button>
          <button onClick={reset} className="hover:text-bad">Reset</button>
        </span>
      </div>
    </aside>
  );
}
