import * as XLSX from "xlsx";
import { newBooking, newItem } from "@/core/edit";
import { Booking, BookingField, ItemField } from "@/core/model";

export const TODAY = "2026-10-26";

export const BASE_BOOKING: Partial<Record<BookingField, unknown>> = {
  ref: "BK-001",
  sellerName: "Northfield Goods",
  originCity: "Manchester",
  originCountry: "United Kingdom",
  destCity: "Frankfurt",
  destCountry: "Germany",
  destinationType: "Warehouse",
  readyDate: "05-11-2026",
  sellerPriority: "Cheapest",
  pallets: 3,
  cartons: 90,
  declaredValue: 5400,
  currency: "GBP",
  grossWeight: 620,
  appointment: "Yes",
};

export const BASE_ITEM: Partial<Record<ItemField, unknown>> = {
  sku: "MUG-01",
  description: "Ceramic coffee mug, 350 ml",
  hsCode: 691200,
  quantity: 1080,
  unitPrice: 5,
  unitsPerCarton: 12,
  cartons: 90,
  unitWeight: 0.5,
  countryOfOrigin: "United Kingdom",
};

export function booking(
  over: Partial<Record<BookingField, unknown>> = {},
  items: Array<Partial<Record<ItemField, unknown>>> = [{}]
): Booking {
  const b = newBooking({ ...BASE_BOOKING, ...over }, "uploaded", { uid: "t1", mode: "upload", sourceRow: 4 });
  items.forEach((it, i) => {
    b.items.push(newItem(i + 1, { ...BASE_ITEM, ...it }, "uploaded", 4 + i));
  });
  b.nextItemSeq = items.length + 1;
  return b;
}

const B_HEAD = [
  "Booking ID", "Seller name", "Origin city", "Origin country", "Destination city", "Destination country",
  "Destination type", "Ready to ship date", "Seller priority", "Pallets", "Cartons", "Total declared value",
  "Currency", "Total gross weight (kg)", "Delivery appointment booked",
];
const I_HEAD = [
  "Booking ID", "SKU", "Description", "HS code", "Quantity (units)", "Unit price", "Units per carton", "Cartons",
  "Unit weight (kg)", "Country of origin",
];
export const EXAMPLE_B = ["BK-001", "Northfield Goods", "Manchester", "United Kingdom", "Frankfurt", "Germany", "Warehouse", "05-11-2026", "Cheapest", 3, 90, 5400, "GBP", 620, "Yes"];
export const EXAMPLE_I = ["BK-001", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"];

// Builds a workbook in the official layout: title row, header row 2, data from row 3.
export function workbook(bRows: unknown[][], iRows: unknown[][], opts: { blankTail?: number; extraSheets?: boolean } = {}): Uint8Array {
  const wb = XLSX.utils.book_new();
  const bAoa: unknown[][] = [["Bookings — one row per record. Row 3 is an example (grey); enter data from row 4."], B_HEAD, ...bRows];
  const iAoa: unknown[][] = [["Items — one row per record. Row 3 is an example (grey); enter data from row 4."], I_HEAD, ...iRows];
  for (let k = 0; k < (opts.blankTail ?? 0); k++) {
    bAoa.push(new Array(15).fill(null));
    iAoa.push(new Array(10).fill(""));
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bAoa), "Bookings");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(iAoa), "Items");
  if (opts.extraSheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["FIXED"], ["Carrier"]]), "Carrier options");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["FIXED"], ["Rule ID"]]), "Rulebook");
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}
