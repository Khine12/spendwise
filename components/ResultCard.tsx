"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { ActionResult } from "./types";
import type { ExpenseRow } from "@/lib/executor";
import { api, money } from "./api";

const Chart = dynamic(() => import("./Chart"), { ssr: false, loading: () => <div className="h-60 animate-pulse rounded-2xl bg-paper" /> });

const LABELS: Record<string, string> = {
  add_expense: "Add expense", list_expenses: "Search expenses", summarize_spending: "Summarize",
  update_expense: "Update expense", delete_expenses: "Delete expenses", set_budget: "Set budget",
  check_budget: "Check budget", convert_currency: "Convert currency", export_csv: "Export CSV", show_chart: "Chart",
};

const STATUS = {
  success: { icon: "✓", cls: "bg-sage-soft text-sage", label: "Done" },
  error: { icon: "!", cls: "bg-bad-soft text-bad", label: "Failed" },
  rejected: { icon: "⨯", cls: "bg-bad-soft text-bad", label: "Blocked" },
  pending_confirmation: { icon: "?", cls: "bg-warn-soft text-warn", label: "Needs your OK" },
  cancelled: { icon: "–", cls: "bg-line text-muted", label: "Cancelled" },
} as const;

export default function ResultCard({ initial, onChange }: { initial: ActionResult; onChange: () => void }) {
  const [r, setR] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const s = STATUS[r.status];

  async function decide(decision: "confirm" | "cancel") {
    setBusy(true);
    try {
      const out = await api<ActionResult>("/api/confirm", { pendingId: r.pendingId, decision });
      setR({ ...out, index: r.index });
      onChange();
    } catch (e) {
      setR({ ...r, status: "error", message: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className={`rise rounded-2xl border bg-card p-3.5 shadow-[0_10px_24px_-20px_rgba(120,70,80,.5)] ${r.status === "pending_confirmation" ? "border-gold/60 shadow-[0_0_0_4px_var(--color-gold-soft)]" : "border-line"}`}>
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.cls}`}>{s.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-xs">
            <span className="eyebrow text-[10px] text-gold">{LABELS[r.type] ?? r.type}</span>
            <span className={`rounded-full px-2 py-px text-[11px] ${s.cls}`}>{s.label}</span>
            {r.params !== undefined && (
              <button onClick={() => setShowJson((v) => !v)} className="ml-auto text-[11px] text-muted underline-offset-2 hover:text-accent hover:underline">
                {showJson ? "hide" : "view"} action JSON
              </button>
            )}
          </div>
          <p className="mt-1 text-sm leading-snug">{r.message}</p>
          {showJson && <pre className="scroll-thin mt-2 max-h-48 overflow-auto rounded-xl bg-[#3d2f31] p-3 text-[11px] leading-relaxed text-[#f9ece6]">{JSON.stringify(r.params, null, 2)}</pre>}
        </div>
      </div>

      {r.status === "pending_confirmation" && (
        <div className="mt-3 pl-7">
          {r.preview && <ExpenseTable rows={r.preview} max={6} />}
          <div className="mt-3 flex gap-2">
            <button disabled={busy} onClick={() => decide("confirm")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium text-white transition disabled:opacity-50 ${r.type === "delete_expenses" ? "bg-bad hover:bg-bad/90" : "bg-accent hover:bg-accent/90"}`}>
              {busy ? "Working…" : r.type === "delete_expenses" ? `Yes, delete ${r.preview?.length ?? ""}` : "Confirm"}
            </button>
            <button disabled={busy} onClick={() => decide("cancel")} className="rounded-full border border-line bg-card px-4 py-1.5 text-sm transition hover:border-accent/40 hover:text-accent disabled:opacity-50">Cancel</button>
          </div>
        </div>
      )}

      {r.data && r.status === "success" && <div className="mt-3 pl-7"><DataView data={r.data} /></div>}
    </div>
  );
}

function DataView({ data }: { data: NonNullable<ActionResult["data"]> }) {
  switch (data.kind) {
    case "table":
      return data.rows.length ? <ExpenseTable rows={data.rows} max={8} /> : <p className="text-sm text-muted">No matching expenses.</p>;
    case "summary": {
      const max = Math.max(...data.rows.map((x) => x.total), 1);
      return (
        <ul className="space-y-1.5">
          {data.rows.map((row) => (
            <li key={row.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-sm">
              <span className="truncate">{row.label}</span>
              <span className="h-2 rounded-full bg-paper"><span className="block h-2 rounded-full bg-gradient-to-r from-accent/70 to-accent" style={{ width: `${(row.total / max) * 100}%` }} /></span>
              <span className="num text-xs">{money(row.total)} <span className="text-muted">({row.count})</span></span>
            </li>
          ))}
        </ul>
      );
    }
    case "chart":
      return <Chart type={data.chart} points={data.points} />;
    case "budget":
      return <BudgetBars items={data.items} />;
    case "conversion":
      return <p className="num text-lg">{data.amount} {data.from} → <strong className="font-serif text-2xl font-semibold text-accent">{data.result} {data.to}</strong> <span className="text-xs text-muted">rate {data.rate} · {data.date}</span></p>;
    case "file":
      return (
        <button onClick={() => download(data.filename, data.content, data.mime)}
          className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent-soft px-4 py-1.5 text-sm font-medium text-accent transition hover:-translate-y-0.5 hover:bg-accent-soft/70">
          ↓ Download {data.filename} <span className="text-xs font-normal">({data.rows} rows)</span>
        </button>
      );
    default:
      return null;
  }
}

export function BudgetBars({ items }: { items: { category: string; limit: number; spent: number; pct: number }[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((b) => {
        const color = b.pct >= 100 ? "bg-bad" : b.pct >= 80 ? "bg-warn" : "bg-sage";
        return (
          <li key={b.category} className="text-sm">
            <div className="flex justify-between"><span>{b.category}</span><span className="num text-xs">{money(b.spent)} / {money(b.limit)}</span></div>
            <div className="mt-1 h-2 rounded-full bg-paper"><div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(b.pct, 100)}%` }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

export function ExpenseTable({ rows, max = 999 }: { rows: ExpenseRow[]; max?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, max);
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-gold/30 text-left text-[10px] uppercase tracking-[.18em] text-gold">
          <th className="py-1 pr-2 font-medium">#</th><th className="py-1 pr-2 font-medium">Date</th><th className="py-1 pr-2 font-medium">Merchant</th>
          <th className="py-1 pr-2 font-medium">Category</th><th className="py-1 text-right font-medium">Amount</th>
        </tr></thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.id} className="border-b border-line/60 last:border-0">
              <td className="num py-1 pr-2 text-xs text-muted">{e.id}</td>
              <td className="num whitespace-nowrap py-1 pr-2 text-xs">{e.spent_on.slice(5)}</td>
              <td className="max-w-[9rem] truncate py-1 pr-2" title={e.note ?? ""}>{e.merchant ?? e.note ?? "—"}</td>
              <td className="py-1 pr-2 text-xs text-muted">{e.category}</td>
              <td className="num whitespace-nowrap py-1 text-right">{e.currency !== "USD" && <span className="mr-1 text-[11px] text-muted">{e.amount} {e.currency}</span>}{money(e.amount_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <button onClick={() => setAll((v) => !v)} className="mt-1 text-xs text-accent hover:underline">{all ? "Show less" : `Show all ${rows.length}`}</button>}
    </div>
  );
}

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
