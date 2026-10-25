// Fixed inputs from the official Case 2 template: allowed values, the carrier
// rate card (sheet 3) and the rulebook (sheet 4). Everything the engine treats
// as a business fact lives here.

import type { CarrierName } from "./model";

export const ORIGIN_COUNTRY = "United Kingdom";
export const CURRENCY = "GBP";
export const ORIGIN_CITIES = ["London", "Manchester", "Birmingham", "Leeds"] as const;
export const DEST_COUNTRIES = ["Germany", "France", "Netherlands"] as const;
export const DEST_CITIES: Record<(typeof DEST_COUNTRIES)[number], readonly string[]> = {
  Germany: ["Berlin", "Frankfurt", "Hamburg"],
  France: ["Paris", "Lyon"],
  Netherlands: ["Amsterdam", "Rotterdam"],
};
export const ALL_DEST_CITIES: readonly string[] = Object.values(DEST_CITIES).flat();
export const DESTINATION_TYPES = ["Warehouse", "Business address"] as const;
export const SELLER_PRIORITIES = ["Cheapest", "Fastest", "Most reliable", "Balanced"] as const;
export const YES_NO = ["Yes", "No"] as const;
export const ITEM_ORIGINS = ["United Kingdom", "China", "India", "Vietnam", "Turkey", "Germany"] as const;

// Alternative spellings a seller may type; they map onto the allowed values.
export const ALIASES: Record<string, string> = {
  uk: "United Kingdom",
  "u.k.": "United Kingdom",
  "great britain": "United Kingdom",
  britain: "United Kingdom",
  england: "United Kingdom",
  "the netherlands": "Netherlands",
  holland: "Netherlands",
  nl: "Netherlands",
  de: "Germany",
  fr: "France",
  "business": "Business address",
  "business address": "Business address",
  "shop": "Business address",
  "office": "Business address",
  "fulfilment centre": "Warehouse",
  "fulfillment center": "Warehouse",
  "distribution centre": "Warehouse",
  "reliable": "Most reliable",
  "most reliable": "Most reliable",
  "cheap": "Cheapest",
  "cheapest": "Cheapest",
  "fast": "Fastest",
  "fastest": "Fastest",
  "balanced": "Balanced",
  "y": "Yes",
  "n": "No",
  "true": "Yes",
  "false": "No",
};

export function cityCountry(city: string): (typeof DEST_COUNTRIES)[number] | null {
  for (const c of DEST_COUNTRIES) if (DEST_CITIES[c].includes(city)) return c;
  return null;
}

export type CarrierOption = {
  carrier: CarrierName;
  service: "Road economy" | "Road standard" | "Road express";
  shortName: "Economy" | "Standard" | "Express";
  destCountry: (typeof DEST_COUNTRIES)[number];
  pricePerPallet: number;
  transitDays: number;
  onTimeRate: number;
  maxKgPerPallet: number;
};

const row = (
  carrier: CarrierName,
  destCountry: CarrierOption["destCountry"],
  pricePerPallet: number
): CarrierOption => {
  const base = {
    "Carrier A": { service: "Road economy", shortName: "Economy", transitDays: 5, onTimeRate: 92, maxKgPerPallet: 500 },
    "Carrier B": { service: "Road standard", shortName: "Standard", transitDays: 3, onTimeRate: 95, maxKgPerPallet: 750 },
    "Carrier C": { service: "Road express", shortName: "Express", transitDays: 2, onTimeRate: 98, maxKgPerPallet: 400 },
  } as const;
  return { carrier, destCountry, pricePerPallet, ...base[carrier] };
};

export const RATE_CARD: readonly CarrierOption[] = [
  row("Carrier A", "Germany", 180),
  row("Carrier B", "Germany", 220),
  row("Carrier C", "Germany", 340),
  row("Carrier A", "France", 170),
  row("Carrier B", "France", 210),
  row("Carrier C", "France", 330),
  row("Carrier A", "Netherlands", 160),
  row("Carrier B", "Netherlands", 200),
  row("Carrier C", "Netherlands", 320),
];

export function routeOptions(destCountry: string): CarrierOption[] {
  return RATE_CARD.filter((r) => r.destCountry === destCountry);
}

export type RuleId = "R-01" | "R-02" | "R-03" | "R-04" | "R-05" | "R-06" | "R-07" | "R-08" | "R-09" | "R-10";

export type RuleMeta = {
  id: RuleId;
  rule: string; // official wording
  short: string;
  severity: "red" | "amber";
  stage: string; // where the shipment would fail
  consequence: string; // plain-English real-world consequence
};

export const RULES: readonly RuleMeta[] = [
  {
    id: "R-01",
    rule: "Every item must have an HS code of at least 6 digits",
    short: "HS code (6+ digits)",
    severity: "red",
    stage: "Customs",
    consequence: "Customs need the exact HS code to classify the goods; general or catch-all codes are not accepted, so the shipment is held.",
  },
  {
    id: "R-02",
    rule: "Total declared value must equal the sum of quantity × unit price across all items (within 1%)",
    short: "Declared value matches items",
    severity: "red",
    stage: "Customs",
    consequence: "Customs compare the invoice, packing list and declared value; a mismatch leads to a hold and possible penalties.",
  },
  {
    id: "R-03",
    rule: "For each item, units per carton × cartons must equal quantity",
    short: "Units × cartons = quantity",
    severity: "red",
    stage: "Warehouse",
    consequence: "The receiving warehouse counts cartons; if the numbers don't add up, units are reported missing.",
  },
  {
    id: "R-04",
    rule: "Total cartons on the booking must equal the sum of cartons across all items",
    short: "Booking cartons = item cartons",
    severity: "red",
    stage: "Warehouse",
    consequence: "The carton count on the booking is what the warehouse checks on arrival; a gap is logged as missing stock.",
  },
  {
    id: "R-05",
    rule: "Weight per pallet (total gross weight ÷ pallets) must not exceed the chosen carrier's max weight per pallet",
    short: "Pallet weight within carrier limit",
    severity: "red",
    stage: "Collection",
    consequence: "The carrier refuses pallets above its limit at collection.",
  },
  {
    id: "R-06",
    rule: "No lithium batteries, aerosols or flammable liquids",
    short: "No dangerous goods",
    severity: "red",
    stage: "Collection",
    consequence: "These standard road services do not accept dangerous goods; the carrier refuses the shipment.",
  },
  {
    id: "R-07",
    rule: "Total gross weight must be at least the sum of unit weight × quantity across all items",
    short: "Gross weight ≥ product weight",
    severity: "amber",
    stage: "Collection",
    consequence: "Carriers and customs re-weigh shipments; a declared weight lighter than the goods themselves is queried.",
  },
  {
    id: "R-08",
    rule: "Shipments to a warehouse must have a delivery appointment booked",
    short: "Warehouse appointment booked",
    severity: "amber",
    stage: "Delivery",
    consequence: "Warehouses turn away deliveries that arrive without a booked slot.",
  },
  {
    id: "R-09",
    rule: "Every item must have a country of origin",
    short: "Country of origin stated",
    severity: "amber",
    stage: "Customs",
    consequence: "A missing or wrong country of origin is treated as misdeclaration; both exporter and importer can be penalised.",
  },
  {
    id: "R-10",
    rule: "Ready to ship date must not be in the past",
    short: "Ready date not in the past",
    severity: "amber",
    stage: "Collection",
    consequence: "Collection cannot happen on a date that has already passed.",
  },
];

export function ruleMeta(id: RuleId): RuleMeta {
  return RULES.find((r) => r.id === id)!;
}

// R-06 phrase lists. Matching is whole-word and case-insensitive.
export const R06_CLEAR: Record<"lithium" | "aerosol" | "flammable", string[]> = {
  lithium: [
    "lithium", "li-ion", "li ion", "lithium-ion", "li-po", "lipo", "lithium polymer",
    "power bank", "powerbank", "battery", "batteries", "battery pack", "rechargeable battery",
  ],
  aerosol: [
    "aerosol", "aerosols", "spray can", "spray cans", "hairspray", "hair spray", "deodorant spray",
    "spray deodorant", "body spray", "spray paint", "dry shampoo", "compressed gas", "air freshener spray",
    "insect spray", "whipped cream charger",
  ],
  flammable: [
    "flammable", "inflammable", "perfume", "perfumes", "eau de parfum", "eau de toilette", "eau de cologne",
    "cologne", "fragrance oil", "nail polish", "nail varnish", "nail polish remover", "acetone",
    "lighter fluid", "lighter gas", "butane", "paint thinner", "white spirit", "turpentine", "solvent",
    "solvents", "hand sanitiser", "hand sanitizer", "isopropyl alcohol", "rubbing alcohol", "methylated spirit",
    "petrol", "gasoline", "diesel", "kerosene", "lamp oil", "ethanol",
  ],
};

export const R06_LIKELY_BATTERY: string[] = [
  "laptop", "laptops", "notebook computer", "smartphone", "smartphones", "mobile phone", "mobile phones",
  "cell phone", "iphone", "tablet computer", "ipad", "bluetooth speaker", "wireless speaker", "wireless earbuds",
  "wireless headphones", "smartwatch", "smart watch", "fitness tracker", "e-cigarette", "e-cigarettes",
  "vape", "vapes", "electric toothbrush", "cordless drill", "drone", "drones", "e-bike", "electric bike",
  "electric scooter", "hoverboard", "action camera", "handheld fan", "rechargeable",
];

// Phrases that neutralise a match (removed from the text before matching).
export const R06_NEGATIONS: string[] = [
  "battery-free", "battery free", "no battery", "no batteries", "without battery", "without batteries",
  "batteries not included", "battery not included", "non-flammable", "non flammable", "nonflammable",
  "solvent-free", "solvent free", "alcohol-free", "alcohol free", "non-aerosol", "non aerosol",
  "phone case", "phone cases", "phone cover", "phone covers", "phone stand", "phone holder", "screen protector",
  "laptop sleeve", "laptop bag", "laptop stand", "camera bag", "camera strap", "battery box (empty)",
  "perfume bottle, empty", "empty perfume bottle", "empty perfume bottles", "empty spray bottle",
  "empty spray bottles", "spray bottle (empty)", "fragrance-free", "fragrance free",
];
