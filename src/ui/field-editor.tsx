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

// autoSave: commits on selection, on Enter, or when the field loses focus
// (guided form). Otherwise an explicit, secondary Save button is shown.
export function FieldEditor({
  booking,
  fref,
  onSave,
  compact,
  autoSave,
}: {
  booking: Booking;
  fref: FieldRef;
  onSave: (p: Patch, label: string) => void;
  compact?: boolean;
  autoSave?: boolean;
}) {
  const fv = fieldOf(booking, fref);
  const [val, setVal] = useState(initial(fv, fref.field));
  const [err, setErr] = useState<string | null>(null);
  const opts = OPTIONS[fref.field];
  const label = refLabel(booking, fref);
  const isDate = fref.field === "readyDate";
  const numeric = !opts && !isDate && !["sku", "description", "hsCode", "ref", "sellerName"].includes(fref.field);
  const id = `fe-${fref.scope}-${"itemId" in fref ? fref.itemId : ""}-${fref.field}`;

  const save = (value: string = val) => {
    const raw = isDate && /^d{4}-d{2}-d{2}$/.test(value) ? value : value.trim() === "" ? null : value.trim();
    if (autoSave && raw === null) return; // leaving an empty field is not a change
    if (autoSave && raw === initial(fv, fref.field)) return;
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

  const cls = "min-w-0 flex-1 rounded-md border border-grey-line bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30";
  const input = opts ? (
    <select
      id={id}
      value={val}
      aria-invalid={!!err}
      onChange={(e) => {
        setVal(e.target.value);
        if (autoSave && e.target.value) save(e.target.value);
      }}
      className={cls}
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
      id={id}
      value={val}
      aria-invalid={!!err}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && save()}
      onBlur={() => autoSave && save()}
      type={isDate ? "date" : "text"}
      inputMode={numeric ? "decimal" : undefined}
      placeholder={fref.field === "hsCode" ? "e.g. 691200" : ""}
      className={`${cls} tnum`}
    />
  );

  return (
    <div className={compact ? "" : "rounded-lg bg-canvas/70 p-2"}>
      {compact ? (
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
      ) : (
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-2">
          {label}
        </label>
      )}
      <div className="flex items-center gap-2">
        {input}
        {!autoSave && (
          <Button size="sm" onClick={() => save()}>
            Save
          </Button>
        )}
      </div>
      <div aria-live="polite">{err && <div className="mt-1 text-xs text-red">{err}</div>}</div>
    </div>
  );
}
