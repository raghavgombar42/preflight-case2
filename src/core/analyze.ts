// Runs everything for one booking: carrier decision, the ten rules, data
// completeness, verdict, advisories, confirmation text, and the fix advisor
// (which simulates each suggested fix to show what it would change).

import { CarrierDecision, decideCarrier } from "./carrier";
import { RuleId, RULES } from "./config";
import { applyPatches } from "./edit";
import { Booking, itemLabel } from "./model";
import { Finding, FixAction, RuleResult, completeness, runRules } from "./rules";
import { addDays, formatDate, gbp, istToday, kg, num } from "./values";

export type Verdict = "blocked" | "incomplete" | "warnings" | "passed";

export type Advisory = { key: string; title: string; detail: string };

export type TimelineStep = { label: string; date: string | null; detail: string };

export type Analysis = {
  booking: Booking;
  today: string;
  carrier: CarrierDecision;
  rules: RuleResult[];
  findings: Finding[]; // red, then amber, then incomplete
  verdict: Verdict;
  verdictLabel: string;
  counts: { red: number; amber: number; incomplete: number };
  advisories: Advisory[];
  summary: string;
  timeline: TimelineStep[];
  estimatedDelivery: string | null;
};

const SEV_ORDER = { red: 0, amber: 1, incomplete: 2 } as const;

function core(b: Booking, today: string) {
  const carrier = decideCarrier(b);
  const rules = runRules(b, { today, carrier });
  const findings = [...rules.flatMap((r) => r.findings), ...completeness(b)].sort(
    (x, y) => SEV_ORDER[x.severity] - SEV_ORDER[y.severity]
  );
  return { carrier, rules, findings };
}

function keysOf(fs: Finding[]) {
  return new Set(fs.map((f) => f.key));
}

const RULE_SHORT = Object.fromEntries(RULES.map((r) => [r.id, r.short])) as Record<RuleId, string>;

export function describeKey(key: string, findings: Finding[]): string {
  const f = findings.find((x) => x.key === key);
  const rule = key.split(":")[0];
  if (rule === "DATA") return f ? f.title : "a missing detail";
  return f ? `${rule} (${f.title})` : `${rule} (${RULE_SHORT[rule as RuleId] ?? ""})`;
}

// Simulate each action and record which findings it resolves or introduces.
function adviseFixes(b: Booking, today: string, findings: Finding[]) {
  const before = keysOf(findings);
  const simulate = (a: FixAction) => {
    const { booking, errors } = applyPatches(b, a.patches, "edited");
    if (errors.length) return;
    const after = keysOf(core(booking, today).findings);
    a.resolves = [...before].filter((k) => !after.has(k));
    a.introduces = [...after].filter((k) => !before.has(k));
  };
  for (const f of findings) for (const a of f.fix.actions) simulate(a);

  // R-03: when exactly one candidate also makes independent evidence agree
  // (e.g. the declared value), mark it as evidence-supported.
  for (const f of findings.filter((x) => x.ruleId === "R-03")) {
    const scored = f.fix.actions.map((a) => ({
      a,
      score: (a.resolves?.length ?? 0) - (a.introduces?.length ?? 0),
      others: (a.resolves ?? []).filter((k) => k !== f.key),
    }));
    const best = Math.max(...scored.map((s) => s.score));
    const top = scored.filter((s) => s.score === best);
    if (top.length === 1 && top[0].others.length > 0) {
      const win = top[0];
      win.a.confidence = "evidence";
      win.a.note = `Also clears ${win.others.map((k) => k.split(":")[0]).join(", ")}: the rest of the booking agrees with this value.`;
      f.fix.confidence = "evidence";
      f.fix.text = `Most likely fix: ${win.a.label.toLowerCase()}. It is the only option consistent with the rest of the booking (it also clears ${win.others
        .map((k) => describeKey(k, findings))
        .join("; ")}). Confirm before applying.`;
      f.fix.actions = [win.a, ...f.fix.actions.filter((x) => x !== win.a)];
    } else {
      f.fix.text = "Correct whichever number is wrong. The rest of the booking doesn't point to one option, so the seller needs to confirm which.";
    }
  }

  // Link symptoms to a likely root cause found elsewhere.
  for (const f of findings) {
    if (f.ruleId === "R-03") continue;
    for (const g of findings) {
      if (g === f || g.ruleId !== "R-03") continue;
      const root = g.fix.actions.find((a) => a.confidence === "evidence" && a.resolves?.includes(f.key));
      if (root) {
        f.fix.text = `Likely root cause: ${g.title} (${g.ruleId}). "${root.label}" fixes this too. Otherwise: ${f.fix.text.charAt(0).toLowerCase()}${f.fix.text.slice(1)}`;
        if (f.fix.confidence === "arithmetic") {
          f.fix.actions.forEach((a) => (a.confidence = "confirm"));
          f.fix.confidence = "confirm";
        }
        f.fix.actions = [{ ...root, id: `${root.id}-via-${f.key}` }, ...f.fix.actions];
        break;
      }
    }
  }
}

const COUNTRY_WORDS = [
  "united kingdom", "uk", "britain", "england", "china", "india", "vietnam", "turkey", "germany", "italy", "france",
  "spain", "portugal", "japan", "korea", "taiwan", "thailand", "bangladesh", "pakistan", "indonesia", "usa",
  "united states", "mexico", "poland", "netherlands", "sri lanka", "cambodia", "malaysia",
];
const COUNTRY_CANON: Record<string, string> = { uk: "United Kingdom", britain: "United Kingdom", england: "United Kingdom", usa: "United States" };

function advisories(b: Booking, rules: RuleResult[]): Advisory[] {
  const out: Advisory[] = [];
  if (b.isTemplateExample) {
    out.push({ key: "template", title: "Template example row", detail: "This is the grey example row from the official template (BK-001). It is checked like any other booking." });
  }
  const r02 = rules.find((r) => r.id === "R-02");
  if (r02?.status === "pass" && b.declaredValue.value !== null && b.items.length) {
    const calc = b.items.reduce((s, it) => s + (it.quantity.value ?? 0) * (it.unitPrice.value ?? 0), 0);
    if (Math.round(calc * 100) !== Math.round(b.declaredValue.value * 100)) {
      out.push({
        key: "value-precision",
        title: "Declared value is close but not exact",
        detail: `Within the rulebook's 1% tolerance, but customs in practice expect the invoice, packing list and declaration to match exactly. Consider declaring ${gbp(calc)}.`,
      });
    }
  }
  for (const it of b.items) {
    const d = (it.description.value ?? "").toLowerCase();
    const origin = it.countryOfOrigin.value;
    if (!d || !origin) continue;
    for (const w of COUNTRY_WORDS) {
      const re = new RegExp(`made in (the )?${w}\\b|\\b${w}[- ]made\\b`);
      if (re.test(d)) {
        const named = COUNTRY_CANON[w] ?? w.replace(/\b\w/g, (c) => c.toUpperCase());
        if (named.toLowerCase() !== origin.toLowerCase()) {
          out.push({
            key: `origin-mismatch:${it.id}`,
            title: `${itemLabel(it)}: description suggests ${named}, origin says ${origin}`,
            detail: "A description that implies a different country of origin is a common customs red flag. Check before shipping.",
          });
        }
        break;
      }
    }
  }
  return out;
}

function verdictOf(counts: Analysis["counts"]): { verdict: Verdict; label: string } {
  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (counts.red) return { verdict: "blocked", label: `Blocked: ${s(counts.red, "issue")} must be fixed before this shipment can go` };
  if (counts.incomplete) return { verdict: "incomplete", label: `Incomplete: ${s(counts.incomplete, "detail")} needed` };
  if (counts.amber) return { verdict: "warnings", label: `Pre-flight checks passed with ${s(counts.amber, "warning")}` };
  return { verdict: "passed", label: "Pre-flight checks passed: ready for booking" };
}

function summaryAndTimeline(b: Booking, carrier: CarrierDecision, verdict: Verdict) {
  const sel = carrier.selected;
  const ready = b.readyDate.value;
  const eta = sel && ready ? addDays(ready, sel.option.transitDays) : null;
  const route = `${b.originCity.value ?? "?"} → ${b.destCity.value ?? "?"}${b.destCountry.value ? `, ${b.destCountry.value}` : ""}`;
  const goods = b.items.length
    ? b.items.map((it) => `${num(it.quantity.value)} × ${it.description.value ?? itemLabel(it)}`).join("; ")
    : "no items yet";
  const parts = [
    `${b.sellerName.value ?? "The seller"} is shipping ${goods} from ${route}${b.destinationType.value ? ` (${b.destinationType.value.toLowerCase()})` : ""}.`,
    `${num(b.pallets.value)} pallet${b.pallets.value === 1 ? "" : "s"}, ${num(b.cartons.value)} cartons, ${kg(b.grossWeight.value)}, declared ${gbp(b.declaredValue.value)}.`,
  ];
  if (sel) parts.push(`Carrier: ${sel.option.carrier} ${sel.option.service}, ${gbp(sel.totalCost, 0)} for ${num(b.pallets.value)} pallet${b.pallets.value === 1 ? "" : "s"}.`);
  if (verdict === "blocked" || verdict === "incomplete") parts.push("This is a provisional summary: the booking becomes ready once the issues above are resolved.");

  const timeline: TimelineStep[] = [];
  if (sel && ready) {
    timeline.push({ label: "Collection", date: ready, detail: `${sel.option.carrier} collects from ${b.originCity.value ?? "the seller"} on the ready-to-ship date.` });
    timeline.push({ label: "UK export clearance", date: ready, detail: "Export declaration lodged using the commercial invoice details checked here." });
    timeline.push({ label: `Transit (${sel.option.transitDays} calendar days)`, date: null, detail: `${sel.option.service}; arrives on the promised day ${sel.option.onTimeRate}% of the time.` });
    timeline.push({ label: `Import clearance (${b.destCountry.value ?? "EU"})`, date: eta, detail: "HS codes, values and origins must match the paperwork." });
    timeline.push({
      label: "Delivery",
      date: eta,
      detail:
        b.destinationType.value === "Warehouse"
          ? `Estimated arrival at the ${b.destCity.value ?? ""} warehouse. The delivery appointment must cover this date.`
          : `Estimated delivery to the business address in ${b.destCity.value ?? "the destination"}.`,
    });
  }
  return { summary: parts.join(" "), timeline, eta };
}

export function analyze(b: Booking, today: string = istToday()): Analysis {
  const { carrier, rules, findings: raw } = core(b, today);
  adviseFixes(b, today, raw);
  // Within a severity, show the likely root cause (evidence-supported fix) first.
  const findings = [...raw].sort(
    (x, y) => SEV_ORDER[x.severity] - SEV_ORDER[y.severity] || Number(y.fix.confidence === "evidence") - Number(x.fix.confidence === "evidence")
  );
  const counts = {
    red: findings.filter((f) => f.severity === "red").length,
    amber: findings.filter((f) => f.severity === "amber").length,
    incomplete: findings.filter((f) => f.severity === "incomplete").length,
  };
  const { verdict, label } = verdictOf(counts);
  const { summary, timeline, eta } = summaryAndTimeline(b, carrier, verdict);
  return {
    booking: b,
    today,
    carrier,
    rules,
    findings,
    verdict,
    verdictLabel: label,
    counts,
    advisories: advisories(b, rules),
    summary,
    timeline,
    estimatedDelivery: eta ? `${formatDate(eta)} (calendar-day estimate)` : null,
  };
}
