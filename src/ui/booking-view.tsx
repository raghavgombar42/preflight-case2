"use client";

import { useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  History,
  Info,
  MapPin,
  Pencil,
  Printer,
  RotateCcw,
  Truck,
  Undo2,
} from "lucide-react";
import type { Analysis } from "@/core/analyze";
import { RULES, ruleMeta, RuleId } from "@/core/config";
import { applyPatches } from "@/core/edit";
import {
  BOOKING_FIELDS,
  BOOKING_FIELD_LABELS,
  Booking,
  FieldRef,
  FieldValue,
  ITEM_FIELDS,
  ITEM_FIELD_LABELS,
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
import { FieldEditor } from "./field-editor";

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

export function BookingView({ ws, analysis, onCommit, onUndo, onReset, onAcknowledge, narrow }: Props) {
  const b = ws.current;
  const a = analysis;
  const applyActions = (patches: Patch[], label: string, source: LogEntry["source"] = "fix") => {
    const { booking, errors } = applyPatches(b, patches, "edited");
    if (errors.length) {
      alert(errors.join("\n"));
      return;
    }
    onCommit(booking, label, source);
  };
  const ambers = a.findings.filter((f) => f.severity === "amber");
  const allAcked = ambers.every((f) => ws.acknowledged.includes(f.key));

  return (
    <div className="space-y-4">
      <Header ws={ws} analysis={a} onUndo={onUndo} onReset={onReset} />
      <VerdictBanner analysis={a} />

      <div className={cx("grid gap-4", !narrow && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
        <div className="min-w-0 space-y-4">
          <FindingsCard analysis={a} ws={ws} onApply={applyActions} onAcknowledge={onAcknowledge} />
          {a.advisories.length > 0 && (
            <Card>
              <CardHead title="Advisories" sub="Beyond the rulebook. These never change the verdict." />
              <ul className="divide-y divide-line">
                {a.advisories.map((x) => (
                  <li key={x.key} className="flex gap-3 px-4 py-3 text-sm">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                    <div>
                      <div className="font-medium text-ink">{x.title}</div>
                      <div className="text-ink-2">{x.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <ChecksCard analysis={a} />
          <BookingDataCard ws={ws} onApply={applyActions} />
        </div>
        <div className="min-w-0 space-y-4">
          <CarrierCard analysis={a} onApply={applyActions} />
          <ConfirmationCard analysis={a} allAcked={allAcked} ambers={ambers.length} />
          {ws.log.length > 0 && <ChangeLogCard log={ws.log} />}
        </div>
      </div>
    </div>
  );
}

function Header({ ws, analysis, onUndo, onReset }: { ws: Workspace; analysis: Analysis; onUndo: () => void; onReset?: () => void }) {
  const b = ws.current;
  const edited = ws.history.length > 0;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{b.ref.value ?? "(no Booking ID)"}</h1>
          <VerdictChip verdict={analysis.verdict} />
          {b.isTemplateExample && <span className="rounded-full bg-grey-soft px-2 py-0.5 text-xs text-ink-3">template example</span>}
          {edited && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs text-amber">edited · {ws.history.length} change{ws.history.length > 1 ? "s" : ""}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
          <span>{b.sellerName.value ?? "Seller not given"}</span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 text-ink-3" />
            {b.originCity.value ?? "?"} <ArrowRight className="h-3 w-3" /> {b.destCity.value ?? "?"}
            {b.destCountry.value ? `, ${b.destCountry.value}` : ""}
          </span>
          {b.destinationType.value && <span>{b.destinationType.value}</span>}
          {b.sellerPriority.value && <span>Priority: {b.sellerPriority.value}</span>}
          {b.sourceRow && <span className="text-ink-3">Bookings row {b.sourceRow}</span>}
        </div>
      </div>
      <div className="no-print flex gap-2">
        <Button size="sm" onClick={onUndo} disabled={!edited} title="Undo the last change">
          <Undo2 className="h-3.5 w-3.5" /> Undo
        </Button>
        {onReset && (
          <Button size="sm" onClick={onReset} disabled={!edited} title="Discard all changes and return to the uploaded data">
            <RotateCcw className="h-3.5 w-3.5" /> Original
          </Button>
        )}
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" /> Print / PDF
        </Button>
      </div>
    </div>
  );
}

function VerdictBanner({ analysis }: { analysis: Analysis }) {
  const s = VERDICT_STYLE[analysis.verdict];
  const c = analysis.counts;
  const sub = {
    blocked: "Red issues stop the shipment. Fix them below; every fix shows what it changes before you apply it.",
    incomplete: "Some required details are missing, so the booking can't be cleared yet.",
    warnings: "Nothing blocks the shipment, but the warnings below should be fixed or acknowledged.",
    passed: "All 10 rulebook checks pass. The booking can be handed to the carrier.",
  }[analysis.verdict];
  return (
    <div className={cx("flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3", s.banner)}>
      {s.icon}
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{analysis.verdictLabel}</div>
        <div className="text-sm opacity-90">{sub}</div>
      </div>
      <div className="flex gap-2 text-xs font-medium">
        <span className="rounded-md bg-white/70 px-2 py-1 text-red">{c.red} red</span>
        <span className="rounded-md bg-white/70 px-2 py-1 text-amber">{c.amber} amber</span>
        <span className="rounded-md bg-white/70 px-2 py-1 text-grey">{c.incomplete} missing</span>
      </div>
    </div>
  );
}

function FindingsCard({
  analysis,
  ws,
  onApply,
  onAcknowledge,
}: {
  analysis: Analysis;
  ws: Workspace;
  onApply: (p: Patch[], label: string) => void;
  onAcknowledge: (key: string, on: boolean) => void;
}) {
  if (analysis.findings.length === 0) {
    return (
      <Card>
        <CardHead title="Issues" />
        <p className="px-4 py-6 text-sm text-ink-2">No issues found. Every rule below passed with the evidence shown.</p>
      </Card>
    );
  }
  return (
    <Card>
      <CardHead title={`Issues (${analysis.findings.length})`} sub="Red first, then amber, then missing details. Each shows the evidence, where it would fail, and how to fix it." />
      <div className="divide-y divide-line">
        {analysis.findings.map((f) => (
          <FindingRow
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

function effectText(a: FixAction): React.ReactNode {
  const res = (a.resolves ?? []).map((k) => k.split(":")[0]);
  const intro = (a.introduces ?? []).map((k) => k.split(":")[0]);
  const uniq = (xs: string[]) => [...new Set(xs)];
  if (!a.resolves) return null;
  return (
    <span className="text-[11px] text-ink-3">
      {res.length ? <span className="text-green">clears {uniq(res).join(", ")}</span> : "clears nothing on its own"}
      {intro.length ? <span className="text-red"> · creates {uniq(intro).join(", ")}</span> : null}
    </span>
  );
}

function FindingRow({
  f,
  booking,
  onApply,
  acked,
  onAcknowledge,
}: {
  f: Finding;
  booking: Booking;
  onApply: (p: Patch[], label: string) => void;
  acked: boolean;
  onAcknowledge: (on: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(f.severity !== "incomplete");
  const edge = { red: "border-l-red", amber: "border-l-amber", incomplete: "border-l-grey-line" }[f.severity];
  return (
    <div className={cx("border-l-4 px-4 py-3", edge)}>
      <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(!open)}>
        <div className="flex shrink-0 flex-col gap-1 pt-0.5 sm:flex-row">
          <SeverityChip severity={f.severity} />
          <RuleChip id={f.ruleId} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">{f.title}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-3">
            {f.location && <span>{f.location}</span>}
            {f.stage && (
              <span>
                Would fail at: <span className="font-medium text-ink-2">{f.stage}</span>
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={cx("mt-1 h-4 w-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-3 space-y-3 pl-0 sm:pl-[7.5rem]">
          <p className="text-sm text-ink-2">{f.detail}</p>
          {f.consequence && <p className="text-xs text-ink-3">Why it matters: {f.consequence}</p>}

          {f.evidence.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {f.evidence.map((e, i) => (
                    <tr key={i}>
                      <td className="w-1/2 bg-canvas/60 px-3 py-1.5 text-ink-3">{e.label}</td>
                      <td className="px-3 py-1.5 font-medium tnum text-ink">{e.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {f.formula && <div className="border-t border-line bg-canvas/60 px-3 py-1.5 font-mono text-[11px] text-ink-3">{f.formula}</div>}
            </div>
          )}

          <div className="rounded-lg border border-line bg-white p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">How to fix</span>
              <ConfidenceChip c={f.fix.confidence} />
            </div>
            <p className="text-sm text-ink">{f.fix.text}</p>
            {(f.fix.actions.length > 0 || f.fields.length > 0) && (
              <div className="no-print mt-3 flex flex-wrap gap-2">
                {f.fix.actions.map((a) => (
                  <div key={a.id} className="flex flex-col gap-0.5">
                    <Button size="sm" variant={a.confidence === "confirm" ? "secondary" : "primary"} onClick={() => onApply(a.patches, `${f.ruleId === "DATA" ? "Data" : f.ruleId}: ${a.label}`)}>
                      {a.label}
                    </Button>
                    <div className="px-1">{effectText(a)}</div>
                    {a.note && <div className="max-w-xs px-1 text-[11px] text-ink-3">{a.note}</div>}
                  </div>
                ))}
                {f.fields.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
                    <Pencil className="h-3.5 w-3.5" /> {editing ? "Close editor" : "Edit value"}
                  </Button>
                )}
              </div>
            )}
            {editing && (
              <div className="no-print mt-3 grid gap-2 sm:grid-cols-2">
                {f.fields.map((r: FieldRef) => (
                  <FieldEditor
                    key={`${r.scope}-${"itemId" in r ? r.itemId : ""}-${r.field}`}
                    booking={booking}
                    fref={r}
                    onSave={(p, label) => {
                      onApply([p], label);
                      setEditing(false);
                    }}
                  />
                ))}
              </div>
            )}
            {f.severity === "amber" && (
              <label className="no-print mt-3 flex items-center gap-2 text-xs text-ink-2">
                <input type="checkbox" checked={acked} onChange={(e) => onAcknowledge(e.target.checked)} className="h-3.5 w-3.5 accent-amber" />
                Seller acknowledges this warning
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChecksCard({ analysis }: { analysis: Analysis }) {
  return (
    <Card>
      <CardHead title="All 10 rulebook checks" sub="Every rule is evaluated for every booking. Passes show the numbers they were checked against." />
      <ul className="divide-y divide-line">
        {analysis.rules.map((r) => {
          const m = ruleMeta(r.id as RuleId);
          return (
            <li key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-4 py-2.5 text-sm sm:grid-cols-[auto_200px_minmax(0,1fr)]">
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
    </Card>
  );
}

function CarrierCard({ analysis, onApply }: { analysis: Analysis; onApply: (p: Patch[], label: string, source?: LogEntry["source"]) => void }) {
  const d = analysis.carrier;
  return (
    <Card>
      <CardHead
        title="Carrier recommendation"
        sub={d.priority ? `Seller priority: ${d.priority}${d.perPallet !== null ? ` · ${kg(d.perPallet)} per pallet` : ""}` : d.perPallet !== null ? `${kg(d.perPallet)} per pallet` : undefined}
      />
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", d.recommended ? "bg-brand-soft text-brand" : "bg-grey-soft text-grey")}>
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-ink">{d.headline}</div>
            {d.recommended && (
              <div className="text-sm tnum text-ink-2">
                {gbp(d.recommended.totalCost, 0)} total · {d.recommended.option.transitDays} days · {d.recommended.option.onTimeRate}% on-time
              </div>
            )}
            {analysis.verdict === "blocked" && d.recommended && <div className="mt-0.5 text-xs text-amber">Provisional: becomes valid once blocking issues are fixed.</div>}
          </div>
        </div>
        <p className="text-sm text-ink-2">{d.reason}</p>

        {d.chosen && (
          <div className="rounded-lg border border-line bg-canvas p-2 text-xs text-ink-2">
            The seller chose <span className="font-medium">{d.chosen.option.carrier} {d.chosen.option.shortName}</span>
            {d.recommended && d.recommended !== d.chosen ? `; for "${d.priority}" we would recommend ${d.recommended.option.carrier} ${d.recommended.option.shortName}.` : "."}
            <button className="no-print ml-2 font-medium text-brand underline" onClick={() => onApply([{ kind: "chooseCarrier", carrier: null }], "Carrier choice cleared")}>
              Use recommendation
            </button>
          </div>
        )}

        {d.options.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-line">
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
                        {o.isRecommended ? "Recommended" : o.eligible ? o.versusRecommended ?? "Eligible" : o.ineligibleReason}
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
        )}

        {d.tradeOff && (
          <div className="rounded-lg border border-amber-line bg-amber-soft/60 p-3 text-xs text-ink-2">
            <div className="mb-0.5 font-semibold text-amber">Trade-off notice (not a violation)</div>
            {d.tradeOff}
          </div>
        )}

        {d.scenarios.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Repacking scenarios · provisional</div>
            {d.scenarios.map((s) => (
              <div key={`${s.pallets}-${s.unlocks}`} className="rounded-lg border border-dashed border-grey-line p-2.5 text-xs text-ink-2">
                <div>{s.summary}</div>
                <div className="mt-1 text-[11px] text-ink-3">Assumes the total gross weight stays the same; confirm the new weight after repacking.</div>
                <Button
                  size="sm"
                  className="no-print mt-2"
                  onClick={() => onApply([{ kind: "booking", field: "pallets", value: s.pallets }], `Repacked onto ${s.pallets} pallets (scenario)`, "scenario")}
                >
                  Seller approves: repack onto {s.pallets} pallets
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function ConfirmationCard({ analysis, allAcked, ambers }: { analysis: Analysis; allAcked: boolean; ambers: number }) {
  const v = analysis.verdict;
  const title =
    v === "passed"
      ? "Pre-flight checks passed: ready for booking"
      : v === "warnings"
        ? allAcked
          ? `Ready for booking · ${ambers} warning${ambers > 1 ? "s" : ""} acknowledged`
          : "Ready for booking once warnings are acknowledged"
        : "Not ready yet (provisional summary)";
  return (
    <Card>
      <CardHead title="Confirmation & next steps" sub="What the seller sees. This MVP does not place the order with the carrier." />
      <div className="space-y-3 p-4">
        <div className={cx("rounded-lg px-3 py-2 text-sm font-semibold", VERDICT_STYLE[v].banner, "border")}>{title}</div>
        <p className="text-sm text-ink-2">{analysis.summary}</p>
        {analysis.estimatedDelivery && (
          <div className="flex items-center gap-2 text-sm">
            <CalendarClock className="h-4 w-4 text-ink-3" />
            <span>
              Estimated delivery: <span className="font-medium">{analysis.estimatedDelivery}</span>
            </span>
          </div>
        )}
        {analysis.timeline.length > 0 && (
          <ol className="relative ml-2 space-y-3 border-l border-line pl-4">
            {analysis.timeline.map((s, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand" />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-ink">{s.label}</span>
                  {s.date && <span className="text-xs tnum text-ink-3">{formatDate(s.date)}</span>}
                </div>
                <div className="text-xs text-ink-2">{s.detail}</div>
              </li>
            ))}
          </ol>
        )}
        {analysis.timeline.length > 0 && (
          <p className="text-[11px] text-ink-3">Dates are calendar-day estimates from the rate card's transit times, not guaranteed arrival dates.</p>
        )}
      </div>
    </Card>
  );
}

function ChangeLogCard({ log }: { log: LogEntry[] }) {
  return (
    <Card>
      <CardHead title="Change log" sub="Every change, and what it did to the checks." right={<History className="h-4 w-4 text-ink-3" />} />
      <ol className="max-h-[420px] divide-y divide-line overflow-y-auto">
        {log.map((e, i) => (
          <li key={i} className="space-y-1 px-4 py-3 text-xs">
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
                <VerdictChip verdict={e.verdictBefore} /> <ArrowRight className="h-3 w-3" /> <VerdictChip verdict={e.verdictAfter} />
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

function BookingDataCard({ ws, onApply }: { ws: Workspace; onApply: (p: Patch[], label: string, source?: LogEntry["source"]) => void }) {
  const [open, setOpen] = useState(ws.current.mode === "chat");
  const [edit, setEdit] = useState<FieldRef | null>(null);
  const b = ws.current;
  const o = ws.original;
  const save = (p: Patch, label: string) => {
    onApply([p], label, "edit");
    setEdit(null);
  };
  const isEditing = (r: FieldRef) =>
    edit && edit.field === r.field && edit.scope === r.scope && (r.scope === "booking" || (edit.scope === "item" && edit.itemId === r.itemId));

  return (
    <Card>
      <button className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setOpen(!open)}>
        <div>
          <h2 className="text-sm font-semibold">Booking data</h2>
          <p className="text-xs text-ink-3">
            All fields as {b.mode === "upload" ? "uploaded" : "collected"}, with any edits. The original upload is never changed.
          </p>
        </div>
        <ChevronDown className={cx("h-4 w-4 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-line p-4">
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {BOOKING_FIELDS.map((f) => {
              const r: FieldRef = { scope: "booking", field: f };
              const fv = b[f] as FieldValue<unknown>;
              return (
                <div key={f} className="border-b border-line/70 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-3">{BOOKING_FIELD_LABELS[f]}</span>
                    <span className="flex items-center gap-2 text-right">
                      <ValueCell fv={fv} was={b.mode === "upload" ? (o[f] as FieldValue<unknown>) : undefined} />
                      {f !== "ref" && (
                        <button className="no-print text-ink-3 hover:text-brand" onClick={() => setEdit(isEditing(r) ? null : r)} aria-label={`Edit ${BOOKING_FIELD_LABELS[f]}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
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
                    <button
                      className="no-print font-medium text-red hover:underline"
                      onClick={() => onApply([{ kind: "removeItem", itemId: it.id }], `Removed ${itemLabel(it)}`, "edit")}
                    >
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
                            <button className="no-print text-ink-3 hover:text-brand" onClick={() => setEdit(isEditing(r) ? null : r)} aria-label={`Edit ${ITEM_FIELD_LABELS[f]}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
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
          <Button
            size="sm"
            className="no-print"
            onClick={() => onApply([{ kind: "addItem", values: { sku: `ITEM-${b.nextItemSeq}` } }], "Added a product line", "edit")}
          >
            + Add product line
          </Button>
          <div className="text-xs text-ink-3">
            Totals: {num(b.items.reduce((s, it) => s + (it.cartons.value ?? 0), 0))} item cartons ·{" "}
            {gbp(b.items.reduce((s, it) => s + (it.quantity.value ?? 0) * (it.unitPrice.value ?? 0), 0))} item value ·{" "}
            {kg(b.items.reduce((s, it) => s + (it.quantity.value ?? 0) * (it.unitWeight.value ?? 0), 0))} product weight
          </div>
        </div>
      )}
    </Card>
  );
}

export const RULE_LIST = RULES;
