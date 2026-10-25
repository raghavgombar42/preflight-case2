// Reads the judges' workbook (Bookings + Items sheets in the official
// template layout). Sheets and header rows are found by name, never by
// position; original row numbers are kept for every record.

import * as XLSX from "xlsx";
import { Booking, BookingField, ItemField } from "./model";
import { newBooking, newItem } from "./edit";
import { cleanText } from "./values";

export type UnmatchedItem = { sourceRow: number; bookingRef: string; sku: string | null; description: string | null };

export type ParseResult = {
  bookings: Booking[];
  unmatchedItems: UnmatchedItem[];
  duplicateRefs: string[];
  fileErrors: string[];
  fileNotes: string[];
};

const BOOKING_COLS: Record<BookingField, string[]> = {
  ref: ["booking id", "booking ref", "booking reference", "booking"],
  sellerName: ["seller name", "seller"],
  originCity: ["origin city"],
  originCountry: ["origin country"],
  destCity: ["destination city", "dest city"],
  destCountry: ["destination country", "dest country"],
  destinationType: ["destination type"],
  readyDate: ["ready to ship date", "ready-to-ship date", "ready date"],
  sellerPriority: ["seller priority", "priority"],
  pallets: ["pallets", "number of pallets"],
  cartons: ["cartons", "total cartons"],
  declaredValue: ["total declared value", "declared value"],
  currency: ["currency"],
  grossWeight: ["total gross weight", "gross weight"],
  appointment: ["delivery appointment booked", "delivery appointment", "appointment booked"],
};

const ITEM_COLS: Record<ItemField | "ref", string[]> = {
  ref: ["booking id", "booking ref", "booking reference", "booking"],
  sku: ["sku"],
  description: ["description", "product description"],
  hsCode: ["hs code", "hscode", "hs"],
  quantity: ["quantity", "qty", "quantity units"],
  unitPrice: ["unit price", "price per unit"],
  unitsPerCarton: ["units per carton"],
  cartons: ["cartons"],
  unitWeight: ["unit weight", "unit weight kg"],
  countryOfOrigin: ["country of origin", "origin"],
};

// "Total gross weight (kg)" → "total gross weight"
export function normHeader(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Grid = { rows: unknown[][]; firstRow: number };

function sheetGrid(ws: XLSX.WorkSheet): Grid {
  const ref = ws["!ref"];
  if (!ref) return { rows: [], firstRow: 1 };
  const range = XLSX.utils.decode_range(ref);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  return { rows, firstRow: range.s.r + 1 };
}

function findHeader<K extends string>(grid: Grid, spec: Record<K, string[]>, mustHave: K[]) {
  let best: { idx: number; map: Partial<Record<K, number>>; score: number } | null = null;
  const scan = Math.min(grid.rows.length, 25);
  for (let r = 0; r < scan; r++) {
    const cells = (grid.rows[r] ?? []).map(normHeader);
    const map: Partial<Record<K, number>> = {};
    const used = new Set<number>();
    for (const key of Object.keys(spec) as K[]) {
      for (const alias of spec[key]) {
        const c = cells.findIndex((h, i) => h === alias && !used.has(i));
        if (c >= 0) {
          map[key] = c;
          used.add(c);
          break;
        }
      }
    }
    const score = Object.keys(map).length;
    if (mustHave.every((k) => map[k] !== undefined) && score >= 3 && (!best || score > best.score)) {
      best = { idx: r, map, score };
    }
  }
  return best;
}

function findSheet(wb: XLSX.WorkBook, names: string[], fallbackWord: string): XLSX.WorkSheet | null {
  const norm = (s: string) => s.trim().toLowerCase();
  const exact = wb.SheetNames.find((n) => names.includes(norm(n)));
  if (exact) return wb.Sheets[exact];
  const partial = wb.SheetNames.find((n) => norm(n).includes(fallbackWord));
  return partial ? wb.Sheets[partial] : null;
}

const rowBlank = (row: unknown[] | undefined) =>
  !row || row.every((c) => c === null || c === undefined || (typeof c === "string" && c.trim() === ""));

let uidCounter = 0;
const nextUid = () => `u${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

export function parseWorkbook(data: ArrayBuffer | Uint8Array): ParseResult {
  const result: ParseResult = { bookings: [], unmatchedItems: [], duplicateRefs: [], fileErrors: [], fileNotes: [] };
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: "array", cellDates: false, cellFormula: false, cellHTML: false, cellText: false });
  } catch {
    result.fileErrors.push("This file could not be read as an Excel workbook. Please upload the .xlsx template.");
    return result;
  }

  let bookingsWs = findSheet(wb, ["bookings", "booking"], "booking");
  let itemsWs = findSheet(wb, ["items", "item"], "item");

  // Fall back to finding the sheets by their headers if they were renamed.
  if (!bookingsWs || !itemsWs) {
    for (const name of wb.SheetNames) {
      const g = sheetGrid(wb.Sheets[name]);
      if (!bookingsWs && findHeader<BookingField>(g, BOOKING_COLS, ["ref", "pallets"])) bookingsWs = wb.Sheets[name];
      else if (!itemsWs && findHeader<ItemField | "ref">(g, ITEM_COLS, ["ref", "quantity"])) itemsWs = wb.Sheets[name];
    }
  }
  if (!bookingsWs) result.fileErrors.push('No "Bookings" sheet found.');
  if (!itemsWs) result.fileErrors.push('No "Items" sheet found.');
  if (!bookingsWs || !itemsWs) return result;

  const bGrid = sheetGrid(bookingsWs);
  const iGrid = sheetGrid(itemsWs);
  const bHead = findHeader<BookingField>(bGrid, BOOKING_COLS, ["ref"]);
  const iHead = findHeader<ItemField | "ref">(iGrid, ITEM_COLS, ["ref"]);
  if (!bHead) result.fileErrors.push('Could not find the header row on the Bookings sheet (expected "Booking ID", "Seller name", …).');
  if (!iHead) result.fileErrors.push('Could not find the header row on the Items sheet (expected "Booking ID", "SKU", …).');
  if (!bHead || !iHead) return result;

  const missingB = (Object.keys(BOOKING_COLS) as BookingField[]).filter((k) => bHead.map[k] === undefined);
  const missingI = (Object.keys(ITEM_COLS) as Array<ItemField | "ref">).filter((k) => iHead.map[k] === undefined);
  if (missingB.length) result.fileNotes.push(`Bookings sheet has no column for: ${missingB.join(", ")}. Those values are treated as missing.`);
  if (missingI.length) result.fileNotes.push(`Items sheet has no column for: ${missingI.join(", ")}. Those values are treated as missing.`);

  const byRef = new Map<string, Booking[]>();
  for (let r = bHead.idx + 1; r < bGrid.rows.length; r++) {
    const row = bGrid.rows[r];
    if (rowBlank(row)) continue;
    const sourceRow = bGrid.firstRow + r;
    const values: Partial<Record<BookingField, unknown>> = {};
    for (const [k, c] of Object.entries(bHead.map) as Array<[BookingField, number]>) values[k] = row?.[c] ?? null;
    const ref = cleanText(values.ref);
    if (!ref) {
      // a row with data but no Booking ID still needs to be shown
      values.ref = null;
    }
    const b = newBooking(values, "uploaded", { uid: nextUid(), mode: "upload", sourceRow });
    result.bookings.push(b);
    const key = (ref ?? `(row ${sourceRow})`).toUpperCase();
    byRef.set(key, [...(byRef.get(key) ?? []), b]);
  }

  for (const [key, list] of byRef) {
    if (list.length > 1) {
      result.duplicateRefs.push(list[0].ref.value ?? key);
      const rows = list.map((b) => b.sourceRow!).filter(Boolean);
      for (const b of list) b.duplicateOfRows = rows;
    }
  }

  for (let r = iHead.idx + 1; r < iGrid.rows.length; r++) {
    const row = iGrid.rows[r];
    if (rowBlank(row)) continue;
    const sourceRow = iGrid.firstRow + r;
    const values: Partial<Record<ItemField | "ref", unknown>> = {};
    for (const [k, c] of Object.entries(iHead.map) as Array<[ItemField | "ref", number]>) values[k] = row?.[c] ?? null;
    const ref = cleanText(values.ref);
    const target = ref ? byRef.get(ref.toUpperCase())?.[0] : undefined;
    if (!target) {
      result.unmatchedItems.push({
        sourceRow,
        bookingRef: ref ?? "(blank)",
        sku: cleanText(values.sku),
        description: cleanText(values.description),
      });
      continue;
    }
    const { ref: _ignored, ...itemValues } = values;
    void _ignored;
    target.items.push(newItem(target.nextItemSeq, itemValues, "uploaded", sourceRow));
    target.nextItemSeq += 1;
  }

  for (const b of result.bookings) {
    if (
      b.ref.value === "BK-001" &&
      b.sellerName.value === "Northfield Goods" &&
      b.items.length === 1 &&
      b.items[0].sku.value === "MUG-01"
    ) {
      b.isTemplateExample = true;
    }
  }

  if (result.bookings.length === 0) result.fileErrors.push("No bookings found below the header row on the Bookings sheet.");
  return result;
}
