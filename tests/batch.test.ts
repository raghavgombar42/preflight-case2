import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze } from "@/core/analyze";
import { batchAction } from "@/core/batch";
import { parseWorkbook } from "@/core/workbook";
import { TODAY, booking } from "./helpers";

const ORDER = { blocked: 0, incomplete: 1, warnings: 2, passed: 3 } as const;
const rowsOf = (bs: ReturnType<typeof booking>[]) =>
  bs
    .map((b, i) => ({ uid: `u${i}`, ref: b.ref.value ?? "?", analysis: analyze(b, TODAY) }))
    .sort((x, y) => ORDER[x.analysis.verdict] - ORDER[y.analysis.verdict]);

describe("batch action line", () => {
  it("sample workbook: 8 need action, 4 ready, start with BK-003", () => {
    const r = parseWorkbook(new Uint8Array(readFileSync("public/sample-bookings.xlsx")));
    const rows = r.bookings
      .map((b) => ({ uid: b.uid, ref: b.ref.value!, analysis: analyze(b, TODAY) }))
      .sort((x, y) => ORDER[x.analysis.verdict] - ORDER[y.analysis.verdict] || (x.analysis.booking.sourceRow ?? 0) - (y.analysis.booking.sourceRow ?? 0));
    const a = batchAction(rows);
    expect(a.sentence).toBe("8 shipments need action before collection; 4 are ready for booking.");
    expect(a.start?.text).toBe("Start with BK-003: one fix clears two blocking issues.");
  });
  it("falls back to the first blocked booking's top issue", () => {
    const a = batchAction(rowsOf([booking({ ref: "BK-9", cartons: 95 })]));
    expect(a.sentence).toBe("1 shipment needs action before collection.");
    expect(a.start?.text).toMatch(/^Start with BK-9: booking says 95 cartons/);
  });
  it("warnings only, and all ready", () => {
    expect(batchAction(rowsOf([booking({ appointment: "No" }), booking()])).sentence).toBe(
      "Nothing is blocked. 1 shipment has warnings to review; 1 is ready for booking."
    );
    expect(batchAction(rowsOf([booking(), booking()])).sentence).toBe("All 2 shipments are ready for booking.");
  });
});
