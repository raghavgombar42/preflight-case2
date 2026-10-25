// Normalisers that turn raw spreadsheet / chat values into engine values.
// They never guess: anything ambiguous becomes "invalid" with a note.

import {
  ALIASES,
  ALL_DEST_CITIES,
  CURRENCY,
  DESTINATION_TYPES,
  DEST_COUNTRIES,
  ITEM_ORIGINS,
  ORIGIN_CITIES,
  ORIGIN_COUNTRY,
  SELLER_PRIORITIES,
  YES_NO,
} from "./config";
import {
  BookingField,
  FieldSource,
  FieldValue,
  ItemField,
  fieldValue,
  isBlank,
} from "./model";

export function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

export function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return null;
  const s = String(v)
    .trim()
    .replace(/[£€$,\s]/g, "")
    .replace(/(gbp|kgs?|kilograms?|units?|pcs|pallets?|cartons?)$/i, "");
  if (s === "" || !/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

export function normEnum(v: unknown, allowed: readonly string[]): string | null {
  const s = cleanText(v);
  if (!s) return null;
  const lower = s.toLowerCase().replace(/\.$/, "");
  const direct = allowed.find((a) => a.toLowerCase() === lower);
  if (direct) return direct;
  const alias = ALIASES[lower];
  if (alias && allowed.includes(alias)) return alias;
  return null;
}

// ---------- dates ----------

export function istToday(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 5.5 * 3600 * 1000);
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function isoFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function validParts(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Excel serial date (1900 date system) → ISO, without any time-zone conversion.
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 120000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  const d = new Date(ms);
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Accepts DD-MM-YYYY (also / or .), ISO yyyy-mm-dd, Excel serials and Date objects.
// Day always comes first: "05-11-2026" is 5 November.
export function parseDate(v: unknown): string | null {
  if (isBlank(v)) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return isoFromParts(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === "number") return excelSerialToIso(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validParts(y, mo, d) ? isoFromParts(y, mo, d) : null;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validParts(y, mo, d) ? isoFromParts(y, mo, d) : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  return null;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${dow} ${d} ${mon} ${y}`;
}

export function toDMY(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

// ---------- HS codes ----------

export function normHs(v: unknown): { digits: string | null; note?: string } {
  if (isBlank(v)) return { digits: null };
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return { digits: null, note: "not a valid number" };
    // 691200.0 → "691200"; a genuinely fractional number keeps its digits
    const s = Number.isInteger(v) ? String(v) : String(v).replace(".", "");
    return { digits: s };
  }
  const s = String(v).trim().replace(/^'/, "").replace(/[\s.\-]/g, "");
  if (!/^\d+$/.test(s)) return { digits: null, note: "contains characters other than digits" };
  return { digits: s };
}

// ---------- money / formatting ----------

export function gbp(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

export function num(n: number | null | undefined, dp = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

export function kg(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${num(round(n, 2), 2)} kg`;
}

// ---------- field builders ----------

type NumSpec = { integer?: boolean; min?: number; minExclusive?: boolean };

const NUM_SPECS: Partial<Record<BookingField | ItemField, NumSpec>> = {
  pallets: { integer: true, min: 0, minExclusive: true },
  cartons: { integer: true, min: 0, minExclusive: true },
  declaredValue: { min: 0 },
  grossWeight: { min: 0, minExclusive: true },
  quantity: { integer: true, min: 0, minExclusive: true },
  unitPrice: { min: 0 },
  unitsPerCarton: { integer: true, min: 0, minExclusive: true },
  unitWeight: { min: 0, minExclusive: true },
};

function numberField(raw: unknown, spec: NumSpec, source: FieldSource): FieldValue<number> {
  if (isBlank(raw)) return fieldValue<number>(raw, null, source, "missing");
  const n = parseNumber(raw);
  if (n === null) return fieldValue<number>(raw, null, source, "invalid", "not a number");
  if (spec.integer && !Number.isInteger(round(n, 6))) {
    return fieldValue<number>(raw, null, source, "invalid", "must be a whole number");
  }
  if (spec.min !== undefined && (spec.minExclusive ? n <= spec.min : n < spec.min)) {
    return fieldValue<number>(raw, null, source, "invalid", spec.minExclusive ? "must be greater than 0" : "cannot be negative");
  }
  return fieldValue(raw, spec.integer ? Math.round(n) : n, source, "ok");
}

function enumField(raw: unknown, allowed: readonly string[], source: FieldSource): FieldValue<string> {
  if (isBlank(raw)) return fieldValue<string>(raw, null, source, "missing");
  const v = normEnum(raw, allowed);
  return v
    ? fieldValue(raw, v, source, "ok")
    : fieldValue<string>(raw, null, source, "invalid", `not one of: ${allowed.join(", ")}`);
}

export function buildBookingField(field: BookingField, raw: unknown, source: FieldSource): FieldValue<unknown> {
  switch (field) {
    case "ref":
    case "sellerName": {
      const t = cleanText(raw);
      return fieldValue(raw, t, source, t ? "ok" : "missing");
    }
    case "originCity":
      return enumField(raw, ORIGIN_CITIES, source);
    case "originCountry":
      return enumField(raw, [ORIGIN_COUNTRY], source);
    case "destCity":
      return enumField(raw, ALL_DEST_CITIES, source);
    case "destCountry":
      return enumField(raw, DEST_COUNTRIES, source);
    case "destinationType":
      return enumField(raw, DESTINATION_TYPES, source);
    case "sellerPriority":
      return enumField(raw, SELLER_PRIORITIES, source);
    case "currency":
      return enumField(raw, [CURRENCY], source);
    case "appointment":
      return enumField(raw, YES_NO, source);
    case "readyDate": {
      if (isBlank(raw)) return fieldValue<string>(raw, null, source, "missing");
      const iso = parseDate(raw);
      return iso
        ? fieldValue(raw, iso, source, "ok")
        : fieldValue<string>(raw, null, source, "invalid", "not a valid DD-MM-YYYY date");
    }
    default:
      return numberField(raw, NUM_SPECS[field] ?? {}, source);
  }
}

export function buildItemField(field: ItemField, raw: unknown, source: FieldSource): FieldValue<unknown> {
  switch (field) {
    case "sku":
    case "description": {
      const t = cleanText(raw);
      return fieldValue(raw, t, source, t ? "ok" : "missing");
    }
    case "hsCode": {
      const h = normHs(raw);
      if (h.digits === null) {
        return isBlank(raw)
          ? fieldValue<string>(raw, null, source, "missing")
          : fieldValue<string>(raw, null, source, "invalid", h.note);
      }
      return fieldValue(raw, h.digits, source, "ok");
    }
    case "countryOfOrigin":
      return enumField(raw, ITEM_ORIGINS, source);
    default:
      return numberField(raw, NUM_SPECS[field] ?? {}, source);
  }
}

export function displayRaw(v: unknown): string {
  if (isBlank(v)) return "(blank)";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}
