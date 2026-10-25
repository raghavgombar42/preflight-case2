// Builds public/sample-bookings.xlsx from the official template: the grey
// example row stays in row 3 and our test bookings (one planted mistake
// each, plus a few clean and multi-issue ones) start at row 4.
// Run: node scripts/make-sample.mjs

import { readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

const wb = XLSX.read(readFileSync("public/Case2_Shipment_Booking_Test_Data_Format.xlsx"), { type: "buffer" });

// Booking ID, Seller, Origin city, Origin country, Dest city, Dest country, Dest type, Ready, Priority,
// Pallets, Cartons, Declared value, Currency, Gross kg, Appointment
const B = (id, seller, o, dc, dco, type, ready, pri, pal, ctn, val, kg, appt) => [id, seller, o, "United Kingdom", dc, dco, type, ready, pri, pal, ctn, val, "GBP", kg, appt];
// Booking ID, SKU, Description, HS, Qty, Unit price, Units/carton, Cartons, Unit kg, Origin
const I = (id, sku, desc, hs, q, p, upc, c, w, origin) => [id, sku, desc, hs, q, p, upc, c, w, origin];

const bookings = [
  B("BK-002", "Lumen Home", "London", "Paris", "France", "Business address", "12-11-2026", "Balanced", 2, 60, 4320, 640, "No"),
  B("BK-003", "Northfield Goods", "Manchester", "Hamburg", "Germany", "Warehouse", "09-11-2026", "Cheapest", 3, 90, 5400, 620, "Yes"),
  B("BK-004", "Thread & Co", "Leeds", "Amsterdam", "Netherlands", "Warehouse", "10-11-2026", "Fastest", 2, 95, 3600, 410, "Yes"),
  B("BK-005", "Brew Bros", "Birmingham", "Lyon", "France", "Business address", "16-11-2026", "Most reliable", 1, 40, 1920, 260, "No"),
  B("BK-006", "Iron Anvil Tools", "Manchester", "Berlin", "Germany", "Warehouse", "18-11-2026", "Cheapest", 3, 120, 9600, 2400, "Yes"),
  B("BK-007", "Stone & Slab", "Leeds", "Rotterdam", "Netherlands", "Warehouse", "11-11-2026", "Cheapest", 3, 150, 6000, 1860, "Yes"),
  B("BK-008", "Glow Beauty", "London", "Paris", "France", "Warehouse", "13-11-2026", "Fastest", 1, 30, 3150, 180, "Yes"),
  B("BK-009", "Paper Trail", "Birmingham", "Frankfurt", "Germany", "Business address", "14-11-2026", "Balanced", 2, 80, 2400, 500, "No"),
  B("BK-010", "Kitchen Kraft", "London", "Berlin", "Germany", "Warehouse", "17-11-2026", "Most reliable", 2, 50, 3000, 520, "No"),
  B("BK-011", "Late Starter Ltd", "Manchester", "Amsterdam", "Netherlands", "Business address", "20-10-2026", "Cheapest", 1, 20, 800, 150, "No"),
  B("BK-012", "SoundWave UK", "Leeds", "Hamburg", "Germany", "Warehouse", "19-11-2026", "Fastest", 1, 25, 3750, 210, "Yes"),
  B("BK-013", "Bean There", "London", "Lyon", "France", "Business address", "15-11-2026", "Cheapest", 1, 40, 2400, 330, "No"),
  B("BK-014", "Tidy Homes", "Birmingham", "Rotterdam", "Netherlands", "Warehouse", "21-11-2026", "Balanced", 2, 60, 3620, 560, "Yes"),
  B("BK-015", "Quick Quote Co", "Leeds", "Paris", "France", "Warehouse", "22-11-2026", null, 2, 40, 1600, null, "Yes"),
];

const items = [
  I("BK-002", "LAMP-21", "Table lamp, linen shade", 940520, 240, 18, 4, 60, 2.2, "Vietnam"),
  I("BK-003", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1000, 5, 12, 90, 0.5, "United Kingdom"),
  I("BK-004", "TEE-BLK", "Cotton T-shirt, black", 610910, 600, 3, 20, 30, 0.2, "India"),
  I("BK-004", "TEE-WHT", "Cotton T-shirt, white", 610910, 1200, 1.5, 20, 60, 0.2, "India"),
  I("BK-005", "GRN-1KG", "Ground coffee, 1 kg bag", null, 160, 12, 4, 40, 1.1, null),
  I("BK-006", "VICE-8", "Cast iron bench vice, 8 inch", 820570, 240, 40, 2, 120, 9, "China"),
  I("BK-007", "TILE-SL", "Slate floor tiles, box of 10", 680300, 300, 20, 2, 150, 5.6, "Turkey"),
  I("BK-008", "EDP-50", "Eau de parfum 50 ml", 330300, 90, 25, 6, 15, 0.3, "United Kingdom"),
  I("BK-008", "PB-10K", "Lithium-ion power bank 10000mAh", 850760, 60, 15, 4, 15, 0.25, "China"),
  I("BK-009", "NB-A5", "A5 notebook, recycled paper", 482010, 1600, 1.5, 20, 80, 0.35, "United Kingdom"),
  I("BK-010", "PAN-28", "Non-stick frying pan, 28 cm", 732393, 200, 15, 4, 50, 1.4, "China"),
  I("BK-011", "SCARF-W", "Wool scarf", 611710, 100, 8, 5, 20, 0.2, "United Kingdom"),
  I("BK-012", "SPK-MINI", "Bluetooth speaker, mini", 851822, 150, 25, 6, 25, 0.4, "China"),
  I("BK-013", "BEAN-500", "Roasted coffee beans, 500 g", 90121, 400, 6, 10, 40, 0.55, "Vietnam"),
  I("BK-014", "BOX-STO", "Storage box, made in China", 392690, 600, 6, 10, 60, 0.6, "United Kingdom"),
  I("BK-015", "TOTE-C", "Cotton tote bag", 420222, 400, 4, 10, 40, 0.15, "India"),
  I("BK-099", "GHOST-1", "Item for a booking that isn't on the Bookings sheet", 420222, 10, 1, 10, 1, 0.1, "India"),
];

XLSX.utils.sheet_add_aoa(wb.Sheets["Bookings"], bookings, { origin: "A4" });
XLSX.utils.sheet_add_aoa(wb.Sheets["Items"], items, { origin: "A4" });
writeFileSync("public/sample-bookings.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log(`wrote ${bookings.length} bookings and ${items.length} item rows (plus the template example)`);
