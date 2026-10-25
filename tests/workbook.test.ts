import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze } from "@/core/analyze";
import { parseWorkbook } from "@/core/workbook";
import { EXAMPLE_B, EXAMPLE_I, TODAY, workbook } from "./helpers";

describe("workbook parsing", () => {
  it("reads the official layout with the example row kept and 497 blank formatted rows", () => {
    const data = workbook([EXAMPLE_B], [EXAMPLE_I], { blankTail: 497, extraSheets: true });
    const r = parseWorkbook(data);
    expect(r.fileErrors).toEqual([]);
    expect(r.bookings).toHaveLength(1);
    expect(r.bookings[0].sourceRow).toBe(3);
    expect(r.bookings[0].isTemplateExample).toBe(true);
    expect(r.bookings[0].items[0].sourceRow).toBe(3);
    expect(analyze(r.bookings[0], TODAY).verdict).toBe("passed");
  });

  it("handles the example row deleted or overwritten", () => {
    const own = ["BK-100", "Acme", "Leeds", "United Kingdom", "Paris", "France", "Business address", "01-12-2026", "Fastest", 2, 10, 100, "GBP", 300, "No"];
    const ownI = ["BK-100", "X1", "Cotton tote bag", "420222", 100, 1, 10, 10, 0.2, "India"];
    const r1 = parseWorkbook(workbook([own], [ownI]));
    expect(r1.bookings.map((b) => b.ref.value)).toEqual(["BK-100"]);
    expect(r1.bookings[0].sourceRow).toBe(3);
    const r2 = parseWorkbook(workbook([EXAMPLE_B, own], [EXAMPLE_I, ownI]));
    expect(r2.bookings.map((b) => b.ref.value)).toEqual(["BK-001", "BK-100"]);
    expect(r2.bookings[1].items).toHaveLength(1);
  });

  it("parses DD-MM-YYYY text, Excel serial dates and numeric HS codes", () => {
    const serial = 46331; // 5 Nov 2026
    const row = [...EXAMPLE_B];
    row[0] = "BK-002";
    row[7] = serial;
    const r = parseWorkbook(workbook([EXAMPLE_B, row], [EXAMPLE_I, ["BK-002", ...EXAMPLE_I.slice(1)]]));
    expect(r.bookings[0].readyDate.value).toBe("2026-11-05");
    expect(r.bookings[1].readyDate.value).toBe("2026-11-05");
    expect(r.bookings[0].items[0].hsCode.value).toBe("691200");
  });

  it("flags duplicates and unmatched items without merging", () => {
    const dup = [...EXAMPLE_B];
    dup[1] = "Other Seller";
    const r = parseWorkbook(workbook([EXAMPLE_B, dup], [EXAMPLE_I, ["BK-999", "Z", "Thing", 123456, 1, 1, 1, 1, 1, "China"]]));
    expect(r.duplicateRefs).toEqual(["BK-001"]);
    expect(r.bookings).toHaveLength(2);
    expect(r.unmatchedItems).toHaveLength(1);
    expect(analyze(r.bookings[1], TODAY).findings.some((f) => f.key === "DATA:booking.duplicate")).toBe(true);
  });

  it("rejects a non-Excel file with a clear message", () => {
    const r = parseWorkbook(new TextEncoder().encode("hello world"));
    expect(r.bookings).toHaveLength(0);
    expect(r.fileErrors.length).toBeGreaterThan(0);
  });

  it("reads the real template if present", () => {
    const p = "public/Case2_Shipment_Booking_Test_Data_Format.xlsx";
    if (!existsSync(p)) return;
    const r = parseWorkbook(new Uint8Array(readFileSync(p)));
    expect(r.fileErrors).toEqual([]);
    expect(r.bookings[0].ref.value).toBe("BK-001");
    expect(analyze(r.bookings[0], TODAY).verdict).toBe("passed");
  });
});
