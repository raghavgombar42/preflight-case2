// Creating bookings and applying validated patches. Bookings are treated as
// immutable: every patch returns a new object, so the original upload is
// never modified and any change can be undone.

import { ORIGIN_COUNTRY, CURRENCY, cityCountry } from "./config";
import {
  BOOKING_FIELDS,
  Booking,
  BookingField,
  FieldSource,
  FieldValue,
  ITEM_FIELDS,
  Item,
  ItemField,
  Patch,
  fieldValue,
} from "./model";
import { buildBookingField, buildItemField } from "./values";

export function cloneBooking(b: Booking): Booking {
  return structuredClone(b);
}

export function newItem(seq: number, values: Partial<Record<ItemField, unknown>>, source: FieldSource, sourceRow: number | null = null): Item {
  const it = { id: `it-${seq}`, sourceRow } as Item;
  for (const f of ITEM_FIELDS) {
    (it as Record<ItemField, FieldValue<unknown>>)[f] = buildItemField(f, values[f] ?? null, source);
  }
  return it;
}

export function newBooking(
  values: Partial<Record<BookingField, unknown>>,
  source: FieldSource,
  opts: { uid: string; mode: Booking["mode"]; sourceRow?: number | null }
): Booking {
  const b = {
    uid: opts.uid,
    mode: opts.mode,
    sourceRow: opts.sourceRow ?? null,
    items: [],
    chosenCarrier: null,
    r06Cleared: [],
    nextItemSeq: 1,
  } as unknown as Booking;
  for (const f of BOOKING_FIELDS) {
    (b as unknown as Record<BookingField, FieldValue<unknown>>)[f] = buildBookingField(f, values[f] ?? null, source);
  }
  return b;
}

export function emptyChatBooking(uid: string): Booking {
  const b = newBooking({ ref: "CHAT-001" }, "generated", { uid, mode: "chat" });
  b.originCountry = fieldValue(ORIGIN_COUNTRY, ORIGIN_COUNTRY, "generated", "ok");
  b.currency = fieldValue(CURRENCY, CURRENCY, "generated", "ok");
  return b;
}

function setBookingField(b: Booking, field: BookingField, value: unknown, source: FieldSource) {
  (b as unknown as Record<BookingField, FieldValue<unknown>>)[field] = buildBookingField(field, value, source);
}

function setItemField(it: Item, field: ItemField, value: unknown, source: FieldSource) {
  (it as unknown as Record<ItemField, FieldValue<unknown>>)[field] = buildItemField(field, value, source);
}

export type PatchResult = { booking: Booking; ok: boolean; error?: string };

export function applyPatch(input: Booking, patch: Patch, source: FieldSource = "edited"): PatchResult {
  const b = cloneBooking(input);
  switch (patch.kind) {
    case "booking": {
      setBookingField(b, patch.field, patch.value, source);
      const fv = b[patch.field] as FieldValue<unknown>;
      if (fv.status === "invalid") {
        return { booking: input, ok: false, error: `${String(patch.value)} is not valid for this field (${fv.note ?? "invalid"}).` };
      }
      if (patch.field === "destCity" && fv.value) {
        // the city determines the country
        const c = cityCountry(fv.value as string);
        if (c) b.destCountry = fieldValue(c, c, source === "uploaded" ? "uploaded" : "calculated", "ok");
      }
      break;
    }
    case "item": {
      const it = b.items.find((x) => x.id === patch.itemId);
      if (!it) return { booking: input, ok: false, error: `No item ${patch.itemId}.` };
      setItemField(it, patch.field, patch.value, source);
      const fv = it[patch.field] as FieldValue<unknown>;
      if (fv.status === "invalid") {
        return { booking: input, ok: false, error: `${String(patch.value)} is not valid for this field (${fv.note ?? "invalid"}).` };
      }
      if (patch.field === "description") b.r06Cleared = b.r06Cleared.filter((id) => id !== it.id);
      break;
    }
    case "addItem": {
      const it = newItem(b.nextItemSeq, patch.values, source);
      b.nextItemSeq += 1;
      b.items.push(it);
      break;
    }
    case "removeItem": {
      if (!b.items.some((x) => x.id === patch.itemId)) return { booking: input, ok: false, error: `No item ${patch.itemId}.` };
      b.items = b.items.filter((x) => x.id !== patch.itemId);
      b.r06Cleared = b.r06Cleared.filter((id) => id !== patch.itemId);
      break;
    }
    case "r06Clear": {
      if (!b.items.some((x) => x.id === patch.itemId)) return { booking: input, ok: false, error: `No item ${patch.itemId}.` };
      if (!b.r06Cleared.includes(patch.itemId)) b.r06Cleared.push(patch.itemId);
      break;
    }
    case "chooseCarrier": {
      b.chosenCarrier = patch.carrier;
      break;
    }
  }
  if (b.mode === "chat") syncCalculatedTotals(b);
  return { booking: b, ok: true };
}

export function applyPatches(input: Booking, patches: Patch[], source: FieldSource = "edited") {
  let b = input;
  const errors: string[] = [];
  for (const p of patches) {
    const r = applyPatch(b, p, source);
    if (r.ok) b = r.booking;
    else errors.push(r.error ?? "invalid change");
  }
  return { booking: b, errors };
}

// In chat, totals the seller has not stated are calculated from the items and
// kept in sync, so they cannot drift. Values the seller stated are left alone
// and checked by the rules like any other stated value.
export function syncCalculatedTotals(b: Booking) {
  const canDerive = (fv: FieldValue<number>) => fv.status === "missing" || fv.source === "calculated";

  for (const it of b.items) {
    if (canDerive(it.cartons) && it.quantity.value && it.unitsPerCarton.value && it.quantity.value % it.unitsPerCarton.value === 0) {
      it.cartons = fieldValue(null, it.quantity.value / it.unitsPerCarton.value, "calculated", "ok");
    } else if (it.cartons.source === "calculated" && !(it.quantity.value && it.unitsPerCarton.value)) {
      it.cartons = fieldValue<number>(null, null, "calculated", "missing");
    }
  }
  if (b.items.length === 0) return;
  const cartons = b.items.map((it) => it.cartons.value);
  if (canDerive(b.cartons)) {
    b.cartons = cartons.every((c) => c !== null)
      ? fieldValue(null, (cartons as number[]).reduce((s, c) => s + c, 0), "calculated", "ok")
      : fieldValue<number>(null, null, "calculated", "missing");
  }
  const lines = b.items.map((it) =>
    it.quantity.value !== null && it.unitPrice.value !== null ? it.quantity.value * it.unitPrice.value : null
  );
  if (canDerive(b.declaredValue)) {
    b.declaredValue = lines.every((l) => l !== null)
      ? fieldValue(null, Math.round((lines as number[]).reduce((s, l) => s + l, 0) * 100) / 100, "calculated", "ok")
      : fieldValue<number>(null, null, "calculated", "missing");
  }
}

export type FieldChange = { label: string; before: string; after: string };

// Human-readable list of what differs between two versions of a booking.
export function diffBookings(a: Booking, b: Booking): FieldChange[] {
  const out: FieldChange[] = [];
  const show = (fv: FieldValue<unknown> | undefined) =>
    fv ? (fv.value !== null ? String(fv.value) : fv.status === "unknown" ? "unknown" : "(blank)") : "(none)";
  for (const f of BOOKING_FIELDS) {
    const x = show(a[f] as FieldValue<unknown>);
    const y = show(b[f] as FieldValue<unknown>);
    if (x !== y) out.push({ label: f, before: x, after: y });
  }
  const ids = new Set([...a.items.map((i) => i.id), ...b.items.map((i) => i.id)]);
  for (const id of ids) {
    const ia = a.items.find((i) => i.id === id);
    const ib = b.items.find((i) => i.id === id);
    const name = (ib ?? ia)!.sku.value ?? (ib ?? ia)!.description.value ?? id;
    if (!ia) {
      out.push({ label: `item ${name}`, before: "(none)", after: "added" });
      continue;
    }
    if (!ib) {
      out.push({ label: `item ${name}`, before: "present", after: "removed" });
      continue;
    }
    for (const f of ITEM_FIELDS) {
      const x = show(ia[f] as FieldValue<unknown>);
      const y = show(ib[f] as FieldValue<unknown>);
      if (x !== y) out.push({ label: `${name} · ${f}`, before: x, after: y });
    }
  }
  if (a.chosenCarrier !== b.chosenCarrier) out.push({ label: "chosen carrier", before: a.chosenCarrier ?? "none", after: b.chosenCarrier ?? "none" });
  const ca = a.r06Cleared.join(",");
  const cb = b.r06Cleared.join(",");
  if (ca !== cb) out.push({ label: "battery confirmation", before: ca || "none", after: cb || "none" });
  return out;
}
