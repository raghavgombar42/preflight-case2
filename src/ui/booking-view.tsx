"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  History,
  Info,
  MapPin,
  Pencil,
  Printer,
  RotateCcw,
  Sparkles,
  Truck,
  Undo2,
} from "lucide-react";
import { analyze, type Analysis } from "@/core/analyze";
import { ruleMeta, RuleId } from "@/core/config";
import { applyPatches } from "@/core/edit";
import {
  BOOKING_FIELDS,
  BOOKING_FIELD_LABELS,
  Booking,
  BookingField,
  FieldRef,
  FieldValue,
  ITEM_FIELDS,
  ITEM_FIELD_LABELS,
  ItemField,
  Patch,
  itemLabel,
} from "@/core/model";
import type { Finding, FixAction } from "@/core/rules";
import { displayRaw, formatDate, gbp, kg, num } from "@/core/values";
import type { LogEntry, Workspace } from "@/core/workspace";
import {
  Button,
  Card,
  CardHead,
  ConfidenceChip,
  RuleChip,
  STATUS_LABEL,
  SeverityChip,
  SourceBadge,
  StatusIcon,
  VERDICT_STYLE,
  VerdictChip,
  cx,
} from "./bits";
import { FieldEditor, fieldOf } from "./field-editor";

export type CommitFn = (next: Booking, label: string, source: LogEntry["source"]) => void;

type Props = {
  ws: Workspace;
  analysis: Analysis;
  onCommit: CommitFn;
  onUndo: () => void;
  onReset?: () => void;
  onAcknowledge: (key: string, on: boolean) => void;
  narrow?: boolean;
};

type ApplyFn = (p: Patch[], label: string, source?: LogEntry["source"]) => void;

const uniqRules = (keys: string[] | undefined) => [...new Set((keys ?? []).map((k) => k.split(":")[0]))];

export function BookingView({ ws, analysis, onCommit, onUndo, onReset, onAcknowledge, narrow }: Props) {
  const b = ws.current;
  const a = analysis;
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash]);
  const apply: ApplyFn = (patches, label, source = "fix") => {
    const { booking, errors } = applyPatches(b, patches, "edited");
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    setError(null);
    if (source === "fix") {
      // Brief success feedback naming every rule the fix cleared.
      const after = new Set(analyze(booking, a.today).findings.map((f) => f.key));
      const cleared = uniqRules(a.findings.filter((f) => !after.has(f.key)).map((f) => f.key)).filter((r) => r !== "DATA");
      setFlash(cleared.length ? `Fix applied · cleared ${cleared.join(", ")}` : "Fix applied");
    }
    onCommit(booking, label, source);
  };
  const ambers = a.findings.filter((f) => f.severity === "amber");
  const allAcked = ambers.every((f) => ws.acknowledged.includes(f.key));
  const showGuided = b.mode === "chat" && a.findings.some((f) => f.ruleId === "DATA");

  return (
    <div className="space-y-5">
      <Hero ws={ws} analysis={a} onUndo={onUndo} onReset={onReset} onApply={apply} />
      <div aria-live="polite">
        {error && <div className="rounded-lg border border-red-line bg-red-soft px-4 py-2 text-sm text-red">{error}</div>}
        {flash && (
          <div key={flash} className="reveal flex items-center gap-2 rounded-lg bg-green-soft px-4 py-2 text-sm font-medium text-green ring-1 ring-inset ring-green-line">
            <Check className="h-4 w-4" aria-hidden /> {flash}
          </div>
        )}
      </div>
      {showGuided && <GuidedForm booking={b} onApply={apply} />}

      <div className={cx("grid gap-5", !narrow && "lg:grid-cols-[minmax(0,1fr)_400px]")}>
        <div className="min-w-0 space-y-5">
          <IssuesCard analysis={a} ws={ws} onApply={apply} onAcknowledge={onAcknowledge} hideData={showGuided} />
          {a.advisories.length > 0 && (
            <Card>
              <CardHead title="Advisories" sub="Beyond the rulebook. These never change the verdict." />
              <ul className="space-y-3 px-5 pb-5 pt-1">
                {a.advisories.map((x) => (
                  <li key={x.key} className="flex gap-3 text-sm">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                    <div>
                      <div className="font-medium text-ink">{x.title}</div>
                      <div className="text-ink-2">{x.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="min-w-0 space-y-5">
          <CarrierCard analysis={a} onApply={apply} />
          <ConfirmationCard analysis={a} allAcked={allAcked} ambers={ambers.length} />
        </div>
      </div>

      <div className={cx("grid gap-5", !narrow && "lg:grid-cols-[minmax(0,1fr)_400px]")}>
        <div className="min-w-0 space-y-5">
          <ChecksCard analysis={a} />
          <BookingDataCard ws={ws} onApply={apply} />
        </div>
        <div className="min-w-0">{ws.log.length > 0 && <ChangeLogCard log={ws.log} />}</div>
      </div>
    </div>
  );
}

// ---------- 1. verdict hero ----------

function nextAction(a: Analysis): { text: string; action?: { f: Finding; act: FixAction } } {
  if (a.verdict === "blocked") {
    const reds = a.findings.filter((f) => f.severity === "red");
    const withFix = reds.find((f) => f.fix.actions.length > 0);
    if (withFix) {
      const act = withFix.fix.actions[0];
      const n = uniqRules(act.resolves).length;
      return {
        text: n > 1 ? `Start with “${act.label}”: it clears ${n} issues at once.` : `Start with ${withFix.ruleId}: ${withFix.title}.`,
        action: act.confidence !== "confirm" || n > 1 ? { f: withFix, act } : undefined,
      };
    }
    return { text: `Start with ${reds[0].ruleId}: ${reds[0].title}.` };
  }
  if (a.verdict === "incomplete" && a.booking.mode === "chat") {
    return { text: "Answer the questions in the chat, or fill in the guided booking fields below." };
  }
  if (a.verdict === "incomplete") {
    const names = a.findings
      .filter((f) => f.severity === "incomplete")
      .map((f) => f.title.replace(/ (is missing|is not known yet)$/, "").replace(/ is not valid.*$/, " (invalid)"));
    const list = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
    return { text: `Fill in the missing details: ${list}.` };
  }
  const carrier = a.carrier.selected ? `${a.carrier.selected.option.carrier} ${a.carrier.selected.option.shortName}` : "the carrier";
  if (a.verdict === "warnings") return { text: `Review or acknowledge ${a.counts.amber} warning${a.counts.amber > 1 ? "s" : ""}, then hand over to ${carrier}.` };
  return { text: `Hand the booking to ${carrier}${a.booking.readyDate.value ? ` for collection on ${formatDate(a.booking.readyDate.value)}` : ""}.` };
}

const HERO_SENTENCE: Record<Analysis["verdict"], string> = {
  blocked: "This shipment can’t go yet: at least one rulebook check would stop it at collection, customs or the warehouse.",
  incomplete: "Some required details are missing, so the checks can’t clear this booking yet.",
  warnings: "Nothing blocks this shipment, but some details should be fixed or acknowledged first.",
  passed: "All 10 rulebook checks pass. This booking is ready to hand to the carrier.",
};

function Hero({ ws, analysis, onUndo, onReset, onApply }: { ws: Workspace; analysis: Analysis; onUndo: () => void; onReset?: () => void; onApply: ApplyFn }) {
  const b = ws.current;
  const s = VERDICT_STYLE[analysis.verdict];
  const c = analysis.counts;
  const edited = ws.history.length > 0;
  const next = nextAction(analysis);
  return (
    <section key={analysis.verdict} className={cx("reveal rounded-2xl border px-5 py-5 sm:px-6", s.banner)} aria-labelledby="verdict-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            {b.mode === "chat" ? (
              <span className="font-semibold text-ink">{b.sellerName.value ?? "New shipment"}</span>
            ) : (
              <>
                <span className="font-semibold text-ink">{b.ref.value ?? "(no Booking ID)"}</span>
                {b.sellerName.value && <span>{b.sellerName.value}</span>}
              </>
            )}
            {(b.originCity.value || b.destCity.value) && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-ink-3" aria-hidden />
                {b.originCity.value && b.destCity.value ? (
                  <>
                    {b.originCity.value} <ArrowRight className="h-3 w-3" aria-label="to" /> {b.destCity.value}
                    {b.destCountry.value ? `, ${b.destCountry.value}` : ""}
                  </>
                ) : b.originCity.value ? (
                  `From ${b.originCity.value}`
                ) : (
                  `To ${b.destCity.value}${b.destCountry.value ? `, ${b.destCountry.value}` : ""}`
                )}
              </span>
            )}
            {b.sellerPriority.value && <span>Priority: {b.sellerPriority.value}</span>}
            {b.sourceRow && <span className="text-ink-3">Bookings row {b.sourceRow}</span>}
            {b.isTemplateExample && <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-3">template example</span>}
            {edited && <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-amber">edited · {ws.history.length}</span>}
          </div>
          <h1 id="verdict-title" className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {s.icon}
            {s.label}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-2 sm:text-base">{HERO_SENTENCE[analysis.verdict]}</p>
        </div>
        <div className="no-print flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={onUndo} disabled={!edited} title="Undo the last change">
            <Undo2 className="h-3.5 w-3.5" aria-hidden /> Undo
          </Button>
          {onReset && (
            <Button size="sm" variant="ghost" onClick={onReset} disabled={!edited} title="Discard all changes and return to the uploaded data">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Original
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => window.print()} title="Print or save as PDF">
            <Printer className="h-3.5 w-3.5" aria-hidden /> Print
          </Button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-lg bg-white/80 px-2.5 py-1 font-medium text-red">{c.red} red · blocks</span>
        <span className="rounded-lg bg-white/80 px-2.5 py-1 font-medium text-amber">{c.amber} amber · warning</span>
        <span className="rounded-lg bg-white/80 px-2.5 py-1 font-medium text-grey">{c.incomplete} missing</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-white/80 px-4 py-3">
        <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-ink">
          <span className="font-semibold">Next step: </span>
          {next.text}
        </p>
        {next.action && (
          <Button size="sm" variant="primary" className="no-print" onClick={() => onApply(next.action!.act.patches, `${next.action!.f.ruleId}: ${next.action!.act.label}`)}>
            Apply fix
          </Button>
        )}
      </div>
    </section>
  );
}

// ---------- guided form (chat) ----------

const STAGE_FIELDS: Array<{ stage: string; fields: BookingField[] }> = [
  { stage: "Route", fields: ["originCity", "destCity", "destinationType"] },
  { stage: "Load", fields: ["pallets", "grossWeight"] },
  { stage: "Delivery", fields: ["readyDate", "sellerPriority", "appointment", "sellerName"] },
];
const ITEM_GUIDED: ItemField[] = ["description", "quantity", "unitPrice", "unitsPerCarton", "unitWeight", "hsCode", "countryOfOrigin"];
const open = (fv: FieldValue<unknown> | null) => !!fv && (fv.status === "missing" || fv.status === "invalid");

function GuidedForm({ booking, onApply }: { booking: Booking; onApply: ApplyFn }) {
  const [updated, setUpdated] = useState<string | null>(null);
  const save = (p: Patch, label: string) => {
    onApply([p], label, "edit");
    setUpdated(label);
  };
  const route = STAGE_FIELDS[0].fields.filter((f) => open(booking[f] as FieldValue<unknown>));
  const later = STAGE_FIELDS.slice(1).map((s) => ({
    stage: s.stage,
    fields: s.fields.filter((f) => (f !== "appointment" || booking.destinationType.value === "Warehouse") && open(booking[f] as FieldValue<unknown>)),
  }));
  const goods = booking.items.map((it) => ({ it, fields: ITEM_GUIDED.filter((f) => open(it[f] as FieldValue<unknown>)) }));
  const groups = [
    { stage: "Route", refs: route.map((f) => ({ scope: "booking", field: f }) as FieldRef) },
    { stage: "Goods", refs: goods.flatMap((g) => g.fields.map((f) => ({ scope: "item", itemId: g.it.id, field: f }) as FieldRef)) },
    ...later.map((l) => ({ stage: l.stage, refs: l.fields.map((f) => ({ scope: "booking", field: f }) as FieldRef) })),
  ].filter((g) => g.refs.length > 0 || g.stage === "Goods");

  return (
    <Card>
      <CardHead title="Guided booking" sub="Answer in the chat or fill these fields. Changes save when you pick a value or leave a field." />
      <div className="space-y-4 px-5 pb-5 pt-1">
        <p aria-live="polite" className="min-h-4 text-xs text-green">
          {updated && (
            <span key={updated} className="reveal inline-flex items-center gap-1">
              <Check className="h-3.5 w-3.5" aria-hidden /> Updated · {updated}
            </span>
          )}
        </p>
        {groups.map((g) => (
          <div key={g.stage}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{g.stage}</div>
            {g.refs.length === 0 && g.stage === "Goods" && booking.items.length > 0 ? (
              <p className="text-sm text-green">All product details provided.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {g.refs.map((r) => (
                  <FieldEditor key={`${r.scope}-${"itemId" in r ? r.itemId : ""}-${r.field}`} booking={booking} fref={r} onSave={save} autoSave />
                ))}
              </div>
            )}
            {g.stage === "Goods" && (
              <Button size="sm" className="mt-2" onClick={() => onApply([{ kind: "addItem", values: { sku: `ITEM-${booking.nextItemSeq}` } }], "Added a product line", "edit")}>
                + Add product
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- 2. fix the issues ----------

function IssuesCard({
  analysis,
  ws,
  onApply,
  onAcknowledge,
  hideData,
}: {
  analysis: Analysis;
  ws: Workspace;
  onApply: ApplyFn;
  onAcknowledge: (key: string, on: boolean) => void;
  hideData: boolean;
}) {
  const shown = analysis.findings.filter((f) => !(hideData && f.ruleId === "DATA"));
  if (shown.length === 0) {
    return (
      <Card>
        <CardHead title="Fix the issues" />
        <p className="px-5 pb-5 text-sm text-ink-2">
          {hideData && analysis.findings.length ? "Only missing details remain: fill them in above." : "Nothing to fix. Every rule passed with the evidence shown below."}
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <CardHead title={`Fix the issues (${shown.length})`} sub="Red first. Each shows where it would fail and one recommended fix; evidence is one click away." />
      <div className="space-y-3 px-3 pb-3 pt-1 sm:px-4 sm:pb-4">
        {shown.map((f) => (
          <IssueRow
            key={f.key}
            f={f}
            booking={ws.current}
            onApply={onApply}
            acked={ws.acknowledged.includes(f.key)}
            onAcknowledge={(on) => onAcknowledge(f.key, on)}
          />
        ))}
      </div>
    </Card>
  );
}

function IssueRow({
  f,
  booking,
  onApply,
  acked,
  onAcknowledge,
}: {
  f: Finding;
  booking: Booking;
  onApply: ApplyFn;
  acked: boolean;
  onAcknowledge: (on: boolean) => void;
}) {
  const [editing, setEditing] = useState(f.ruleId === "DATA");
  const edge = { red: "border-l-red", amber: "border-l-amber", incomplete: "border-l-grey-line" }[f.severity];
  const [primary, ...others] = f.fix.actions;
  const primaryRules = uniqRules(primary?.resolves);
  const label = (a: FixAction) => `${f.ruleId === "DATA" ? "Data" : f.ruleId}: ${a.label}`;

  return (
    <article className={cx("rounded-xl border border-line border-l-4 bg-white p-4", edge)} aria-label={`${f.ruleId} ${f.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityChip severity={f.severity} />
        <RuleChip id={f.ruleId} />
        {f.stage && <span className="text-xs text-ink-3">Would fail at <span className="font-medium text-ink-2">{f.stage}</span></span>}
        {f.location && <span className="text-xs text-ink-3">· {f.location}</span>}
      </div>
      <h3 className="mt-2 font-semibold text-ink">{f.title}</h3>
      <p className="mt-1 text-sm text-ink-2">{f.detail}</p>

      {f.ruleId !== "DATA" && (
        <div className="mt-3 rounded-lg bg-canvas/80 p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Fix</span>
            <ConfidenceChip c={f.fix.confidence} />
          </div>
          <p className="text-sm text-ink">{f.fix.text}</p>
          {primary && (
            <div className="no-print mt-3 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => onApply(primary.patches, label(primary))}>
                Apply fix: {primary.label}
              </Button>
              {primaryRules.length > 1 ? (
                <span className="rounded-full bg-green-soft px-2.5 py-1 text-xs font-semibold text-green ring-1 ring-inset ring-green-line">
                  Fixes {primaryRules.length} issues at once ({primaryRules.join(", ")})
                </span>
              ) : primary.introduces && primary.introduces.length > 0 ? (
                <span className="text-xs text-red">creates {uniqRules(primary.introduces).join(", ")}</span>
              ) : null}
            </div>
          )}
          {primary?.note && <p className="mt-1.5 text-xs text-ink-3">{primary.note}</p>}
          <div className="no-print mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {others.map((a) => (
              <button key={a.id} className="text-sm font-medium text-accent-strong hover:underline" onClick={() => onApply(a.patches, label(a))}>
                {a.label}
                {a.resolves && <span className="ml-1 text-xs font-normal text-ink-3">(clears {uniqRules(a.resolves).join(", ") || "nothing alone"})</span>}
              </button>
            ))}
            {f.fields.length > 0 && (
              <button className="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink" onClick={() => setEditing(!editing)} aria-expanded={editing}>
                <Pencil className="h-3.5 w-3.5" aria-hidden /> {editing ? "Close editor" : "Edit value"}
              </button>
            )}
          </div>
        </div>
      )}

      {editing && f.fields.length > 0 && (
        <div className="no-print mt-3 grid gap-2 sm:grid-cols-2">
          {f.fields.map((r: FieldRef) => (
            <FieldEditor
              key={`${r.scope}-${"itemId" in r ? r.itemId : ""}-${r.field}`}
              booking={booking}
              fref={r}
              onSave={(p, lbl) => {
                onApply([p], lbl, "edit");
                if (f.ruleId !== "DATA") setEditing(false);
              }}
            />
          ))}
        </div>
      )}

      {f.severity === "amber" && (
        <label className="no-print mt-3 flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={acked} onChange={(e) => onAcknowledge(e.target.checked)} className="h-4 w-4 accent-amber" />
          Seller acknowledges this warning
        </label>
      )}

      {(f.evidence.length > 0 || f.consequence) && (
        <details className="mt-3 group">
          <summary className="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden /> Evidence
          </summary>
          <div className="mt-2 space-y-2">
            {f.consequence && <p className="text-xs text-ink-3">Why it matters: {f.consequence}</p>}
            {f.evidence.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {f.evidence.map((e, i) => (
                      <tr key={i}>
                        <th scope="row" className="w-1/2 bg-canvas/60 px-3 py-1.5 text-left font-normal text-ink-3">{e.label}</th>
                        <td className="px-3 py-1.5 font-medium tnum text-ink">{e.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {f.formula && <div className="border-t border-line bg-canvas/60 px-3 py-1.5 font-mono text-[11px] text-ink-3">{f.formula}</div>}
              </div>
            )}
          </div>
        </details>
      )}
    </article>
  );
}

// ---------- 3. carrier ----------

function CarrierCard({ analysis, onApply }: { analysis: Analysis; onApply: ApplyFn }) {
  const d = analysis.carrier;
  const sel = d.selected;
  const provisional = analysis.verdict === "blocked" || analysis.verdict === "incomplete";
  const runnerUp = d.options.find((o) => o.eligible && !o.isRecommended && o !== sel);
  return (
    <Card>
      <CardHead
        title="Carrier"
        sub={d.priority ? `Seller priority: ${d.priority}${d.perPallet !== null ? ` · ${kg(d.perPallet)} per pallet` : ""}` : d.perPallet !== null ? `${kg(d.perPallet)} per pallet` : undefined}
        right={provisional && sel ? <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-medium text-amber">Provisional while {analysis.verdict === "blocked" ? "blocked" : "incomplete"}</span> : undefined}
      />
      <div className="space-y-4 px-5 pb-5 pt-1">
        <div className="flex items-start gap-3">
          <div className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", sel ? "bg-brand-soft text-brand" : "bg-grey-soft text-grey")}>
            <Truck className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-semibold leading-tight text-ink">
              {sel ? `${sel.option.carrier} · ${sel.option.service}` : d.status === "missing-inputs" ? "Carrier comparison" : d.headline}
            </div>
            {d.chosen && <div className="text-xs text-ink-3">Chosen by the seller</div>}
          </div>
        </div>
        {sel && (
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-canvas px-2 py-2.5">
              <dt className="text-[11px] uppercase tracking-wide text-ink-3">Total</dt>
              <dd className="text-lg font-semibold tnum">{gbp(sel.totalCost, 0)}</dd>
            </div>
            <div className="rounded-xl bg-canvas px-2 py-2.5">
              <dt className="text-[11px] uppercase tracking-wide text-ink-3">Transit</dt>
              <dd className="text-lg font-semibold tnum">{sel.option.transitDays} days</dd>
            </div>
            <div className="rounded-xl bg-canvas px-2 py-2.5">
              <dt className="text-[11px] uppercase tracking-wide text-ink-3">On-time</dt>
              <dd className="text-lg font-semibold tnum">{sel.option.onTimeRate}%</dd>
            </div>
          </dl>
        )}
        <p className="text-sm text-ink-2">
          {d.status === "missing-inputs" ? "Add the destination, pallets and gross weight to compare the three services." : d.reason}
        </p>
        {runnerUp && (
          <p className="text-sm text-ink-2">
            <span className="font-medium text-ink">Runner-up:</span> {runnerUp.option.carrier} {runnerUp.option.shortName} · {runnerUp.versusRecommended}
          </p>
        )}
        {d.chosen && d.recommended && d.recommended !== d.chosen && (
          <p className="text-sm text-ink-2">
            For “{d.priority}” we would recommend {d.recommended.option.carrier} {d.recommended.option.shortName}.{" "}
            <button className="no-print font-medium text-accent-strong hover:underline" onClick={() => onApply([{ kind: "chooseCarrier", carrier: null }], "Carrier choice cleared")}>
              Use recommendation
            </button>
          </p>
        )}
        {d.tradeOff && (
          <p className="rounded-lg bg-amber-soft/70 px-3 py-2 text-xs text-ink-2">
            <span className="font-semibold text-amber">Trade-off, not a violation: </span>
            {d.tradeOff}
          </p>
        )}
        {d.options.length > 0 && (
          <details className="group">
            <summary className="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden /> Compare all services
            </summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[320px] text-xs">
                <thead className="bg-canvas text-left text-ink-3">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Service</th>
                    <th className="px-2 py-1.5 text-right font-medium">Total</th>
                    <th className="px-2 py-1.5 text-right font-medium">Days</th>
                    <th className="px-2 py-1.5 text-right font-medium">On-time</th>
                    <th className="px-2 py-1.5 text-right font-medium">Max/pallet</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.options.map((o) => (
                    <tr key={o.option.carrier} className={cx(o.isRecommended && "bg-brand-soft/60", !o.eligible && "text-ink-3")}>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-ink">
                          {o.option.carrier} <span className="font-normal text-ink-3">{o.option.shortName}</span>
                        </div>
                        <div className={cx("text-[11px]", o.eligible ? "text-ink-3" : "text-red")}>
                          {o.isRecommended ? "Recommended" : o.eligible ? o.versusRecommended ?? "Eligible" : `Not eligible: ${o.ineligibleReason}`}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tnum">{gbp(o.totalCost, 0)}</td>
                      <td className="px-2 py-1.5 text-right tnum">{o.option.transitDays}</td>
                      <td className="px-2 py-1.5 text-right tnum">{o.option.onTimeRate}%</td>
                      <td className="px-2 py-1.5 text-right tnum">{o.option.maxKgPerPallet} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        {d.scenarios.length > 0 && (
          <details className="group" open={d.status === "no-eligible"}>
            <summary className="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden /> Repacking options ({d.scenarios.length}, provisional)
            </summary>
            <div className="mt-2 space-y-2">
              {d.scenarios.map((s) => (
                <div key={`${s.pallets}-${s.unlocks}`} className="rounded-lg border border-dashed border-grey-line p-3 text-xs text-ink-2">
                  <div>{s.summary}</div>
                  <div className="mt-1 text-[11px] text-ink-3">Assumes total gross weight stays the same; confirm the new weight after repacking.</div>
                  <Button size="sm" className="no-print mt-2" onClick={() => onApply([{ kind: "booking", field: "pallets", value: s.pallets }], `Repacked onto ${s.pallets} pallets (scenario)`, "scenario")}>
                    Seller approves: {s.pallets} pallets
                  </Button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

// ---------- 4. confirmation ----------

function ConfirmationCard({ analysis, allAcked, ambers }: { analysis: Analysis; allAcked: boolean; ambers: number }) {
  const v = analysis.verdict;
  const title =
    v === "passed"
      ? "Ready for booking"
      : v === "warnings"
        ? allAcked
          ? `Ready for booking · ${ambers} warning${ambers > 1 ? "s" : ""} acknowledged`
          : "Ready once warnings are acknowledged"
        : "Not ready yet · provisional";
  const b = analysis.booking;
  const hasBasics = b.items.length > 0 && !!b.originCity.value && !!b.destCity.value;
  if (!hasBasics) {
    return (
      <Card>
        <CardHead title="Confirmation & next steps" />
        <p className="px-5 pb-5 pt-1 text-sm text-ink-2">
          Add shipment details to generate a pre-flight summary, carrier recommendation and next-step timeline.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <CardHead title="Confirmation & next steps" right={<span className={cx("rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", VERDICT_STYLE[v].chip)}>{title}</span>} />
      <div className="space-y-3 px-5 pb-5 pt-1">
        <p className="text-sm text-ink-2">{analysis.summary}</p>
        {analysis.estimatedDelivery && (
          <p className="flex items-center gap-2 text-sm">
            <CalendarClock className="h-4 w-4 text-ink-3" aria-hidden />
            <span>
              Estimated delivery <span className="font-medium">{analysis.estimatedDelivery}</span>
            </span>
          </p>
        )}
        {analysis.timeline.length > 0 && (
          <ol className="space-y-1.5 border-l-2 border-line pl-4">
            {analysis.timeline.map((s, i) => (
              <li key={i} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden />
                <span className="font-medium text-ink">{s.label}</span>
                {s.date && <span className="ml-2 text-xs tnum text-ink-3">{formatDate(s.date)}</span>}
              </li>
            ))}
          </ol>
        )}
        <p className="text-[11px] text-ink-3">This MVP checks and prepares the booking; it does not place the order with the carrier. Dates are calendar-day estimates.</p>
      </div>
    </Card>
  );
}

// ---------- secondary: checks, data, log ----------

function ChecksCard({ analysis }: { analysis: Analysis }) {
  const passed = analysis.rules.filter((r) => r.status === "pass").length;
  return (
    <Card>
      <details className="group">
        <summary className="flex items-center justify-between gap-2 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">All 10 rulebook checks</h2>
            <p className="text-xs text-ink-3">{passed} of 10 pass · every rule is evaluated with the numbers it was checked against</p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="divide-y divide-line border-t border-line">
          {analysis.rules.map((r) => {
            const m = ruleMeta(r.id as RuleId);
            return (
              <li key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-5 py-2.5 text-sm sm:grid-cols-[auto_190px_minmax(0,1fr)]">
                <div className="flex items-center gap-2 pt-0.5">
                  <StatusIcon status={r.status} />
                  <span className="font-mono text-xs font-semibold">{r.id}</span>
                </div>
                <div className="font-medium text-ink">
                  {m.short}
                  <span className={cx("ml-2 text-[11px] font-normal", m.severity === "red" ? "text-red" : "text-amber")}>{m.severity === "red" ? "Red" : "Amber"}</span>
                </div>
                <div className="col-span-2 text-ink-2 sm:col-span-1">
                  <span className="mr-1 text-xs font-semibold text-ink-3">{STATUS_LABEL[r.status]}:</span>
                  {r.summary}
                </div>
              </li>
            );
          })}
        </ul>
      </details>
    </Card>
  );
}

function ChangeLogCard({ log }: { log: LogEntry[] }) {
  return (
    <Card>
      <CardHead title="Change log" sub="Every change and what it did to the checks." right={<History className="h-4 w-4 text-ink-3" aria-hidden />} />
      <ol className="max-h-[420px] space-y-3 overflow-y-auto px-5 pb-5 pt-1">
        {log.map((e, i) => (
          <li key={i} className="space-y-1 rounded-lg bg-canvas/70 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink">{e.label}</span>
              <span className="shrink-0 text-ink-3">{new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className="text-ink-2">
              {e.changes.slice(0, 4).map((c, j) => (
                <div key={j} className="tnum">
                  {c.label}: <span className="text-ink-3 line-through">{c.before}</span> → <span className="font-medium">{c.after}</span>
                </div>
              ))}
            </div>
            {e.verdictBefore !== e.verdictAfter && (
              <div className="flex items-center gap-1">
                <VerdictChip verdict={e.verdictBefore} /> <ArrowRight className="h-3 w-3" aria-label="to" /> <VerdictChip verdict={e.verdictAfter} />
              </div>
            )}
            {e.carrierBefore !== e.carrierAfter && (
              <div className="text-ink-2">
                Carrier: {e.carrierBefore ?? "none"} → <span className="font-medium">{e.carrierAfter ?? "none"}</span>
              </div>
            )}
            {e.resolved.length > 0 && <div className="text-green">Resolved: {e.resolved.join("; ")}</div>}
            {e.introduced.length > 0 && <div className="text-red">New: {e.introduced.join("; ")}</div>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ValueCell({ fv, was }: { fv: FieldValue<unknown>; was?: FieldValue<unknown> }) {
  const shown =
    fv.status === "unknown" ? (
      <span className="italic text-ink-3">unknown</span>
    ) : fv.value !== null && fv.value !== undefined ? (
      <span className="tnum">{String(fv.value)}</span>
    ) : fv.status === "invalid" ? (
      <span className="text-red">{displayRaw(fv.raw)} (invalid)</span>
    ) : (
      <span className="text-ink-3">(blank)</span>
    );
  const changed = was && String(was.value ?? was.raw ?? "") !== String(fv.value ?? fv.raw ?? "");
  return (
    <span>
      {shown}
      <SourceBadge source={fv.source} />
      {changed && <span className="ml-1 text-[10px] text-ink-3">was {was.value !== null ? String(was.value) : displayRaw(was.raw)}</span>}
    </span>
  );
}

function BookingDataCard({ ws, onApply }: { ws: Workspace; onApply: ApplyFn }) {
  const [edit, setEdit] = useState<FieldRef | null>(null);
  const b = ws.current;
  const o = ws.original;
  const save = (p: Patch, label: string) => {
    onApply([p], label, "edit");
    setEdit(null);
  };
  const isEditing = (r: FieldRef) =>
    edit && edit.field === r.field && edit.scope === r.scope && (r.scope === "booking" || (edit.scope === "item" && edit.itemId === r.itemId));
  const editBtn = (r: FieldRef, name: string) => (
    <button className="no-print rounded p-0.5 text-ink-3 hover:text-accent-strong" onClick={() => setEdit(isEditing(r) ? null : r)} aria-label={`Edit ${name}`}>
      <Pencil className="h-3.5 w-3.5" aria-hidden />
    </button>
  );

  return (
    <Card>
      <details className="group">
        <summary className="flex items-center justify-between gap-2 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Booking data</h2>
            <p className="text-xs text-ink-3">Every field {b.mode === "upload" ? "as uploaded" : "collected"}, with edits. The original upload is never changed.</p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-4 border-t border-line p-5">
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {BOOKING_FIELDS.map((f) => {
              const r: FieldRef = { scope: "booking", field: f };
              return (
                <div key={f} className="border-b border-line/70 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-3">{BOOKING_FIELD_LABELS[f]}</span>
                    <span className="flex items-center gap-2 text-right">
                      <ValueCell fv={b[f] as FieldValue<unknown>} was={b.mode === "upload" ? (o[f] as FieldValue<unknown>) : undefined} />
                      {f !== "ref" && editBtn(r, BOOKING_FIELD_LABELS[f])}
                    </span>
                  </div>
                  {isEditing(r) && (
                    <div className="mt-1.5">
                      <FieldEditor booking={b} fref={r} onSave={save} compact />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {b.items.map((it) => {
            const oi = o.items.find((x) => x.id === it.id);
            return (
              <div key={it.id} className="rounded-lg border border-line">
                <div className="flex items-center justify-between border-b border-line bg-canvas/60 px-3 py-2 text-sm">
                  <span className="font-medium">{itemLabel(it)}</span>
                  <span className="flex items-center gap-3 text-xs text-ink-3">
                    {it.sourceRow ? `Items row ${it.sourceRow}` : it.id}
                    <button className="no-print font-medium text-red hover:underline" onClick={() => onApply([{ kind: "removeItem", itemId: it.id }], `Removed ${itemLabel(it)}`, "edit")}>
                      Remove
                    </button>
                  </span>
                </div>
                <div className="grid gap-x-6 gap-y-1 px-3 py-2 text-sm sm:grid-cols-2">
                  {ITEM_FIELDS.map((f) => {
                    const r: FieldRef = { scope: "item", itemId: it.id, field: f };
                    return (
                      <div key={f} className="border-b border-line/70 py-1.5 last:border-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-ink-3">{ITEM_FIELD_LABELS[f]}</span>
                          <span className="flex items-center gap-2 text-right">
                            <ValueCell fv={it[f] as FieldValue<unknown>} was={b.mode === "upload" && oi ? (oi[f] as FieldValue<unknown>) : undefined} />
                            {editBtn(r, `${itemLabel(it)} ${ITEM_FIELD_LABELS[f]}`)}
                          </span>
                        </div>
                        {isEditing(r) && (
                          <div className="mt-1.5">
                            <FieldEditor booking={b} fref={r} onSave={save} compact />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <Button size="sm" className="no-print" onClick={() => onApply([{ kind: "addItem", values: { sku: `ITEM-${b.nextItemSeq}` } }], "Added a product line", "edit")}>
            + Add product line
          </Button>
          <div className="text-xs text-ink-3">
            Totals: {num(b.items.reduce((s, it) => s + (it.cartons.value ?? 0), 0))} item cartons ·{" "}
            {gbp(b.items.reduce((s, it) => s + (it.quantity.value ?? 0) * (it.unitPrice.value ?? 0), 0))} item value ·{" "}
            {kg(b.items.reduce((s, it) => s + (it.quantity.value ?? 0) * (it.unitWeight.value ?? 0), 0))} product weight
          </div>
        </div>
      </details>
    </Card>
  );
}

export { fieldOf };
