"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, RotateCcw, Send, User, WifiOff } from "lucide-react";
import { analyze, describeKey } from "@/core/analyze";
import { fieldOf } from "@/ui/field-editor";
import { ApplyOutcome, ChatEdit, applyChatEdits, compactBookingForModel, missingQuestions, nextAsk, parseLocally } from "@/core/chat";
import { emptyChatBooking } from "@/core/edit";
import { Booking } from "@/core/model";
import { istToday, formatDate } from "@/core/values";
import { Workspace, commit, newWorkspace, undo } from "@/core/workspace";
import { BookingView } from "@/ui/booking-view";
import { Button, VerdictChip, cx } from "@/ui/bits";
import { load, save, clear } from "@/ui/persist";

type Msg = { id: string; role: "user" | "assistant"; text: string; meta?: string; offline?: boolean };
type State = { ws: Workspace; msgs: Msg[]; asked: string[] };

const KEY = "preflight.chat.v1";
const EXAMPLES = [
  "Sending 3 pallets of ceramic mugs from Manchester to an Amazon warehouse in Frankfurt, ready next Friday. Cheapest please.",
  "1080 mugs at £5 each, 12 per carton, 0.5 kg each, HS 691200, made in the UK.",
  "Total weight is 620 kg and the delivery slot is booked.",
];

function fresh(): State {
  return {
    ws: newWorkspace(emptyChatBooking(`chat-${Date.now().toString(36)}`)),
    msgs: [
      {
        id: "hello",
        role: "assistant",
        text: "Hi! Tell me about your shipment in your own words: what you're sending, from where to where, and when. I'll fill in the booking, ask only for what's missing, and check it against all 10 rules as we go.",
      },
    ],
    asked: [],
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
    setSt(s && s.ws && Array.isArray(s.msgs) ? s : fresh());
  }, []);
  useEffect(() => {
    if (st) save(KEY, st);
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [st]);

  const analysis = useMemo(() => (st && today ? analyze(st.ws.current, today) : null), [st, today]);
  if (!st || !analysis || !today) return <div className="p-8 text-ink-3">Loading…</div>;

  const b = st.ws.current;
  const started = st.msgs.some((m) => m.role === "user");
  const pending = started ? missingQuestions(b).length : 0;

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
        signal: AbortSignal.timeout(45_000),
      });
      const j = await res.json();
      if (j && j.ok && Array.isArray(j.edits)) {
        edits = j.edits as ChatEdit[];
        reply = typeof j.reply === "string" ? j.reply : "";
      } else offline = true;
    } catch {
      offline = true;
    }
    if (offline) {
      edits = parseLocally(message, before.ws.current, before.asked, today);
      reply = edits.length ? "Got it." : "";
    }

    const out: ApplyOutcome = applyChatEdits(before.ws.current, edits);
    const ws = commit(before.ws, out.booking, `Chat: "${message.length > 60 ? `${message.slice(0, 57)}…` : message}"`, "chat", today);
    const after = analyze(out.booking, today);

    const lines: string[] = [];
    // If anything was rejected the model's reply may claim it happened, so
    // describe the outcome from what was actually applied instead.
    if (out.rejected.length) {
      if (out.applied.length) lines.push(`Updated: ${out.applied.join("; ")}.`);
      lines.push(out.rejected.join(" "));
    } else if (reply) lines.push(reply);
    if (out.clarifications.length) lines.push(out.clarifications.join(" "));
    const entry = ws.log[0] && ws !== before.ws ? ws.log[0] : null;
    let meta: string | undefined;
    if (entry) {
      const beforeA = analyze(before.ws.current, today);
      // A rule finding that only says "not provided yet" isn't news while we're still collecting.
      const notYetGiven = (key: string, a: typeof after) => {
        const fd = a.findings.find((x) => x.key === key);
        return !!fd && fd.fields.length > 0 && fd.fields.every((r) => {
          const fv = fieldOf(a.booking, r);
          return !fv || fv.status === "missing" || fv.status === "unknown";
        });
      };
      const fixed = entry.resolvedKeys.filter((k) => !k.startsWith("DATA:") && !notYetGiven(k, beforeA));
      const raised = entry.introducedKeys.filter((k) => !k.startsWith("DATA:") && !notYetGiven(k, after));
      const bits: string[] = [];
      const changes = entry.changes.filter((c) => c.before !== "(blank)" && c.before !== "(none)");
      if (changes.length) bits.push(`Changed: ${changes.slice(0, 3).map((c) => `${c.label} ${c.before} → ${c.after}`).join("; ")}`);
      if (entry.carrierBefore !== entry.carrierAfter && entry.carrierAfter) bits.push(`Carrier now ${entry.carrierAfter}${entry.carrierBefore ? ` (was ${entry.carrierBefore})` : ""}`);
      if (fixed.length) bits.push(`Resolved: ${fixed.map((k) => describeKey(k, beforeA.findings)).join("; ")}`);
      if (raised.length) bits.push(`New issue: ${raised.map((k) => describeKey(k, after.findings)).join("; ")}`);
      meta = bits.join(" · ") || undefined;
    }
    if (!out.clarifications.length) {
      const ask = nextAsk(out.booking);
      if (ask) lines.push(ask.text);
      else
        lines.push(
          after.verdict === "passed"
            ? "That's everything. Pre-flight checks passed: the booking is ready. See the confirmation and next steps on the right."
            : after.verdict === "warnings"
              ? `That's everything I need. Checks passed with ${after.counts.amber} warning${after.counts.amber > 1 ? "s" : ""}; see the details on the right.`
              : `I have all the details, but ${after.counts.red || after.counts.incomplete} issue${(after.counts.red || after.counts.incomplete) > 1 ? "s need" : " needs"} fixing before the shipment can go. Each one is explained on the right with a suggested fix, or just tell me the correction here.`
        );
    }
    if (offline && edits.length === 0) {
      lines.unshift("The language assistant is unavailable right now, so I couldn't read that. You can answer the question below in a few words, or fill in the booking directly using the form on the right.");
    }
    const nextAskKeys = nextAsk(out.booking)?.keys ?? [];
    setSt({
      ws,
      msgs: [...before.msgs, { id, role: "user", text: message }, { id: `${id}-r`, role: "assistant", text: lines.join("\n\n"), meta, offline }],
      asked: nextAskKeys,
    });
    setBusy(false);
  };

  const onCommit = (next: Booking, label: string) =>
    setSt((s) => (s ? { ...s, ws: commit(s.ws, next, label, "edit", today), asked: nextAsk(next)?.keys ?? [] } : s));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New booking</h1>
          <p className="text-sm text-ink-3">Describe the shipment in plain language. Checks re-run after every message. Today: {formatDate(today)} (IST)</p>
        </div>
        <div className="flex items-center gap-2">
          {pending ? (
            <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand ring-1 ring-inset ring-brand/20">
              Collecting details · {pending} question{pending > 1 ? "s" : ""} left
            </span>
          ) : (
            <VerdictChip verdict={analysis.verdict} />
          )}
          <Button
            size="sm"
            onClick={() => {
              clear(KEY);
              setSt(fresh());
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Start over
          </Button>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg bg-grey-soft p-1 text-sm lg:hidden">
        {(["chat", "booking"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("flex-1 rounded-md py-1.5 font-medium", tab === t ? "bg-white shadow-sm" : "text-ink-3")}>
            {t === "chat" ? "Chat" : `Booking & checks`}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        <div className={cx("lg:block", tab === "chat" ? "block" : "hidden")}>
          <div className="flex h-[calc(100vh-210px)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-line bg-white lg:sticky lg:top-20">
            <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4">
              {st.msgs.map((m) => (
                <div key={m.id} className={cx("flex gap-2", m.role === "user" && "flex-row-reverse")}>
                  <div className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full", m.role === "user" ? "bg-ink text-white" : "bg-brand-soft text-brand")}>
                    {m.role === "user" ? <User className="h-4 w-4" /> : m.offline ? <WifiOff className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div className={cx("max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm", m.role === "user" ? "bg-ink text-white" : "bg-canvas text-ink")}>
                    {m.text}
                    {m.meta && <div className="mt-1.5 border-t border-line pt-1.5 text-xs text-brand">{m.meta}</div>}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-sm text-ink-3">
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading your message…
                </div>
              )}
              {!started && (
                <div className="space-y-2 pt-2">
                  <div className="text-xs font-medium text-ink-3">Try an example:</div>
                  {EXAMPLES.map((e) => (
                    <button key={e} onClick={() => send(e)} className="block w-full rounded-lg border border-line px-3 py-2 text-left text-xs text-ink-2 hover:border-brand hover:bg-brand-soft/50">
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <form
              className="flex gap-2 border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={busy ? "Working…" : "Type a message, e.g. “add a pallet”"}
                disabled={busy}
                maxLength={2000}
                className="min-w-0 flex-1 rounded-lg border border-grey-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <Button type="submit" variant="primary" disabled={busy || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
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
          {b.items.length === 0 && (
            <p className="mt-3 text-xs text-ink-3">Products appear here as soon as you mention them in the chat.</p>
          )}
        </div>
      </div>
    </div>
  );
}
