// Carrier eligibility and recommendation. Eligibility (weight per pallet vs
// the carrier's limit) is decided first; only eligible services are ranked by
// the seller's priority. Nothing is hardcoded: winners are recomputed from the
// rate card every time.

import { CarrierOption, routeOptions } from "./config";
import { Booking, CarrierName } from "./model";
import { gbp, kg } from "./values";

export type Regret = { cost: number; time: number; reliability: number; max: number; total: number };

export type OptionView = {
  option: CarrierOption;
  totalCost: number;
  eligible: boolean;
  ineligibleReason: string | null;
  regret: Regret | null; // only computed for Balanced, over eligible options
  isRecommended: boolean;
  isChosen: boolean;
  versusRecommended: string | null;
};

export type RepackScenario = {
  pallets: number;
  perPallet: number;
  unlocks: CarrierName;
  service: string;
  totalCost: number;
  transitDays: number;
  onTimeRate: number;
  summary: string;
};

export type CarrierDecision = {
  status: "ok" | "no-eligible" | "missing-inputs" | "no-priority";
  missingInputs: string[];
  priority: string | null;
  pallets: number | null;
  perPallet: number | null;
  options: OptionView[];
  recommended: OptionView | null;
  chosen: OptionView | null;
  selected: OptionView | null; // chosen if the seller named one, else recommended
  headline: string;
  reason: string;
  tradeOff: string | null;
  scenarios: RepackScenario[];
};

const DIM_LABEL = { cost: "cost", time: "transit time", reliability: "on-time reliability" } as const;

export function perPalletWeight(gross: number, pallets: number): number {
  return Math.round((gross / pallets) * 100) / 100;
}

export function minimaxRegret(set: Array<{ cost: number; days: number; onTime: number }>): Regret[] {
  const range = (xs: number[]) => [Math.min(...xs), Math.max(...xs)] as const;
  const [cMin, cMax] = range(set.map((s) => s.cost));
  const [dMin, dMax] = range(set.map((s) => s.days));
  const [rMin, rMax] = range(set.map((s) => s.onTime));
  const scale = (v: number, lo: number, hi: number) => (hi === lo ? 0 : (v - lo) / (hi - lo));
  return set.map((s) => {
    const cost = scale(s.cost, cMin, cMax);
    const time = scale(s.days, dMin, dMax);
    const reliability = scale(rMax - s.onTime, 0, rMax - rMin);
    return { cost, time, reliability, max: Math.max(cost, time, reliability), total: cost + time + reliability };
  });
}

type Ranked = { opt: CarrierOption; cost: number; regret: Regret | null };

// Orders candidates best-first for a priority. Tie-breaks are fixed so the
// same input always gives the same answer.
export function rankOptions(opts: CarrierOption[], pallets: number, priority: string): Ranked[] {
  const base = opts.map((opt) => ({ opt, cost: opt.pricePerPallet * pallets, regret: null as Regret | null }));
  const tie = (a: Ranked, b: Ranked) =>
    a.cost - b.cost || a.opt.transitDays - b.opt.transitDays || b.opt.onTimeRate - a.opt.onTimeRate || a.opt.carrier.localeCompare(b.opt.carrier);
  if (priority === "Cheapest") return base.sort(tie);
  if (priority === "Fastest") return base.sort((a, b) => a.opt.transitDays - b.opt.transitDays || tie(a, b));
  if (priority === "Most reliable") return base.sort((a, b) => b.opt.onTimeRate - a.opt.onTimeRate || tie(a, b));
  // Balanced: minimax regret, tie-break on total regret, then the fixed order
  const regrets = minimaxRegret(base.map((x) => ({ cost: x.cost, days: x.opt.transitDays, onTime: x.opt.onTimeRate })));
  base.forEach((x, i) => (x.regret = regrets[i]));
  const eps = 1e-9;
  return base.sort((a, b) => {
    const dm = a.regret!.max - b.regret!.max;
    if (Math.abs(dm) > eps) return dm;
    const dt = a.regret!.total - b.regret!.total;
    if (Math.abs(dt) > eps) return dt;
    return tie(a, b);
  });
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function compare(a: OptionView, rec: OptionView): string {
  const parts: string[] = [];
  const dc = a.totalCost - rec.totalCost;
  if (dc !== 0) parts.push(`${dc > 0 ? "+" : "−"}${gbp(Math.abs(dc), 0)}`);
  const dd = a.option.transitDays - rec.option.transitDays;
  if (dd !== 0) parts.push(`${Math.abs(dd)} day${Math.abs(dd) === 1 ? "" : "s"} ${dd > 0 ? "slower" : "faster"}`);
  const dr = a.option.onTimeRate - rec.option.onTimeRate;
  if (dr !== 0) parts.push(`${dr > 0 ? "+" : "−"}${Math.abs(dr)} pts on-time`);
  return parts.length ? parts.join(" · ") : "same as recommended";
}

function worstDim(r: Regret): keyof typeof DIM_LABEL {
  if (r.cost >= r.time && r.cost >= r.reliability) return "cost";
  if (r.time >= r.reliability) return "time";
  return "reliability";
}

function explain(priority: string, ranked: Ranked[], perPallet: number, eligibleCount: number): string {
  const w = ranked[0];
  const name = `${w.opt.carrier} (${w.opt.shortName})`;
  const pool = eligibleCount === 1 ? "the only service" : `the ${eligibleCount} services`;
  const next = ranked[1];
  if (priority === "Cheapest") {
    const tail = next ? ` Next cheapest: ${next.opt.carrier} at ${gbp(next.cost, 0)} (+${gbp(next.cost - w.cost, 0)}).` : "";
    return `${name} has the lowest total cost of ${pool} that can carry ${kg(perPallet)} per pallet: ${gbp(w.cost, 0)}.${tail}`;
  }
  if (priority === "Fastest") {
    const tail = next ? ` Next fastest: ${next.opt.carrier}, ${next.opt.transitDays} days, ${gbp(Math.abs(w.cost - next.cost), 0)} ${next.cost < w.cost ? "cheaper" : "dearer"}.` : "";
    return `${name} has the shortest transit (${w.opt.transitDays} days) of ${pool} that can carry ${kg(perPallet)} per pallet.${tail}`;
  }
  if (priority === "Most reliable") {
    const tail = next ? ` Next: ${next.opt.carrier} at ${next.opt.onTimeRate}%, ${gbp(Math.abs(w.cost - next.cost), 0)} ${next.cost < w.cost ? "cheaper" : "dearer"}.` : "";
    return `${name} has the highest on-time rate (${w.opt.onTimeRate}%) of ${pool} that can carry ${kg(perPallet)} per pallet.${tail}`;
  }
  if (ranked.length === 1) return `${name} is the only service that can carry ${kg(perPallet)} per pallet, so it is the balanced choice by default.`;
  const own = w.regret!;
  const others = ranked
    .slice(1)
    .map((x) => `${x.opt.shortName} gives up ${pct(x.regret![worstDim(x.regret!)])} on ${DIM_LABEL[worstDim(x.regret!)]}`)
    .join("; ");
  const tieNote =
    ranked[1] && Math.abs(ranked[1].regret!.max - own.max) < 1e-9
      ? " Both options have the same biggest sacrifice, so the one with the smaller total sacrifice wins."
      : "";
  return `Balanced means no big sacrifice on any one dimension. ${name}'s biggest sacrifice is ${pct(own.max)} of the range on ${DIM_LABEL[worstDim(own)]}; ${others}.${tieNote}`;
}

export function decideCarrier(b: Booking): CarrierDecision {
  const missingInputs: string[] = [];
  const dest = b.destCountry.value;
  const pallets = b.pallets.value;
  const gross = b.grossWeight.value;
  const priority = b.sellerPriority.value;
  if (!dest) missingInputs.push("destination");
  if (!pallets) missingInputs.push("pallet count");
  if (gross === null) missingInputs.push("gross weight");

  const empty: CarrierDecision = {
    status: "missing-inputs",
    missingInputs,
    priority,
    pallets,
    perPallet: null,
    options: [],
    recommended: null,
    chosen: null,
    selected: null,
    headline: "Carrier recommendation pending",
    reason: `Needs ${missingInputs.join(", ")} before services can be compared.`,
    tradeOff: null,
    scenarios: [],
  };
  if (!dest || !pallets || gross === null) return empty;

  const pp = perPalletWeight(gross, pallets);
  const opts = routeOptions(dest);
  const views: OptionView[] = opts.map((option) => {
    const eligible = pp <= option.maxKgPerPallet;
    return {
      option,
      totalCost: option.pricePerPallet * pallets,
      eligible,
      ineligibleReason: eligible ? null : `${kg(pp)} per pallet is over its ${kg(option.maxKgPerPallet)} limit`,
      regret: null,
      isRecommended: false,
      isChosen: b.chosenCarrier === option.carrier,
      versusRecommended: null,
    };
  });
  const chosen = views.find((v) => v.isChosen) ?? null;
  const eligibleOpts = views.filter((v) => v.eligible).map((v) => v.option);

  const scenarioFor = (opt: CarrierOption): RepackScenario | null => {
    let n = Math.max(pallets + 1, Math.ceil(gross / opt.maxKgPerPallet));
    while (perPalletWeight(gross, n) > opt.maxKgPerPallet) n += 1;
    return {
      pallets: n,
      perPallet: perPalletWeight(gross, n),
      unlocks: opt.carrier,
      service: opt.shortName,
      totalCost: n * opt.pricePerPallet,
      transitDays: opt.transitDays,
      onTimeRate: opt.onTimeRate,
      summary: `${n} pallets (${kg(perPalletWeight(gross, n))} each) would make ${opt.carrier} ${opt.shortName} eligible: ${gbp(n * opt.pricePerPallet, 0)} total, ${opt.transitDays} days.`,
    };
  };

  if (eligibleOpts.length === 0) {
    const scenarios = opts
      .map(scenarioFor)
      .filter((s): s is RepackScenario => s !== null)
      .sort((a, z) => a.totalCost - z.totalCost);
    return {
      status: "no-eligible",
      missingInputs: [],
      priority,
      pallets,
      perPallet: pp,
      options: views,
      recommended: null,
      chosen,
      selected: chosen,
      headline: "No service can carry this shipment as packed",
      reason: `At ${kg(pp)} per pallet the shipment is over every limit on UK → ${dest} (Economy 500 kg, Standard 750 kg, Express 400 kg).`,
      tradeOff: null,
      scenarios,
    };
  }

  if (!priority) {
    return {
      status: "no-priority",
      missingInputs: ["seller priority"],
      priority,
      pallets,
      perPallet: pp,
      options: views,
      recommended: null,
      chosen,
      selected: chosen,
      headline: "Choose a priority to get a recommendation",
      reason: `${eligibleOpts.length} of 3 services can carry ${kg(pp)} per pallet. A recommendation needs the seller's priority (Cheapest, Fastest, Most reliable or Balanced).`,
      tradeOff: null,
      scenarios: [],
    };
  }

  const ranked = rankOptions(eligibleOpts, pallets, priority);
  for (const r of ranked) {
    const v = views.find((x) => x.option === r.opt)!;
    v.regret = r.regret;
  }
  const rec = views.find((v) => v.option === ranked[0].opt)!;
  rec.isRecommended = true;
  for (const v of views) if (v !== rec && v.eligible) v.versusRecommended = compare(v, rec);

  // Would the seller's priority pick a different service if weight didn't matter?
  let tradeOff: string | null = null;
  const scenarios: RepackScenario[] = [];
  const ideal = rankOptions(opts, pallets, priority)[0].opt;
  if (ideal.carrier !== rec.option.carrier && pp > ideal.maxKgPerPallet) {
    const idealView = views.find((v) => v.option === ideal)!;
    tradeOff = `${ideal.carrier} ${ideal.shortName} would normally win on "${priority}", but it only accepts ${kg(ideal.maxKgPerPallet)} per pallet and these pallets average ${kg(pp)}. ${rec.option.carrier} ${rec.option.shortName} is the best eligible service: ${compare(rec, idealView)} compared with ${ideal.shortName}.`;
    const s = scenarioFor(ideal);
    if (s) scenarios.push(s);
  }

  const headline = `${rec.option.carrier} · ${rec.option.service}`;
  const reason = explain(priority, ranked, pp, eligibleOpts.length);
  return {
    status: "ok",
    missingInputs: [],
    priority,
    pallets,
    perPallet: pp,
    options: views,
    recommended: rec,
    chosen,
    selected: chosen ?? rec,
    headline,
    reason,
    tradeOff,
    scenarios,
  };
}
