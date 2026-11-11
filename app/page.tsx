"use client";
import { useEffect, useRef, useState } from "react";
import ResultCard from "@/components/ResultCard";
import Sidebar from "@/components/Sidebar";
import { api } from "@/components/api";
import { Divider, Heart, Sprig } from "@/components/Ornaments";
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
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-5 lg:h-screen">
      <header className="relative mb-5 text-center">
        <Sprig className="pointer-events-none absolute -top-1 left-0 hidden h-14 w-28 opacity-90 sm:block" />
        <Sprig flip className="pointer-events-none absolute -top-1 right-0 hidden h-14 w-28 opacity-90 sm:block" />
        <p className="eyebrow text-gold">Your little money diary</p>
        <h1 className="mt-1 font-script text-5xl leading-[1.15] text-accent sm:text-6xl">Spendwise</h1>
        <Divider className="my-2" />
        <p className="font-serif text-lg italic text-muted">An AI agent that turns plain English into real actions on your expense ledger.</p>
        <div className="mt-3 hidden flex-wrap justify-center gap-1.5 sm:flex">
          {["LLM planner", "Schema-validated", "Confirms deletes", "Audit-logged"].map((t) => (
            <span key={t} className="eyebrow rounded-full border border-gold/40 bg-card/70 px-3 py-1 text-[9.5px] text-gold">{t}</span>
          ))}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="invite flex min-h-[32rem] flex-col rounded-[28px] lg:min-h-0">
          <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
            {messages.length === 0 && (
              <div className="rise mx-auto max-w-xl py-6 text-center">
                <p className="font-script text-3xl text-gold">Dear you,</p>
                <p className="mt-1 font-serif text-3xl font-medium sm:text-4xl">What did you spend today?</p>
                <p className="mx-auto mt-3 max-w-md text-sm font-light leading-relaxed text-muted">Log purchases, ask questions, set budgets, convert currencies, draw charts or export a CSV. Destructive actions always ask first.</p>
                <Divider className="my-5" />
                <p className="eyebrow mb-3 text-muted">Try one of these</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-full border border-accent/25 bg-accent-soft/60 px-3.5 py-1.5 text-left text-sm text-ink transition hover:-translate-y-0.5 hover:border-accent hover:bg-accent-soft hover:text-accent">{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => m.role === "user" ? (
              <div key={m.id} className="rise flex justify-end">
                <p className="max-w-[85%] rounded-[22px] rounded-br-md bg-accent px-4 py-2.5 text-sm text-white shadow-[0_8px_20px_-12px_rgba(185,103,122,.8)]">{m.content}</p>
              </div>
            ) : (
              <div key={m.id} className="rise max-w-[95%] space-y-2.5">
                <div className={`rounded-[22px] rounded-bl-md border px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${m.error ? "border-bad/20 bg-bad-soft text-bad" : m.clarification ? "border-gold/30 bg-gold-soft" : "border-line bg-paper"}`}>
                  {m.clarification && <span className="mr-1.5 font-serif text-base font-semibold italic text-gold">Quick question:</span>}
                  {m.content}
                </div>
                {m.reasoning && (
                  <details className="group pl-1 text-xs text-muted">
                    <summary className="cursor-pointer select-none list-none hover:text-accent"><span className="inline-block transition group-open:rotate-90">❧</span> How the agent planned this</summary>
                    <p className="mt-1 border-l-2 border-gold/40 pl-3 font-serif text-sm italic">{m.reasoning}</p>
                  </details>
                )}
                {m.results?.map((r) => <ResultCard key={`${m.id}-${r.index}-${r.type}`} initial={r} onChange={refresh} />)}
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className="flex gap-1 text-accent"><Heart className="dot h-2.5 w-2.5" /><Heart className="dot h-2.5 w-2.5" /><Heart className="dot h-2.5 w-2.5" /></span>
                <span className="font-serif italic">Planning and running actions…</span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t border-line p-3 sm:p-4">
            <div className="flex items-end gap-2 rounded-full border border-line bg-paper p-1.5 pl-3 transition focus-within:border-accent/60 focus-within:shadow-[0_0_0_4px_var(--color-accent-soft)]">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={1000}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder='e.g. "coffee $5.75 this morning"'
                className="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted/70" />
              <button disabled={busy || !input.trim()} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-2 text-sm font-medium tracking-wide text-white transition hover:bg-accent/90 disabled:opacity-40">
                Send <Heart className="h-3 w-3" />
              </button>
            </div>
          </form>
        </section>

        <Sidebar refreshKey={refreshKey} onDataChanged={refresh} />
      </main>
    </div>
  );
}
