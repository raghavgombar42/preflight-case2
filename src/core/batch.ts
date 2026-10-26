// One operational sentence for an uploaded batch, derived from the analyses:
// how many shipments need action, how many are ready, and where to start.

import type { Analysis } from "./analyze";

export type BatchRow = { uid: string; ref: string; analysis: Analysis };
export type BatchAction = { sentence: string; start?: { uid: string; text: string } };

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// Rows are expected in queue order (most urgent first).
export function batchAction(rows: BatchRow[]): BatchAction {
  const count = (v: Analysis["verdict"]) => rows.filter((r) => r.analysis.verdict === v).length;
  const blocked = count("blocked");
  const incomplete = count("incomplete");
  const warnings = count("warnings");
  const ready = count("passed");
  const action = blocked + incomplete;

  if (rows.length === 0) return { sentence: "No bookings found in this file." };

  if (action > 0) {
    const readyPart = ready > 0 ? `; ${ready} ${plural(ready, "is", "are")} ready for booking` : "";
    const sentence = `${action} ${plural(action, "shipment needs", "shipments need")} action before collection${readyPart}.`;

    // Prefer a blocked booking where one fix clears several blocking issues.
    const multi = rows
      .filter((r) => r.analysis.verdict === "blocked")
      .map((r) => {
        const reds = new Set(r.analysis.findings.filter((f) => f.severity === "red").map((f) => f.key));
        const best = Math.max(0, ...r.analysis.findings.flatMap((f) => f.fix.actions.map((a) => (a.resolves ?? []).filter((k) => reds.has(k)).length)));
        return { r, best };
      })
      .find((x) => x.best >= 2);
    if (multi) {
      return { sentence, start: { uid: multi.r.uid, text: `Start with ${multi.r.ref}: one fix clears ${word(multi.best)} blocking issues.` } };
    }
    const first = rows.find((r) => r.analysis.verdict === "blocked" || r.analysis.verdict === "incomplete")!;
    const top = first.analysis.findings[0];
    return {
      sentence,
      start: { uid: first.uid, text: top ? `Start with ${first.ref}: ${top.title.charAt(0).toLowerCase()}${top.title.slice(1)}.` : `Start with ${first.ref}.` },
    };
  }

  if (warnings > 0) {
    const first = rows.find((r) => r.analysis.verdict === "warnings")!;
    return {
      sentence: `Nothing is blocked. ${warnings} ${plural(warnings, "shipment has", "shipments have")} warnings to review; ${ready} ${plural(ready, "is", "are")} ready for booking.`,
      start: { uid: first.uid, text: `Review ${first.ref} first.` },
    };
  }
  return { sentence: `All ${rows.length} ${plural(rows.length, "shipment is", "shipments are")} ready for booking.` };
}
