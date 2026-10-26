"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Loader2, PenLine, RotateCcw, Send, ShieldCheck, User, WifiOff } from "lucide-react";
import { analyze, describeKey } from "@/core/analyze";
import { fieldOf } from "@/ui/field-editor";
import {
  ASSIST_DOWN,
  ApplyOutcome,
  ChatEdit,
  applyChatEdits,
  compactBookingForModel,
  nextAsk,
  offlineItemNote,
  parseLocally,
  stageProgress,
} from "@/core/chat";
import { emptyChatBooking } from "@/core/edit";
import { Booking } from "@/core/model";
import { istToday, formatDate } from "@/core/values";
import { Workspace, commit, newWorkspace, undo } from "@/core/workspace";
import { BookingView } from "@/ui/booking-view";
import { Button, VerdictChip, cx } from "@/ui/bits";
import { load, save, clear } from "@/ui/persist";

type Msg = { id: string; role: "user" | "assistant"; text: string; changes?: string[]; offline?: boolean };
type State = { ws: Workspace; msgs: Msg[]; asked: string[]; assistDown: boolean };

const KEY = "preflight.chat.v2";
// The browser waits at most this long before using the deterministic fallback.
const CLIENT_TIMEOUT_MS = 12_000;

const EXAMPLES = [
  "Sending 3 pallets of ceramic mugs from Manchester to an Amazon warehouse in Frankfurt, ready next Friday. Cheapest please.",
  "1080 mugs at £5 each, 12 per carton, 0.5 kg each, HS 691200, made in the UK.",
  "Total weight is 620 kg, the delivery slot is booked, and we're Northfield Goods.",
  "Add a pallet",
];

function fresh(): State {
  return {
    ws: newWorkspace(emptyChatBooking(`chat-${Date.now().toString(36)}`)),
    msgs: [
      {
        id: "hello",
        role: "assistant",
        text: "Tell me about your shipment in your own words: what you're sending, from where to where, and when. I'll fill in the booking, ask only for what's missing, and check it against the rulebook after every message.",
      },
    ],
    asked: [],
    assistDown: false,
  };
}

export function BookApp() {
  const [st, setSt] = useState<State | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"chat" | "booking">("chat");
  const [today, setToday] = useState<string>("");
  const scroller = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    setToday(istToday());
    const s = load<State>(KEY);
    setSt(s && s.ws && Array.isArray(s.msgs) ? { ...s, assistDown: !!s.assistDown } : fresh());
  }, []);
  useEffect(() => {
    if (st) save(KEY, st);
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [st]);

  const analysis = useMemo(() => (st && today ? analyze(st.ws.current, today) : null), [st, today]);
  if (!st || !analysis || !today) return <div className="p-8 text-ink-3">Loading…</div>;

  const b = st.ws.current;
  const started = st.msgs.some((m) => m.role === "user");
  const progress = stageProgress(b);
  const done = progress.filter((p) => p.open === 0).length;
  const current = progress.find((p) => p.open > 0)?.stage;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput("");
    const id = `m${Date.now()}-${seq.current++}`;
    const before = st;
    setSt({ ...before, msgs: [...before.msgs, { id, role: "user", text: message }] });

    let edits: ChatEdit[] = [];
    let reply = "";
    let offline = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, booking: compactBookingForModel(before.ws.current), asked: before.asked }),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
      const j = await res.json();
      if (j && j.ok && Array.isArray(j.edits)) {
        edits = j.edits as ChatEdit[];
        reply = typeof j.reply === "string" ? j.reply : "";
      } else offline = true;
    } catch {
      offline = true;
    }
    if (offline) edits = parseLocally(message, before.ws.current, before.asked, today);

    const out: ApplyOutcome = applyChatEdits(before.ws.current, edits);
    const ws = commit(before.ws, out.booking, `Chat: "${message.length > 60 ? `${message.slice(0, 57)}…` : message}"`, "chat", today);
    const after = analyze(out.booking, today);

    const lines: string[] = [];
    if (offline) {
      if (out.applied.length) lines.push(`Understood without the language assistant: ${out.applied.join("; ")}.`);
      const note = offlineItemNote(message, edits, out.booking, before.asked);
      if (note) lines.push(note);
      if (!out.applied.length && !note) lines.push("I couldn't read that without the language assistant. Answer the question below in a few words, or use the guided booking fields.");
      if (out.rejected.length) lines.push(out.rejected.join(" "));
    } else if (out.rejected.length) {
      // The model's reply may claim a rejected change happened, so describe what was actually applied.
      if (out.applied.length) lines.push(`Updated: ${out.applied.join("; ")}.`);
      lines.push(out.rejected.join(" "));
    } else if (reply) lines.push(reply);
    if (out.clarifications.length) lines.push(out.clarifications.join(" "));

    const entry = ws !== before.ws ? ws.log[0] : null;
    const changes: string[] = [];
    if (entry) {
      const beforeA = analyze(before.ws.current, today);
      // A rule finding that only says "not provided yet" isn't news while details are still being collected.
      const notYetGiven = (key: string, a: typeof after) => {
        const fd = a.findings.find((x) => x.key === key);
        return (
          !!fd &&
          fd.fields.length > 0 &&
          fd.fields.every((r) => {
            const fv = fieldOf(a.booking, r);
            return !fv || fv.status === "missing" || fv.status === "unknown";
          })
        );
      };
      const fixed = entry.resolvedKeys.filter((k) => !k.startsWith("DATA:") && !notYetGiven(k, beforeA));
      const raised = entry.introducedKeys.filter((k) => !k.startsWith("DATA:") && !notYetGiven(k, after));
      for (const c of entry.changes.filter((c) => c.before !== "(blank)" && c.before !== "(none)").slice(0, 3)) changes.push(`${c.label}: ${c.before} → ${c.after}`);
      if (entry.carrierBefore !== entry.carrierAfter && entry.carrierAfter)
        changes.push(`Carrier now ${entry.carrierAfter}${entry.carrierBefore ? ` (was ${entry.carrierBefore})` : ""}`);
      for (const k of fixed) changes.push(`Resolved ${describeKey(k, beforeA.findings)}`);
      for (const k of raised) changes.push(`New issue ${describeKey(k, after.findings)}`);
    }
    if (!out.clarifications.length) {
      const ask = nextAsk(out.booking);
      if (ask) lines.push(ask.text);
      else
        lines.push(
          after.verdict === "passed"
            ? "That's everything. Pre-flight checks passed: the booking is ready for the carrier."
            : after.verdict === "warnings"
              ? `That's everything I need. The checks passed with ${after.counts.amber} warning${after.counts.amber > 1 ? "s" : ""} to review.`
              : `I have all the details, but ${after.counts.red || after.counts.incomplete} issue${(after.counts.red || after.counts.incomplete) > 1 ? "s need" : " needs"} fixing before the shipment can go. Each has a suggested fix on the right, or tell me the correction here.`
        );
    }
    setSt({
      ws,
      msgs: [...before.msgs, { id, role: "user", text: message }, { id: `${id}-r`, role: "assistant", text: lines.join("\n\n"), changes, offline }],
      asked: nextAsk(out.booking)?.keys ?? [],
      assistDown: offline,
    });
    setBusy(false);
  };

  const onCommit = (next: Booking, label: string) =>
    setSt((s) => (s ? { ...s, ws: commit(s.ws, next, label, "edit", today), asked: nextAsk(next)?.keys ?? [] } : s));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Book by chat</h1>
          <p className="mt-1 text-sm text-ink-3">Today: {formatDate(today)} (IST) · UK → Germany, France or the Netherlands</p>
        </div>
        <div className="flex items-center gap-2">
          {done === 4 && <VerdictChip verdict={analysis.verdict} />}
          <Button
            size="sm"
            onClick={() => {
              clear(KEY);
              setSt(fresh());
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Start over
          </Button>
        </div>
      </div>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`Booking progress: ${done} of 4 stages complete`}>
        {progress.map((p, i) => {
          // Stages follow real completion: a stage is done only when none of its required details are missing.
          const complete = p.open === 0;
          const active = p.stage === current;
          const state = complete ? "Done" : active ? "In progress" : "To do";
          return (
            <li
              key={p.stage}
              className={cx(
                "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm",
                complete ? "bg-green-soft text-green" : active ? "bg-white text-ink ring-2 ring-accent" : "bg-white/60 text-ink-3 ring-1 ring-line"
              )}
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cx(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  complete ? "bg-green text-white" : active ? "bg-accent text-white" : "border border-grey-line text-ink-3"
                )}
                aria-hidden
              >
                {complete ? <Check className="h-3.5 w-3.5" /> : active ? <PenLine className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-medium leading-tight">{p.stage}</span>
                <span className={cx("block text-[11px] leading-tight", complete ? "text-green" : active ? "text-accent-strong" : "text-ink-3")}>
                  {complete ? "Done" : active && p.open ? `${p.open} detail${p.open > 1 ? "s" : ""} to go` : state}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex gap-1 rounded-lg bg-grey-soft p-1 text-sm lg:hidden" role="tablist" aria-label="View">
        {(["chat", "booking"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("flex-1 rounded-md py-1.5 font-medium", tab === t ? "bg-white shadow-sm" : "text-ink-3")}>
            {t === "chat" ? "Chat" : "Booking & checks"}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
        <div className={cx("lg:block", tab === "chat" ? "block" : "hidden")}>
          <div className="flex h-[calc(100vh-260px)] min-h-[520px] flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-line lg:sticky lg:top-20">
            <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto p-4" role="log" aria-live="polite" aria-label="Conversation">
              {st.msgs.map((m) => (
                <div key={m.id} className={cx("flex gap-2", m.role === "user" && "flex-row-reverse")}>
                  <div className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full", m.role === "user" ? "bg-ink text-white" : "bg-accent-soft text-accent-strong")} aria-hidden>
                    {m.role === "user" ? <User className="h-4 w-4" /> : m.offline ? <WifiOff className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div className={cx("max-w-[85%] space-y-2", m.role === "user" && "items-end")}>
                    <div className={cx("whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm", m.role === "user" ? "bg-ink text-white" : "bg-canvas text-ink")}>
                      <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
                      {m.text}
                    </div>
                    {m.changes && m.changes.length > 0 && (
                      <ul className="space-y-0.5 rounded-xl border border-brand/20 bg-brand-soft px-3 py-2 text-xs text-brand" aria-label="What changed">
                        {m.changes.map((c, i) => (
                          <li key={i}>• {c}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-sm text-ink-3">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading your message…
                </div>
              )}
              {!busy && (
                <div className="flex flex-wrap gap-2 pt-1" aria-label="Suggested messages">
                  {(started ? EXAMPLES.slice(3) : EXAMPLES.slice(0, 1)).map((e) => (
                    <button
                      key={e}
                      onClick={() => send(e)}
                      className="rounded-full border border-line bg-white px-3 py-1.5 text-left text-xs text-ink-2 hover:border-accent hover:bg-accent-soft/60"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {st.assistDown && (
              <div className="flex items-start gap-2 border-t border-amber-line bg-amber-soft px-4 py-2.5 text-xs text-ink-2" role="status">
                <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" aria-hidden />
                {ASSIST_DOWN}
              </div>
            )}
            <form
              className="border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <div className="flex gap-2">
                <label htmlFor="chat-input" className="sr-only">
                  Message
                </label>
                <input
                  id="chat-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={busy ? "Working…" : "Describe the shipment, or a change"}
                  disabled={busy}
                  maxLength={2000}
                  className="min-w-0 flex-1 rounded-xl border border-grey-line px-3 py-2 text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                />
                <Button type="submit" variant="primary" disabled={busy || !input.trim()} title="Send message">
                  <Send className="h-4 w-4" aria-hidden />
                  <span className="sr-only">Send message</span>
                </Button>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Every message is checked against the fixed 10-rule rulebook. AI only reads your words; code makes every decision.
              </p>
            </form>
          </div>
        </div>

        <div className={cx("min-w-0 lg:block", tab === "booking" ? "block" : "hidden")}>
          <BookingView
            ws={st.ws}
            analysis={analysis}
            narrow
            onCommit={onCommit}
            onUndo={() => setSt((s) => (s ? { ...s, ws: undo(s.ws) } : s))}
            onAcknowledge={(key, on) =>
              setSt((s) =>
                s ? { ...s, ws: { ...s.ws, acknowledged: on ? [...new Set([...s.ws.acknowledged, key])] : s.ws.acknowledged.filter((k) => k !== key) } } : s
              )
            }
          />
        </div>
      </div>
    </div>
  );
}
