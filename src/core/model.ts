// Booking data model shared by upload and chat. Every field keeps what was
// supplied (raw), what the engine uses (value), and where it came from.

export type FieldStatus = "ok" | "missing" | "invalid" | "unknown";
export type FieldSource = "uploaded" | "chat" | "calculated" | "edited" | "generated";

export type FieldValue<T> = {
  raw: unknown;
  value: T | null;
  status: FieldStatus;
  source: FieldSource;
  note?: string;
};

export type CarrierName = "Carrier A" | "Carrier B" | "Carrier C";

export type Item = {
  id: string;
  sourceRow: number | null;
  sku: FieldValue<string>;
  description: FieldValue<string>;
  hsCode: FieldValue<string>;
  quantity: FieldValue<number>;
  unitPrice: FieldValue<number>;
  unitsPerCarton: FieldValue<number>;
  cartons: FieldValue<number>;
  unitWeight: FieldValue<number>;
  countryOfOrigin: FieldValue<string>;
};

export type Booking = {
  uid: string;
  mode: "upload" | "chat";
  sourceRow: number | null;
  ref: FieldValue<string>;
  sellerName: FieldValue<string>;
  originCity: FieldValue<string>;
  originCountry: FieldValue<string>;
  destCity: FieldValue<string>;
  destCountry: FieldValue<string>;
  destinationType: FieldValue<string>;
  readyDate: FieldValue<string>; // ISO yyyy-mm-dd
  sellerPriority: FieldValue<string>;
  pallets: FieldValue<number>;
  cartons: FieldValue<number>;
  declaredValue: FieldValue<number>;
  currency: FieldValue<string>;
  grossWeight: FieldValue<number>;
  appointment: FieldValue<string>;
  items: Item[];
  isTemplateExample?: boolean;
  duplicateOfRows?: number[];
  chosenCarrier: CarrierName | null; // only when the seller explicitly names one
  r06Cleared: string[]; // item ids the seller confirmed contain no lithium battery
  nextItemSeq: number;
};

export const BOOKING_FIELDS = [
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
  "appointment",
] as const;
export type BookingField = (typeof BOOKING_FIELDS)[number];

export const ITEM_FIELDS = [
  "sku",
  "description",
  "hsCode",
  "quantity",
  "unitPrice",
  "unitsPerCarton",
  "cartons",
  "unitWeight",
  "countryOfOrigin",
] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];

export const BOOKING_FIELD_LABELS: Record<BookingField, string> = {
  ref: "Booking ID",
  sellerName: "Seller name",
  originCity: "Origin city",
  originCountry: "Origin country",
  destCity: "Destination city",
  destCountry: "Destination country",
  destinationType: "Destination type",
  readyDate: "Ready to ship date",
  sellerPriority: "Seller priority",
  pallets: "Pallets",
  cartons: "Cartons",
  declaredValue: "Total declared value",
  currency: "Currency",
  grossWeight: "Total gross weight (kg)",
  appointment: "Delivery appointment booked",
};

export const ITEM_FIELD_LABELS: Record<ItemField, string> = {
  sku: "SKU",
  description: "Description",
  hsCode: "HS code",
  quantity: "Quantity (units)",
  unitPrice: "Unit price",
  unitsPerCarton: "Units per carton",
  cartons: "Cartons",
  unitWeight: "Unit weight (kg)",
  countryOfOrigin: "Country of origin",
};

export type FieldRef =
  | { scope: "booking"; field: BookingField }
  | { scope: "item"; itemId: string; field: ItemField };

export type Patch =
  | { kind: "booking"; field: BookingField; value: unknown }
  | { kind: "item"; itemId: string; field: ItemField; value: unknown }
  | { kind: "addItem"; values: Partial<Record<ItemField, unknown>> }
  | { kind: "removeItem"; itemId: string }
  | { kind: "r06Clear"; itemId: string }
  | { kind: "chooseCarrier"; carrier: CarrierName | null };

export function fieldValue<T>(
  raw: unknown,
  value: T | null,
  source: FieldSource,
  status?: FieldStatus,
  note?: string
): FieldValue<T> {
  const st: FieldStatus = status ?? (value === null ? (isBlank(raw) ? "missing" : "invalid") : "ok");
  return note ? { raw, value, status: st, source, note } : { raw, value, status: st, source };
}

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

export function itemLabel(it: Item): string {
  return it.sku.value ?? it.description.value ?? it.id;
}
