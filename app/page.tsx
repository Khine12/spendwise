"use client";
import { useEffect, useRef, useState } from "react";
import ResultCard from "@/components/ResultCard";
import Sidebar from "@/components/Sidebar";
import { api } from "@/components/api";
import type { ActionResult, UIMessage } from "@/components/types";

type AgentResponse = { reasoning: string; clarification: string | null; results: ActionResult[]; reply: string; attempts: number };

const SUGGESTIONS = [
  "Spent $14.50 on lunch at Chipotle",
  "Paid 40 for gas yesterday and 15.99 for Spotify",
  "How much did I spend on food this month?",
  "Show my spending by category as a pie chart",
  "Set a $150 monthly budget for Food, then check my budgets",
  "Bought a €25 museum ticket in Paris",
  "Delete all my Starbucks purchases",
  "Export this month's expenses to CSV",
];

const uid = () => Math.random().toString(36).slice(2);

export default function Home() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    // Conversation memory: send recent turns (with action outcomes) so "delete that one" works.
    const history = messages.slice(-8).map((m) => ({
      role: m.role,
      content: m.role === "assistant" && m.results?.length ? `${m.content}\n[results] ${m.results.map((r) => r.message).join(" | ")}` : m.content,
    }));
    setMessages((ms) => [...ms, { id: uid(), role: "user", content: message }]);
    setInput("");
    setBusy(true);
    try {
      const res = await api<AgentResponse>("/api/agent", { message, history });
      setMessages((ms) => [...ms, { id: uid(), role: "assistant", content: res.reply, reasoning: res.reasoning, results: res.results, clarification: !!res.clarification }]);
    } catch (e) {
      setMessages((ms) => [...ms, { id: uid(), role: "assistant", content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-4 lg:h-screen">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-serif text-3xl leading-none tracking-tight">Spendwise<span className="text-accent">.</span></h1>
          <p className="mt-1 text-sm text-muted">An AI agent that turns plain English into real actions on your expense ledger.</p>
        </div>
        <div className="hidden gap-1.5 text-[11px] text-muted sm:flex">
          {["LLM planner", "Schema-validated", "Confirms deletes", "Audit-logged"].map((t) => (
            <span key={t} className="rounded-full border border-line bg-card px-2 py-0.5">{t}</span>
          ))}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-h-[32rem] flex-col rounded-2xl border border-line bg-card lg:min-h-0">
          <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
            {messages.length === 0 && (
              <div className="mx-auto max-w-lg py-8 text-center">
                <p className="font-serif text-2xl">What did you spend today?</p>
                <p className="mt-2 text-sm text-muted">Log purchases, ask questions, set budgets, convert currencies, draw charts or export a CSV. Destructive actions always ask first.</p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-full border border-line bg-paper px-3 py-1.5 text-left text-sm hover:border-accent hover:text-accent">{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-paper">{m.content}</p>
              </div>
            ) : (
              <div key={m.id} className="max-w-[95%] space-y-2.5">
                <div className={`rounded-2xl rounded-bl-md px-4 py-2.5 text-sm whitespace-pre-line ${m.error ? "bg-bad-soft text-bad" : m.clarification ? "bg-warn-soft" : "bg-paper"}`}>
                  {m.clarification && <span className="mr-1.5 font-semibold text-warn">Quick question:</span>}
                  {m.content}
                </div>
                {m.reasoning && (
                  <details className="group pl-1 text-xs text-muted">
                    <summary className="cursor-pointer select-none list-none hover:text-ink"><span className="inline-block transition group-open:rotate-90">▸</span> How the agent planned this</summary>
                    <p className="mt-1 border-l-2 border-line pl-3 italic">{m.reasoning}</p>
                  </details>
                )}
                {m.results?.map((r) => <ResultCard key={`${m.id}-${r.index}-${r.type}`} initial={r} onChange={refresh} />)}
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className="flex gap-1"><span className="dot h-1.5 w-1.5 rounded-full bg-accent" /><span className="dot h-1.5 w-1.5 rounded-full bg-accent" /><span className="dot h-1.5 w-1.5 rounded-full bg-accent" /></span>
                Planning and running actions…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t border-line p-3">
            <div className="flex items-end gap-2 rounded-xl border border-line bg-paper p-1.5 focus-within:border-accent">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={1000}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder='e.g. "coffee $5.75 this morning"'
                className="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted/70" />
              <button disabled={busy || !input.trim()} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40">Send</button>
            </div>
          </form>
        </section>

        <Sidebar refreshKey={refreshKey} onDataChanged={refresh} />
      </main>
    </div>
  );
}
