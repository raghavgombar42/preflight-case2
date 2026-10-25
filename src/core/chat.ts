// Conversational booking. The language model only proposes structured edits;
// this module validates and applies them, decides what is still missing and
// what to ask next. A deterministic parser covers common answers when the
// model is unavailable.

import {
  ALL_DEST_CITIES,
  DESTINATION_TYPES,
  ITEM_ORIGINS,
  ORIGIN_CITIES,
  SELLER_PRIORITIES,
} from "./config";
import { applyPatch, cloneBooking } from "./edit";
import {
  BOOKING_FIELDS,
  Booking,
  BookingField,
  CarrierName,
  FieldValue,
  ITEM_FIELDS,
  ItemField,
  Patch,
  itemLabel,
} from "./model";
import { addDays, normEnum } from "./values";

export const CHAT_OPS = [
  "set_field",
  "adjust_number",
  "add_item",
  "update_item",
  "remove_item",
  "mark_unknown",
  "choose_carrier",
  "confirm_no_battery",
  "clarify",
] as const;

export type ChatEdit = {
  op: (typeof CHAT_OPS)[number];
  field?: string | null;
  value?: string | number | null;
  delta?: number | null;
  itemId?: string | null;
  item?: Partial<Record<ItemField, string | number | null>> | null;
  carrier?: string | null;
  question?: string | null;
};

export type ApplyOutcome = {
  booking: Booking;
  applied: string[];
  rejected: string[];
  clarifications: string[];
};

const SETTABLE: BookingField[] = BOOKING_FIELDS.filter((f) => f !== "ref" && f !== "originCountry" && f !== "currency");
const ADJUSTABLE: BookingField[] = ["pallets", "grossWeight", "cartons", "declaredValue"];
const FIELD_WORDS: Record<string, string> = {
  sellerName: "seller name",
  originCity: "pickup city",
  destCity: "destination city",
  destCountry: "destination country",
  destinationType: "destination type",
  readyDate: "ready-to-ship date",
  sellerPriority: "priority",
  pallets: "pallets",
  cartons: "total cartons",
  declaredValue: "declared value",
  grossWeight: "gross weight",
  appointment: "delivery appointment",
  sku: "SKU",
  description: "description",
  hsCode: "HS code",
  quantity: "quantity",
  unitPrice: "unit price",
  unitsPerCarton: "units per carton",
  unitWeight: "unit weight",
  countryOfOrigin: "country of origin",
};

function markUnknown(b: Booking, field: string, itemId?: string | null): Booking | null {
  const c = cloneBooking(b);
  const unknown: FieldValue<unknown> = { raw: null, value: null, status: "unknown", source: "chat" };
  if (itemId) {
    const it = c.items.find((x) => x.id === itemId);
    if (!it || !(ITEM_FIELDS as readonly string[]).includes(field)) return null;
    (it as unknown as Record<string, FieldValue<unknown>>)[field] = unknown;
  } else {
    if (!(SETTABLE as string[]).includes(field)) return null;
    (c as unknown as Record<string, FieldValue<unknown>>)[field] = unknown;
  }
  return c;
}

export function applyChatEdits(input: Booking, edits: ChatEdit[]): ApplyOutcome {
  let b = input;
  const applied: string[] = [];
  const rejected: string[] = [];
  const clarifications: string[] = [];
  let lastAdded: string | null = null;
  // The model can't know the id of an item it adds in the same message, so
  // an unknown id falls back to the item just added (or the only item).
  const resolveItem = (id?: string | null) =>
    b.items.find((x) => x.id === id) ?? b.items.find((x) => x.id === lastAdded) ?? (b.items.length === 1 ? b.items[0] : undefined);
  const tryPatch = (p: Patch, desc: string) => {
    const r = applyPatch(b, p, "chat");
    if (r.ok) {
      b = r.booking;
      applied.push(desc);
    } else rejected.push(r.error ?? desc);
  };

  for (const e of edits.slice(0, 40)) {
    switch (e.op) {
      case "set_field": {
        const f = e.field as BookingField;
        if (!f || !(SETTABLE as string[]).includes(f)) break;
        if (f === "destCity" && e.value && !normEnum(e.value, ALL_DEST_CITIES)) {
          rejected.push(`We don't deliver to "${e.value}". Destinations: ${ALL_DEST_CITIES.join(", ")}.`);
          break;
        }
        if (f === "originCity" && e.value && !normEnum(e.value, ORIGIN_CITIES)) {
          rejected.push(`Pickups are only from ${ORIGIN_CITIES.join(", ")} ("${e.value}" isn't one of them).`);
          break;
        }
        tryPatch({ kind: "booking", field: f, value: e.value ?? null }, `${FIELD_WORDS[f] ?? f} → ${e.value}`);
        break;
      }
      case "adjust_number": {
        const f = e.field as BookingField;
        if (!f || !ADJUSTABLE.includes(f) || typeof e.delta !== "number" || !Number.isFinite(e.delta)) break;
        const cur = (b[f] as FieldValue<number>).value;
        if (cur === null) {
          rejected.push(`I don't have a current ${FIELD_WORDS[f]} yet, so I can't add to it. What is the total?`);
          break;
        }
        const next = Math.round((cur + e.delta) * 100) / 100;
        tryPatch({ kind: "booking", field: f, value: next }, `${FIELD_WORDS[f]} ${cur} → ${next}`);
        break;
      }
      case "add_item": {
        const values: Partial<Record<ItemField, unknown>> = {};
        for (const k of ITEM_FIELDS) if (e.item && e.item[k] !== undefined) values[k] = e.item[k];
        if (!values.sku) values.sku = `ITEM-${b.nextItemSeq}`;
        tryPatch({ kind: "addItem", values }, `added ${values.description ?? values.sku}`);
        lastAdded = b.items[b.items.length - 1]?.id ?? null;
        break;
      }
      case "update_item": {
        const it = resolveItem(e.itemId);
        const f = e.field as ItemField;
        if (!it) {
          rejected.push("I couldn't tell which product you meant.");
          break;
        }
        if (!f || !(ITEM_FIELDS as readonly string[]).includes(f)) break;
        tryPatch({ kind: "item", itemId: it.id, field: f, value: e.value ?? null }, `${itemLabel(it)} ${FIELD_WORDS[f]} → ${e.value}`);
        break;
      }
      case "remove_item": {
        const it = b.items.find((x) => x.id === e.itemId);
        if (it) tryPatch({ kind: "removeItem", itemId: it.id }, `removed ${itemLabel(it)}`);
        break;
      }
      case "mark_unknown": {
        if (!e.field) break;
        const isItemField = (ITEM_FIELDS as readonly string[]).includes(e.field);
        const nb = markUnknown(b, e.field, isItemField ? resolveItem(e.itemId)?.id : null);
        if (nb) {
          b = nb;
          applied.push(`${FIELD_WORDS[e.field] ?? e.field} marked as unknown`);
        }
        break;
      }
      case "choose_carrier": {
        const c = e.carrier ?? null;
        if (c !== null && !["Carrier A", "Carrier B", "Carrier C"].includes(c)) break;
        tryPatch({ kind: "chooseCarrier", carrier: c as CarrierName | null }, c ? `carrier chosen: ${c}` : "carrier choice cleared");
        break;
      }
      case "confirm_no_battery": {
        const it = resolveItem(e.itemId);
        if (it) tryPatch({ kind: "r06Clear", itemId: it.id }, `${itemLabel(it)}: no battery confirmed`);
        break;
      }
      case "clarify": {
        if (e.question) clarifications.push(String(e.question).slice(0, 300));
        break;
      }
    }
  }
  return { booking: b, applied, rejected, clarifications };
}

// ---------- what to ask next ----------

export type Question = { key: string; group: string; text: string; options?: readonly string[] };

const missingish = (fv: FieldValue<unknown>) => fv.status === "missing" || fv.status === "invalid";

export function missingQuestions(b: Booking): Question[] {
  const q: Question[] = [];
  if (missingish(b.originCity)) q.push({ key: "originCity", group: "route", text: "which UK city it's collected from", options: ORIGIN_CITIES });
  if (missingish(b.destCity)) q.push({ key: "destCity", group: "route", text: "the destination city", options: ALL_DEST_CITIES });
  if (missingish(b.destinationType)) q.push({ key: "destinationType", group: "route", text: "whether it's going to a warehouse or a business address", options: DESTINATION_TYPES });
  if (b.items.length === 0) {
    q.push({ key: "items", group: "items", text: "what you're shipping: for each product, the quantity, unit price, units per carton and weight per unit" });
  }
  for (const it of b.items) {
    const need = (["description", "quantity", "unitPrice", "unitsPerCarton", "unitWeight", "hsCode", "countryOfOrigin"] as ItemField[]).filter((f) =>
      missingish(it[f] as FieldValue<unknown>)
    );
    if (need.length) {
      q.push({
        key: `item:${it.id}`,
        group: `item:${it.id}`,
        text: `for ${it.description.value ?? itemLabel(it)}: ${need.map((f) => FIELD_WORDS[f]).join(", ")}`,
        options: need.length === 1 && need[0] === "countryOfOrigin" ? ITEM_ORIGINS : undefined,
      });
    }
  }
  if (missingish(b.pallets)) q.push({ key: "pallets", group: "load", text: "how many pallets" });
  if (missingish(b.grossWeight)) q.push({ key: "grossWeight", group: "load", text: "the total gross weight in kg (goods + cartons + pallets)" });
  if (missingish(b.readyDate)) q.push({ key: "readyDate", group: "plan", text: "the date the goods are ready for collection" });
  if (missingish(b.sellerPriority)) q.push({ key: "sellerPriority", group: "plan", text: "what matters most: cheapest, fastest, most reliable or balanced", options: SELLER_PRIORITIES });
  if (b.destinationType.value === "Warehouse" && missingish(b.appointment)) {
    q.push({ key: "appointment", group: "plan", text: "whether a delivery appointment is booked at the warehouse", options: ["Yes", "No"] });
  }
  if (missingish(b.sellerName)) q.push({ key: "sellerName", group: "plan", text: "the seller's business name" });
  return q;
}

// Ask at most three related things at once.
export function nextAsk(b: Booking): { keys: string[]; text: string } | null {
  const qs = missingQuestions(b);
  if (!qs.length) return null;
  const group = qs[0].group;
  const batch = qs.filter((x) => x.group === group).slice(0, 3);
  const texts = batch.map((x) => x.text);
  const joined = texts.length === 1 ? texts[0] : `${texts.slice(0, -1).join("; ")}; and ${texts[texts.length - 1]}`;
  if (group.startsWith("item:")) {
    const body = joined.replace(/^for /, "");
    const cut = body.indexOf(": ");
    const name = body.slice(0, cut);
    const list = body.slice(cut + 2);
    return { keys: batch.map((x) => x.key), text: `For the ${name}, I still need the ${list}.` };
  }
  return { keys: batch.map((x) => x.key), text: `Could you tell me ${joined}?` };
}

// ---------- deterministic fallback parser ----------

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function resolveRelativeDate(text: string, today: string): string | null {
  const t = text.toLowerCase();
  if (/\btoday\b/.test(t)) return today;
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const wd = t.match(/\b(next|this|on)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[2]);
    // "Friday" / "next Friday" both mean the coming Friday (never today)
    let delta = (target - dow + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(today, delta);
  }
  const inDays = t.match(/\bin (\d+|a|one|two|three|four|five|six|seven|ten) (day|week)s?\b/);
  if (inDays) {
    const n = WORD_NUM[inDays[1]] ?? Number(inDays[1]);
    return addDays(today, inDays[2] === "week" ? n * 7 : n);
  }
  const dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/);
  if (dm) {
    const mo = MONTHS.indexOf(dm[2]) + 1;
    let yr = dm[3] ? Number(dm[3]) : y;
    const iso = `${yr}-${String(mo).padStart(2, "0")}-${String(Number(dm[1])).padStart(2, "0")}`;
    if (!dm[3] && iso < today) yr += 1;
    return `${yr}-${String(mo).padStart(2, "0")}-${String(Number(dm[1])).padStart(2, "0")}`;
  }
  const dmy = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

export function parseLocally(message: string, b: Booking, asked: string[], today: string): ChatEdit[] {
  const t = ` ${message.toLowerCase().replace(/[,]/g, " ")} `;
  const edits: ChatEdit[] = [];
  const has = (k: string) => asked.includes(k);

  const adj = t.match(/\b(add|another|one more|plus|remove|take off|minus|drop)\b[^.]*?\b(a|an|one|two|three|\d+)?\s*(more\s+)?pallets?\b/);
  if (adj) {
    const n = adj[2] ? WORD_NUM[adj[2]] ?? Number(adj[2]) : 1;
    const sign = /remove|take off|minus|drop/.test(adj[1]) ? -1 : 1;
    edits.push({ op: "adjust_number", field: "pallets", delta: sign * n });
  } else {
    const pal = t.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+pallets?\b/);
    if (pal) edits.push({ op: "set_field", field: "pallets", value: WORD_NUM[pal[1]] ?? Number(pal[1]) });
    else if (has("pallets") && /^\s*\d+\s*$/.test(message)) edits.push({ op: "set_field", field: "pallets", value: Number(message.trim()) });
  }

  const tonne = t.match(/\b(half a|a|one|two|\d+(?:\.\d+)?)\s*(tonnes?|tons?)\b/);
  const kgM = t.match(/\b(\d+(?:\.\d+)?)\s*(kg|kgs|kilos?|kilograms?)\b/);
  if (tonne) {
    const n = tonne[1] === "half a" ? 0.5 : WORD_NUM[tonne[1]] ?? Number(tonne[1]);
    edits.push({ op: "set_field", field: "grossWeight", value: n * 1000 });
  } else if (kgM && (has("grossWeight") || /gross|total|weigh/.test(t))) {
    edits.push({ op: "set_field", field: "grossWeight", value: Number(kgM[1]) });
  } else if (has("grossWeight") && /^\s*\d+(\.\d+)?\s*$/.test(message)) {
    edits.push({ op: "set_field", field: "grossWeight", value: Number(message.trim()) });
  }

  for (const c of ALL_DEST_CITIES) if (new RegExp(`\\b${c.toLowerCase()}\\b`).test(t)) edits.push({ op: "set_field", field: "destCity", value: c });
  for (const c of ORIGIN_CITIES) if (new RegExp(`\\b${c.toLowerCase()}\\b`).test(t)) edits.push({ op: "set_field", field: "originCity", value: c });
  if (/\bwarehouse|fulfil?ment|amazon\b/.test(t)) edits.push({ op: "set_field", field: "destinationType", value: "Warehouse" });
  else if (/\bbusiness address|shop|office|store\b/.test(t)) edits.push({ op: "set_field", field: "destinationType", value: "Business address" });

  const pr = t.match(/\b(cheapest|fastest|most reliable|reliable|balanced)\b/);
  if (pr) edits.push({ op: "set_field", field: "sellerPriority", value: normEnum(pr[1], SELLER_PRIORITIES) ?? pr[1] });

  if (has("appointment")) {
    if (/\b(yes|yep|booked|done|we have)\b/.test(t)) edits.push({ op: "set_field", field: "appointment", value: "Yes" });
    else if (/\b(no|not yet|nope|haven't)\b/.test(t)) edits.push({ op: "set_field", field: "appointment", value: "No" });
  }

  if (has("readyDate") || /\bready|collect|pick ?up|ship(ping)? on\b/.test(t)) {
    const d = resolveRelativeDate(t, today);
    if (d) edits.push({ op: "set_field", field: "readyDate", value: d });
  }

  if (has("sellerName") && edits.length === 0 && message.trim().length <= 80) {
    edits.push({ op: "set_field", field: "sellerName", value: message.trim() });
  }

  const itemKey = asked.find((k) => k.startsWith("item:"));
  if (itemKey) {
    const itemId = itemKey.slice(5);
    const hs = t.match(/\b(?:hs(?: code)?\s*(?:is|:)?\s*)?(\d{6,10})\b/);
    if (hs) edits.push({ op: "update_item", itemId, field: "hsCode", value: hs[1] });
    if (/don'?t know|not sure|no idea/.test(t) && /\bhs\b/.test(t)) edits.push({ op: "mark_unknown", itemId, field: "hsCode" });
    for (const o of ITEM_ORIGINS) if (new RegExp(`\\b${o.toLowerCase()}\\b`).test(t)) edits.push({ op: "update_item", itemId, field: "countryOfOrigin", value: o });
    const price = t.match(/£\s*(\d+(?:\.\d+)?)/);
    if (price) edits.push({ op: "update_item", itemId, field: "unitPrice", value: Number(price[1]) });
    const upc = t.match(/\b(\d+)\s*(?:per|a|\/)\s*(?:carton|box|case)\b/);
    if (upc) edits.push({ op: "update_item", itemId, field: "unitsPerCarton", value: Number(upc[1]) });
    const uw = t.match(/\b(\d+(?:\.\d+)?)\s*(kg|g)\s*(?:each|per unit|a unit|per item)\b/);
    if (uw) edits.push({ op: "update_item", itemId, field: "unitWeight", value: uw[2] === "g" ? Number(uw[1]) / 1000 : Number(uw[1]) });
    const qty = t.match(/\b(\d+)\s*(?:units|pcs|pieces|items)\b/);
    if (qty) edits.push({ op: "update_item", itemId, field: "quantity", value: Number(qty[1]) });
  }
  return edits;
}

export function compactBookingForModel(b: Booking) {
  const v = <T>(f: FieldValue<T>) => (f.status === "unknown" ? "UNKNOWN" : f.value);
  return {
    sellerName: v(b.sellerName),
    originCity: v(b.originCity),
    destCity: v(b.destCity),
    destCountry: v(b.destCountry),
    destinationType: v(b.destinationType),
    readyDate: v(b.readyDate),
    sellerPriority: v(b.sellerPriority),
    pallets: v(b.pallets),
    grossWeight: v(b.grossWeight),
    cartons: { value: v(b.cartons), source: b.cartons.source },
    declaredValue: { value: v(b.declaredValue), source: b.declaredValue.source },
    appointment: v(b.appointment),
    chosenCarrier: b.chosenCarrier,
    items: b.items.map((it) => ({
      itemId: it.id,
      sku: v(it.sku),
      description: v(it.description),
      hsCode: v(it.hsCode),
      quantity: v(it.quantity),
      unitPrice: v(it.unitPrice),
      unitsPerCarton: v(it.unitsPerCarton),
      cartons: v(it.cartons),
      unitWeight: v(it.unitWeight),
      countryOfOrigin: v(it.countryOfOrigin),
    })),
  };
}
