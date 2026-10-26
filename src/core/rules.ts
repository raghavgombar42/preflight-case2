// The rulebook (R-01 … R-10) as pure functions, plus a data-completeness
// check. Rules never produce "incomplete" findings themselves: if an input is
// missing they report "cannot check", and the completeness check names the
// missing field. A rule that cannot be checked never counts as a pass.

import {
  R06_CLEAR,
  R06_GENERIC_BATTERY,
  R06_LIKELY_BATTERY,
  R06_NEGATIONS,
  RuleId,
  cityCountry,
  ruleMeta,
} from "./config";
import { CarrierDecision } from "./carrier";
import {
  BOOKING_FIELD_LABELS,
  Booking,
  BookingField,
  FieldRef,
  FieldValue,
  ITEM_FIELD_LABELS,
  Item,
  ItemField,
  Patch,
  itemLabel,
} from "./model";
import { displayRaw, formatDate, gbp, kg, num } from "./values";

export type Confidence = "arithmetic" | "evidence" | "confirm";

export type FixAction = {
  id: string;
  label: string;
  patches: Patch[];
  confidence: Confidence;
  note?: string;
  // filled in by the fix advisor
  resolves?: string[];
  introduces?: string[];
};

export type Finding = {
  key: string; // stable id: rule + item
  ruleId: RuleId | "DATA";
  severity: "red" | "amber" | "incomplete";
  title: string;
  detail: string;
  evidence: Array<{ label: string; value: string }>;
  formula?: string;
  itemId?: string;
  location?: string;
  stage?: string;
  consequence?: string;
  fix: { text: string; confidence: Confidence; actions: FixAction[] };
  fields: FieldRef[];
};

export type RuleStatus = "pass" | "fail" | "na" | "cannot-check";

export type RuleResult = {
  id: RuleId;
  status: RuleStatus;
  summary: string;
  findings: Finding[];
};

export type RuleContext = { today: string; carrier: CarrierDecision };

const bLoc = (b: Booking) => (b.sourceRow ? `Bookings sheet, row ${b.sourceRow}` : undefined);
const iLoc = (it: Item) => (it.sourceRow ? `Items sheet, row ${it.sourceRow}` : undefined);

function finding(
  id: RuleId,
  b: Booking,
  it: Item | null,
  f: Omit<Finding, "key" | "ruleId" | "severity" | "stage" | "consequence" | "itemId" | "location">
): Finding {
  const meta = ruleMeta(id);
  return {
    key: `${id}:${it ? it.id : "booking"}`,
    ruleId: id,
    severity: meta.severity,
    stage: meta.stage,
    consequence: meta.consequence,
    itemId: it?.id,
    location: it ? iLoc(it) : bLoc(b),
    ...f,
  };
}

const result = (id: RuleId, status: RuleStatus, summary: string, findings: Finding[] = []): RuleResult => ({
  id,
  status,
  summary,
  findings,
});

const missingSome = (vals: Array<number | null>) => vals.some((v) => v === null);

// ---------- R-01 ----------
export function r01(b: Booking): RuleResult {
  if (b.items.length === 0) return result("R-01", "cannot-check", "No items to check.");
  const fs: Finding[] = [];
  for (const it of b.items) {
    const hs = it.hsCode;
    const name = itemLabel(it);
    const fields: FieldRef[] = [{ scope: "item", itemId: it.id, field: "hsCode" }];
    const lookup = "Look it up on the UK Trade Tariff (trade-tariff.service.gov.uk).";
    if (hs.status === "missing" || hs.status === "unknown") {
      fs.push(
        finding("R-01", b, it, {
          title: `${name}: HS code missing`,
          detail: hs.status === "unknown" ? "The seller does not know the HS code yet." : "No HS code was given for this product.",
          evidence: [{ label: "HS code", value: "(blank)" }],
          fix: { text: `Add the exact HS code (at least 6 digits) for "${it.description.value ?? name}". ${lookup}`, confidence: "confirm", actions: [] },
          fields,
        })
      );
    } else if (hs.status === "invalid") {
      fs.push(
        finding("R-01", b, it, {
          title: `${name}: HS code is not a valid number`,
          detail: `"${displayRaw(hs.raw)}" ${hs.note ?? "is not a valid HS code"}.`,
          evidence: [{ label: "HS code as given", value: displayRaw(hs.raw) }],
          fix: { text: `Replace it with the numeric HS code (at least 6 digits). ${lookup}`, confidence: "confirm", actions: [] },
          fields,
        })
      );
    } else if ((hs.value ?? "").length < 6) {
      const d = hs.value!;
      const lostZero = d.length === 5;
      fs.push(
        finding("R-01", b, it, {
          title: `${name}: HS code has only ${d.length} digits`,
          detail: lostZero
            ? `"${d}" may be a 6-digit code that lost its leading 0 in Excel (e.g. 0${d}). We don't change it automatically, because it could also simply be wrong.`
            : `"${d}" is shorter than the 6 digits customs need.`,
          evidence: [
            { label: "HS code", value: d },
            { label: "Digits", value: String(d.length) },
          ],
          fix: {
            text: lostZero ? `Confirm the correct code. If it is 0${d}, store the column as text so Excel keeps the leading zero.` : `Enter the full code (6+ digits). ${lookup}`,
            confidence: "confirm",
            actions: lostZero
              ? [{ id: "r01-pad", label: `It is 0${d}`, patches: [{ kind: "item", itemId: it.id, field: "hsCode", value: `0${d}` }], confidence: "confirm" }]
              : [],
          },
          fields,
        })
      );
    }
  }
  if (fs.length) return result("R-01", "fail", `${fs.length} item${fs.length > 1 ? "s" : ""} without a valid 6+ digit HS code.`, fs);
  return result(
    "R-01",
    "pass",
    b.items.length === 1
      ? `${itemLabel(b.items[0])} has a 6+ digit HS code (${b.items[0].hsCode.value}).`
      : `All ${b.items.length} items have a 6+ digit HS code (${b.items.map((i) => i.hsCode.value).join(", ")}).`
  );
}

// ---------- R-02 ----------
export function r02(b: Booking): RuleResult {
  const declared = b.declaredValue.value;
  if (b.items.length === 0) return result("R-02", "cannot-check", "No items to total.");
  const lines = b.items.map((it) => ({ it, q: it.quantity.value, p: it.unitPrice.value }));
  if (declared === null || lines.some((l) => l.q === null || l.p === null)) {
    return result("R-02", "cannot-check", "Needs the declared value and every item's quantity and unit price.");
  }
  const calcP = lines.reduce((s, l) => s + Math.round(l.q! * l.p! * 100), 0); // pence
  const decP = Math.round(declared * 100);
  const calc = calcP / 100;
  const evidence = [
    ...lines.map((l) => ({ label: `${itemLabel(l.it)}`, value: `${num(l.q)} × ${gbp(l.p)} = ${gbp((l.q! * l.p!))}` })),
    { label: "Items total", value: gbp(calc) },
    { label: "Declared value", value: gbp(declared) },
  ];
  const formula = "|declared − Σ(quantity × unit price)| ÷ Σ ≤ 1%";
  if (calcP === 0) {
    if (decP === 0) return result("R-02", "pass", "Declared value and item total are both £0.00.");
    return result("R-02", "fail", "Items total £0.00 but a value is declared.", [
      finding("R-02", b, null, {
        title: `Declared ${gbp(declared)} but the items add up to £0.00`,
        detail: "Every item line is priced at zero, so the declared value cannot be matched.",
        evidence,
        formula,
        fix: { text: "Check the item prices and quantities, or the declared value.", confidence: "confirm", actions: [] },
        fields: [{ scope: "booking", field: "declaredValue" }, ...b.items.map((it) => ({ scope: "item" as const, itemId: it.id, field: "unitPrice" as const }))],
      }),
    ]);
  }
  const diff = Math.abs(decP - calcP);
  const ratio = diff / calcP;
  if (diff * 100 <= calcP) {
    const exact = diff === 0;
    return result(
      "R-02",
      "pass",
      exact
        ? `Declared ${gbp(declared)} = items ${gbp(calc)}.`
        : `Declared ${gbp(declared)} vs items ${gbp(calc)}: ${(ratio * 100).toFixed(2)}% apart, within the 1% tolerance.`
    );
  }
  return result("R-02", "fail", `Declared value is ${(ratio * 100).toFixed(1)}% away from the items total.`, [
    finding("R-02", b, null, {
      title: `Declared ${gbp(declared)}, but the items add up to ${gbp(calc)}`,
      detail: `A ${(ratio * 100).toFixed(1)}% gap (${gbp(diff / 100)}). The rule allows at most 1%.`,
      evidence,
      formula,
      fix: {
        text: `Make the declared value match the items (${gbp(calc)}), unless an item line is wrong.`,
        confidence: "arithmetic",
        actions: [
          {
            id: "r02-set",
            label: `Set declared value to ${gbp(calc)}`,
            patches: [{ kind: "booking", field: "declaredValue", value: calc }],
            confidence: "arithmetic",
            note: "Assumes the item lines are correct.",
          },
        ],
      },
      fields: [{ scope: "booking", field: "declaredValue" }],
    }),
  ]);
}

// ---------- R-03 ----------
export function r03(b: Booking): RuleResult {
  if (b.items.length === 0) return result("R-03", "cannot-check", "No items to check.");
  const fs: Finding[] = [];
  let unchecked = 0;
  for (const it of b.items) {
    const q = it.quantity.value;
    const u = it.unitsPerCarton.value;
    const c = it.cartons.value;
    if (missingSome([q, u, c])) {
      unchecked++;
      continue;
    }
    if (u! * c! === q) continue;
    const name = itemLabel(it);
    const actions: FixAction[] = [
      { id: "r03-qty", label: `Quantity → ${num(u! * c!)}`, patches: [{ kind: "item", itemId: it.id, field: "quantity", value: u! * c! }], confidence: "confirm" },
    ];
    if (q! % u! === 0)
      actions.push({ id: "r03-cartons", label: `Cartons → ${num(q! / u!)}`, patches: [{ kind: "item", itemId: it.id, field: "cartons", value: q! / u! }], confidence: "confirm" });
    if (q! % c! === 0)
      actions.push({ id: "r03-upc", label: `Units per carton → ${num(q! / c!)}`, patches: [{ kind: "item", itemId: it.id, field: "unitsPerCarton", value: q! / c! }], confidence: "confirm" });
    fs.push(
      finding("R-03", b, it, {
        title: `${name}: ${num(u)} per carton × ${num(c)} cartons = ${num(u! * c!)}, not ${num(q)}`,
        detail: `The three numbers for this product don't agree, so one of them is wrong.`,
        evidence: [
          { label: "Quantity", value: num(q) },
          { label: "Units per carton", value: num(u) },
          { label: "Cartons", value: num(c) },
          { label: "Units per carton × cartons", value: num(u! * c!) },
        ],
        formula: "units per carton × cartons = quantity",
        fix: { text: "Correct whichever number is wrong. Each option below shows what else it would fix.", confidence: "confirm", actions },
        fields: [
          { scope: "item", itemId: it.id, field: "quantity" },
          { scope: "item", itemId: it.id, field: "unitsPerCarton" },
          { scope: "item", itemId: it.id, field: "cartons" },
        ],
      })
    );
  }
  if (fs.length) return result("R-03", "fail", `${fs.length} item${fs.length > 1 ? "s" : ""} where units × cartons ≠ quantity.`, fs);
  if (unchecked) return result("R-03", "cannot-check", `${unchecked} item${unchecked > 1 ? "s are" : " is"} missing quantity, units per carton or cartons.`);
  return result("R-03", "pass", b.items.map((it) => `${itemLabel(it)}: ${num(it.unitsPerCarton.value)} × ${num(it.cartons.value)} = ${num(it.quantity.value)}`).join("; ") + ".");
}

// ---------- R-04 ----------
export function r04(b: Booking): RuleResult {
  if (b.items.length === 0) return result("R-04", "cannot-check", "No items to total.");
  const total = b.cartons.value;
  const per = b.items.map((it) => it.cartons.value);
  if (total === null || missingSome(per)) return result("R-04", "cannot-check", "Needs the booking carton total and every item's cartons.");
  const sum = (per as number[]).reduce((s, c) => s + c, 0);
  if (sum === total) return result("R-04", "pass", `Booking ${num(total)} cartons = items ${num(sum)}.`);
  return result("R-04", "fail", `Booking says ${num(total)} cartons; items add up to ${num(sum)}.`, [
    finding("R-04", b, null, {
      title: `Booking says ${num(total)} cartons, but the items add up to ${num(sum)}`,
      detail: `A difference of ${num(Math.abs(total - sum))} carton${Math.abs(total - sum) === 1 ? "" : "s"}.`,
      evidence: [
        ...b.items.map((it) => ({ label: itemLabel(it), value: `${num(it.cartons.value)} cartons` })),
        { label: "Items total", value: `${num(sum)} cartons` },
        { label: "Booking total", value: `${num(total)} cartons` },
      ],
      formula: "booking cartons = Σ item cartons",
      fix: {
        text: `Make the booking total match the items (${num(sum)}), unless an item's carton count is wrong.`,
        confidence: "arithmetic",
        actions: [
          {
            id: "r04-set",
            label: `Set booking cartons to ${num(sum)}`,
            patches: [{ kind: "booking", field: "cartons", value: sum }],
            confidence: "arithmetic",
            note: "Assumes the item carton counts are correct.",
          },
        ],
      },
      fields: [{ scope: "booking", field: "cartons" }],
    }),
  ]);
}

// ---------- R-05 ----------
export function r05(b: Booking, ctx: RuleContext): RuleResult {
  const d = ctx.carrier;
  if (d.status === "missing-inputs") return result("R-05", "cannot-check", d.reason);
  const pp = d.perPallet!;
  const fields: FieldRef[] = [
    { scope: "booking", field: "pallets" },
    { scope: "booking", field: "grossWeight" },
  ];
  const evidence = [
    { label: "Gross weight", value: kg(b.grossWeight.value) },
    { label: "Pallets", value: num(b.pallets.value) },
    { label: "Weight per pallet", value: kg(pp) },
    ...d.options.map((o) => ({ label: `${o.option.carrier} ${o.option.shortName} max`, value: `${kg(o.option.maxKgPerPallet)}${o.eligible ? "" : " ✕"}` })),
  ];
  const formula = "gross weight ÷ pallets ≤ carrier's max weight per pallet";
  const repackActions = (): FixAction[] =>
    d.scenarios.map((s, i) => ({
      id: `r05-repack-${i}`,
      label: `Repack onto ${s.pallets} pallets (${s.service} eligible)`,
      patches: [{ kind: "booking", field: "pallets", value: s.pallets }],
      confidence: "confirm" as const,
      note: "Provisional: assumes total gross weight stays the same. Confirm the new gross weight after repacking.",
    }));

  if (d.status === "no-eligible") {
    return result("R-05", "fail", `${kg(pp)} per pallet exceeds every service's limit.`, [
      finding("R-05", b, null, {
        title: `${kg(pp)} per pallet is too heavy for every service`,
        detail: `No carrier on this route accepts more than 750 kg per pallet. The shipment cannot be collected as packed.`,
        evidence,
        formula,
        fix: { text: "Spread the goods over more pallets, or reduce the weight. Options:", confidence: "confirm", actions: repackActions() },
        fields,
      }),
    ]);
  }
  if (d.chosen && !d.chosen.eligible) {
    const rec = d.options.filter((o) => o.eligible);
    return result("R-05", "fail", `${kg(pp)} per pallet is over the chosen ${d.chosen.option.carrier}'s ${kg(d.chosen.option.maxKgPerPallet)} limit.`, [
      finding("R-05", b, null, {
        title: `${d.chosen.option.carrier} ${d.chosen.option.shortName} can't take ${kg(pp)} pallets`,
        detail: `The seller chose ${d.chosen.option.carrier}, which accepts up to ${kg(d.chosen.option.maxKgPerPallet)} per pallet.`,
        evidence,
        formula,
        fix: {
          text: `Switch to a service that can carry this weight (${rec.map((o) => o.option.shortName).join(" or ")}), or repack onto more pallets.`,
          confidence: "confirm",
          actions: [
            {
              id: "r05-unchoose",
              label: "Use the recommended eligible service",
              patches: [{ kind: "chooseCarrier", carrier: null }],
              confidence: "confirm",
            },
            ...(() => {
              let n = (b.pallets.value ?? 1) + 1;
              while ((b.grossWeight.value ?? 0) / n > d.chosen!.option.maxKgPerPallet) n++;
              return [
                {
                  id: "r05-repack-chosen",
                  label: `Repack onto ${n} pallets to keep ${d.chosen!.option.shortName}`,
                  patches: [{ kind: "booking" as const, field: "pallets" as const, value: n }],
                  confidence: "confirm" as const,
                  note: "Provisional: assumes total gross weight stays the same.",
                },
              ];
            })(),
          ],
        },
        fields,
      }),
    ]);
  }
  if (d.status === "no-priority") {
    const n = d.options.filter((o) => o.eligible).length;
    return result("R-05", "cannot-check", `No carrier selected yet (seller priority missing). ${n} of 3 services can carry ${kg(pp)} per pallet.`);
  }
  const s = d.selected!;
  return result("R-05", "pass", `${kg(pp)} per pallet ≤ ${s.option.carrier} ${s.option.shortName} limit of ${kg(s.option.maxKgPerPallet)}.`);
}

// ---------- R-06 ----------
function stripNegations(text: string): string {
  let t = ` ${text.toLowerCase()} `;
  for (const n of R06_NEGATIONS) t = t.split(n).join(" ");
  return t;
}

function findPhrase(text: string, phrases: string[]): string | null {
  for (const p of phrases) {
    const re = new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    if (re.test(text)) return p;
  }
  return null;
}

export type R06Kind = "lithium" | "aerosol" | "flammable" | "generic-battery" | "likely-battery";

export function r06Match(description: string): { kind: R06Kind; phrase: string } | null {
  const t = stripNegations(description);
  // Empty containers (e.g. "glass perfume bottles, empty") hold no liquid or gas.
  const emptyContainer =
    /(^|[^a-z])empty([^a-z]|$)/i.test(t) && /(^|[^a-z])(bottles?|containers?|cans?|atomi[sz]ers?|vials?|jars?)([^a-z]|$)/i.test(t);
  const kinds = emptyContainer ? (["lithium"] as const) : (["lithium", "aerosol", "flammable"] as const);
  for (const kind of kinds) {
    const p = findPhrase(t, R06_CLEAR[kind]);
    if (p) return { kind, phrase: p };
  }
  const g = findPhrase(t, R06_GENERIC_BATTERY);
  if (g) return { kind: "generic-battery", phrase: g };
  const p = findPhrase(t, R06_LIKELY_BATTERY);
  return p ? { kind: "likely-battery", phrase: p } : null;
}

// Three battery outcomes, all Red: explicit lithium is restricted outright; a
// generic battery or a device that usually has one is blocked until the seller
// confirms it is not lithium.
export function r06(b: Booking): RuleResult {
  if (b.items.length === 0) return result("R-06", "cannot-check", "No items to check.");
  const fs: Finding[] = [];
  let cleared = 0;
  for (const it of b.items) {
    const desc = it.description.value;
    if (!desc) continue;
    const m = r06Match(desc);
    if (!m) continue;
    const confirmable = m.kind === "likely-battery" || m.kind === "generic-battery";
    if (confirmable && b.r06Cleared.includes(it.id)) {
      cleared++;
      continue;
    }
    const name = itemLabel(it);
    const fields: FieldRef[] = [{ scope: "item", itemId: it.id, field: "description" }];
    const evidence = [
      { label: "Description", value: desc },
      { label: "Matched phrase", value: m.phrase },
    ];
    const remove: FixAction = {
      id: "r06-remove",
      label: `Remove ${name} from this shipment`,
      patches: [{ kind: "removeItem", itemId: it.id }],
      confidence: "confirm",
      note: "Book it separately with a dangerous-goods service.",
    };
    if (m.kind === "likely-battery") {
      fs.push(
        finding("R-06", b, it, {
          title: `${name}: likely contains a lithium battery`,
          detail: `"${desc}" matches "${m.phrase}". Devices like this usually have a built-in lithium battery, which carriers reject whether loose or inside a product. Blocked until the seller confirms.`,
          evidence,
          fix: {
            text: "Confirm the item contains no battery, or remove it from this shipment.",
            confidence: "confirm",
            actions: [
              { id: "r06-confirm", label: "Seller confirms: no battery inside", patches: [{ kind: "r06Clear", itemId: it.id }], confidence: "confirm" },
              remove,
            ],
          },
          fields,
        })
      );
      continue;
    }
    if (m.kind === "generic-battery") {
      fs.push(
        finding("R-06", b, it, {
          title: `${name}: battery chemistry must be confirmed`,
          detail: `"${desc}" mentions "${m.phrase}" without saying what kind. This service cannot accept lithium batteries, so the chemistry must be confirmed before the shipment can go.`,
          evidence,
          fix: {
            text: "Confirm the batteries are not lithium (for example alkaline), or remove them from this shipment.",
            confidence: "confirm",
            actions: [
              { id: "r06-confirm", label: "Seller confirms: not lithium", patches: [{ kind: "r06Clear", itemId: it.id }], confidence: "confirm" },
              remove,
            ],
          },
          fields,
        })
      );
      continue;
    }
    const label = { lithium: "lithium battery (restricted dangerous goods)", aerosol: "aerosol", flammable: "flammable liquid" }[m.kind];
    const fixText =
      m.kind === "lithium"
        ? "Lithium batteries can't travel on these standard road services, whether loose or built into a product. Remove the item, or correct the description if it contains no lithium battery."
        : "Not accepted on these standard services. Items like this need a specialist dangerous-goods road service (ADR) with a proper declaration and approved packaging. Remove the item or book it separately.";
    fs.push(
      finding("R-06", b, it, {
        title: `${name}: ${label}`,
        detail: `"${desc}" matches the restricted phrase "${m.phrase}".`,
        evidence: [...evidence, { label: "Category", value: label }],
        fix: { text: fixText, confidence: "confirm", actions: [remove] },
        fields,
      })
    );
  }
  if (fs.length) return result("R-06", "fail", `${fs.length} item${fs.length > 1 ? "s" : ""} flagged as dangerous goods.`, fs);
  return result("R-06", "pass", cleared ? `No dangerous goods (${cleared} battery check${cleared > 1 ? "s" : ""} confirmed by the seller).` : "No lithium batteries, aerosols or flammable liquids in the descriptions.");
}

// ---------- R-07 ----------
export function r07(b: Booking): RuleResult {
  if (b.items.length === 0) return result("R-07", "cannot-check", "No items to weigh.");
  const gross = b.grossWeight.value;
  const lines = b.items.map((it) => ({ it, w: it.unitWeight.value, q: it.quantity.value }));
  if (gross === null || lines.some((l) => l.w === null || l.q === null)) {
    return result("R-07", "cannot-check", "Needs the gross weight and every item's unit weight and quantity.");
  }
  const net = Math.round(lines.reduce((s, l) => s + l.w! * l.q!, 0) * 1000) / 1000;
  if (gross >= net - 1e-9) return result("R-07", "pass", `Gross ${kg(gross)} ≥ product weight ${kg(net)}.`);
  return result("R-07", "fail", `Gross ${kg(gross)} is less than the products alone (${kg(net)}).`, [
    finding("R-07", b, null, {
      title: `Gross weight ${kg(gross)} is lighter than the products themselves (${kg(net)})`,
      detail: "Gross weight must include the goods plus cartons and pallets, so it can't be below the product weight.",
      evidence: [
        ...lines.map((l) => ({ label: itemLabel(l.it), value: `${num(l.q)} × ${kg(l.w)} = ${kg(l.w! * l.q!)}` })),
        { label: "Product weight", value: kg(net) },
        { label: "Declared gross weight", value: kg(gross) },
      ],
      formula: "gross weight ≥ Σ(unit weight × quantity)",
      fix: {
        text: "Re-weigh the shipment including packaging and pallets, or check the unit weights and quantities.",
        confidence: "confirm",
        actions: [],
      },
      fields: [{ scope: "booking", field: "grossWeight" }, ...b.items.map((it) => ({ scope: "item" as const, itemId: it.id, field: "unitWeight" as const }))],
    }),
  ]);
}

// ---------- R-08 ----------
export function r08(b: Booking): RuleResult {
  const t = b.destinationType.value;
  if (t === "Business address") return result("R-08", "na", "Not applicable: delivery to a business address.");
  if (t !== "Warehouse") return result("R-08", "cannot-check", "Needs the destination type.");
  if (b.appointment.value === "Yes") return result("R-08", "pass", "Warehouse delivery with an appointment booked.");
  return result("R-08", "fail", "Warehouse delivery without a booked appointment.", [
    finding("R-08", b, null, {
      title: `No delivery appointment booked at the ${b.destCity.value ?? "destination"} warehouse`,
      detail: b.appointment.value === "No" ? "The booking says no appointment is booked." : "The booking doesn't say whether an appointment is booked.",
      evidence: [
        { label: "Destination type", value: "Warehouse" },
        { label: "Delivery appointment booked", value: b.appointment.value ?? "(blank)" },
      ],
      fix: {
        text: "Book a delivery slot with the receiving warehouse that covers the estimated arrival date.",
        confidence: "confirm",
        actions: [
          { id: "r08-booked", label: "Seller confirms: appointment booked", patches: [{ kind: "booking", field: "appointment", value: "Yes" }], confidence: "confirm" },
        ],
      },
      fields: [{ scope: "booking", field: "appointment" }],
    }),
  ]);
}

// ---------- R-09 ----------
export function r09(b: Booking): RuleResult {
  if (b.items.length === 0) return result("R-09", "cannot-check", "No items to check.");
  const fs: Finding[] = [];
  for (const it of b.items) {
    const o = it.countryOfOrigin;
    if (o.status === "ok") continue;
    const name = itemLabel(it);
    fs.push(
      finding("R-09", b, it, {
        title: o.status === "invalid" ? `${name}: country of origin "${displayRaw(o.raw)}" isn't recognised` : `${name}: country of origin missing`,
        detail: "Enter where the product was made, not where it ships from.",
        evidence: [{ label: "Country of origin", value: displayRaw(o.raw) }],
        fix: { text: "Enter the country where this product was made.", confidence: "confirm", actions: [] },
        fields: [{ scope: "item", itemId: it.id, field: "countryOfOrigin" }],
      })
    );
  }
  if (fs.length) return result("R-09", "fail", `${fs.length} item${fs.length > 1 ? "s" : ""} without a valid country of origin.`, fs);
  return result("R-09", "pass", `Origin stated for all items (${[...new Set(b.items.map((i) => i.countryOfOrigin.value))].join(", ")}).`);
}

// ---------- R-10 ----------
export function r10(b: Booking, ctx: RuleContext): RuleResult {
  const d = b.readyDate.value;
  if (!d) return result("R-10", "cannot-check", "Needs a valid ready-to-ship date.");
  if (d >= ctx.today) return result("R-10", "pass", `Ready ${formatDate(d)}; today is ${formatDate(ctx.today)} (IST).`);
  return result("R-10", "fail", `Ready date ${formatDate(d)} is in the past.`, [
    finding("R-10", b, null, {
      title: `Ready date ${formatDate(d)} has already passed`,
      detail: `Today is ${formatDate(ctx.today)} (IST).`,
      evidence: [
        { label: "Ready to ship", value: formatDate(d) },
        { label: "Today (IST)", value: formatDate(ctx.today) },
      ],
      fix: { text: "Set a new ready-to-ship date (today or later).", confidence: "confirm", actions: [] },
      fields: [{ scope: "booking", field: "readyDate" }],
    }),
  ]);
}

export function runRules(b: Booking, ctx: RuleContext): RuleResult[] {
  return [r01(b), r02(b), r03(b), r04(b), r05(b, ctx), r06(b), r07(b), r08(b), r09(b), r10(b, ctx)];
}

// ---------- data completeness (not a rulebook rule) ----------

const REQUIRED_BOOKING: BookingField[] = [
  "ref",
  "sellerName",
  "originCity",
  "originCountry",
  "destCity",
  "destCountry",
  "destinationType",
  "readyDate",
  "sellerPriority",
  "pallets",
  "cartons",
  "declaredValue",
  "currency",
  "grossWeight",
];
const REQUIRED_ITEM: ItemField[] = ["sku", "description", "quantity", "unitPrice", "unitsPerCarton", "cartons", "unitWeight"];

function dataFinding(key: string, b: Booking, title: string, detail: string, fields: FieldRef[], location?: string): Finding {
  return {
    key: `DATA:${key}`,
    ruleId: "DATA",
    severity: "incomplete",
    title,
    detail,
    evidence: [],
    location: location ?? bLoc(b),
    fix: { text: "Provide or correct this detail.", confidence: "confirm", actions: [] },
    fields,
  };
}

function describe(fv: FieldValue<unknown>): string {
  if (fv.status === "missing") return "is missing";
  if (fv.status === "unknown") return "is not known yet";
  return `"${displayRaw(fv.raw)}" is not valid${fv.note ? ` (${fv.note})` : ""}`;
}

export function completeness(b: Booking): Finding[] {
  const out: Finding[] = [];
  const required = [...REQUIRED_BOOKING];
  if (b.destinationType.value === "Warehouse") required.push("appointment");
  for (const f of required) {
    const fv = b[f] as FieldValue<unknown>;
    if (fv.status === "ok") continue;
    out.push(dataFinding(`booking.${f}`, b, `${BOOKING_FIELD_LABELS[f]} ${describe(fv)}`, "Required to complete the booking.", [{ scope: "booking", field: f }]));
  }
  if (b.destCity.value && b.destCountry.value) {
    const actual = cityCountry(b.destCity.value);
    if (actual && actual !== b.destCountry.value) {
      out.push(
        dataFinding(
          "booking.cityCountry",
          b,
          `${b.destCity.value} is in ${actual}, not ${b.destCountry.value}`,
          "The destination city and country don't match, so the route and rates can't be confirmed.",
          [{ scope: "booking", field: "destCountry" }, { scope: "booking", field: "destCity" }]
        )
      );
    }
  }
  if (b.items.length === 0) {
    out.push(dataFinding("items.none", b, "No items in this booking", "A booking needs at least one product line (Items sheet rows with this Booking ID).", []));
  }
  for (const it of b.items) {
    for (const f of REQUIRED_ITEM) {
      const fv = it[f] as FieldValue<unknown>;
      if (fv.status === "ok") continue;
      if (f === "sku" && b.mode === "chat") continue;
      out.push(
        dataFinding(
          `item.${it.id}.${f}`,
          b,
          `${itemLabel(it)}: ${ITEM_FIELD_LABELS[f].toLowerCase()} ${describe(fv)}`,
          "Required for this product line.",
          [{ scope: "item", itemId: it.id, field: f }],
          iLoc(it)
        )
      );
    }
  }
  if (b.duplicateOfRows && b.duplicateOfRows.length > 1) {
    out.push(
      dataFinding(
        "booking.duplicate",
        b,
        `Booking ID ${b.ref.value} appears more than once`,
        `Rows ${b.duplicateOfRows.join(" and ")} share this ID. Items were matched to the first one, so the IDs need to be made unique.`,
        [{ scope: "booking", field: "ref" }]
      )
    );
  }
  return out;
}
