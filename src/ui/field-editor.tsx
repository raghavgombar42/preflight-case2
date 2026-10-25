"use client";

import { useState } from "react";
import {
  ALL_DEST_CITIES,
  DESTINATION_TYPES,
  DEST_COUNTRIES,
  ITEM_ORIGINS,
  ORIGIN_CITIES,
  SELLER_PRIORITIES,
  YES_NO,
} from "@/core/config";
import {
  BOOKING_FIELD_LABELS,
  Booking,
  FieldRef,
  FieldValue,
  ITEM_FIELD_LABELS,
  Patch,
  itemLabel,
} from "@/core/model";
import { buildBookingField, buildItemField, displayRaw } from "@/core/values";
import { Button } from "./bits";

const OPTIONS: Record<string, readonly string[]> = {
  originCity: ORIGIN_CITIES,
  destCity: ALL_DEST_CITIES,
  destCountry: DEST_COUNTRIES,
  destinationType: DESTINATION_TYPES,
  sellerPriority: SELLER_PRIORITIES,
  appointment: YES_NO,
  countryOfOrigin: ITEM_ORIGINS,
  originCountry: ["United Kingdom"],
  currency: ["GBP"],
};

export function fieldOf(b: Booking, ref: FieldRef): FieldValue<unknown> | null {
  if (ref.scope === "booking") return b[ref.field] as FieldValue<unknown>;
  const it = b.items.find((x) => x.id === ref.itemId);
  return it ? (it[ref.field] as FieldValue<unknown>) : null;
}

export function refLabel(b: Booking, ref: FieldRef): string {
  if (ref.scope === "booking") return BOOKING_FIELD_LABELS[ref.field];
  const it = b.items.find((x) => x.id === ref.itemId);
  return `${it ? itemLabel(it) : ref.itemId} · ${ITEM_FIELD_LABELS[ref.field]}`;
}

function initial(fv: FieldValue<unknown> | null, field: string): string {
  if (!fv) return "";
  if (field === "readyDate" && typeof fv.value === "string") return fv.value; // ISO for <input type=date>
  if (fv.value !== null && fv.value !== undefined) return String(fv.value);
  if (fv.raw !== null && fv.raw !== undefined && fv.status === "invalid") return String(fv.raw);
  return "";
}

export function FieldEditor({ booking, fref, onSave, compact }: { booking: Booking; fref: FieldRef; onSave: (p: Patch, label: string) => void; compact?: boolean }) {
  const fv = fieldOf(booking, fref);
  const [val, setVal] = useState(initial(fv, fref.field));
  const [err, setErr] = useState<string | null>(null);
  const opts = OPTIONS[fref.field];
  const label = refLabel(booking, fref);
  const isDate = fref.field === "readyDate";
  const numeric = !opts && !isDate && !["sku", "description", "hsCode", "ref", "sellerName"].includes(fref.field);

  const save = () => {
    const raw = isDate && /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : val.trim() === "" ? null : val.trim();
    const probe = fref.scope === "booking" ? buildBookingField(fref.field, raw, "edited") : buildItemField(fref.field, raw, "edited");
    if (probe.status === "invalid") {
      setErr(probe.note ?? "Not a valid value");
      return;
    }
    setErr(null);
    const patch: Patch =
      fref.scope === "booking"
        ? { kind: "booking", field: fref.field, value: raw }
        : { kind: "item", itemId: fref.itemId, field: fref.field, value: raw };
    onSave(patch, `${label}: ${fv && fv.value !== null ? displayRaw(fv.value) : "(blank)"} → ${raw ?? "(blank)"}`);
  };

  const input = opts ? (
    <select
      value={val}
      onChange={(e) => setVal(e.target.value)}
      className="min-w-0 flex-1 rounded-md border border-grey-line bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
    >
      <option value="">Select…</option>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  ) : (
    <input
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && save()}
      type={isDate ? "date" : "text"}
      inputMode={numeric ? "decimal" : undefined}
      placeholder={fref.field === "hsCode" ? "e.g. 691200" : ""}
      className="min-w-0 flex-1 rounded-md border border-grey-line bg-white px-2 py-1.5 text-sm tnum focus:outline-none focus:ring-2 focus:ring-brand/30"
    />
  );

  return (
    <div className={compact ? "" : "rounded-lg border border-line bg-canvas/60 p-2"}>
      {!compact && <div className="mb-1 text-xs font-medium text-ink-2">{label}</div>}
      <div className="flex items-center gap-2">
        {input}
        <Button size="sm" variant="primary" onClick={save}>
          Save
        </Button>
      </div>
      {err && <div className="mt-1 text-xs text-red">{err}</div>}
    </div>
  );
}
