import type { Metadata } from "next";
import { RATE_CARD, RULES } from "@/core/config";

export const metadata: Metadata = { title: "How it works · Wheels Up" };

const ASSUMPTIONS = [
  ["R-02 tolerance", "“Within 1%” is measured against the item total: |declared − Σ(qty × price)| ÷ Σ ≤ 1%. Exactly 1% passes. Compared in pence."],
  ["R-05 and the “chosen carrier”", "The sheet has no chosen-carrier column, and a seller priority is not a carrier choice. R-05 is checked against the carrier we select (or the one the seller explicitly names in chat). If the seller's ideal service can't take the weight but another can, R-05 passes and we show a trade-off notice instead of blocking a shipment that can travel."],
  ["Balanced priority", "Minimax regret over the services that can carry the weight: for cost, transit days and on-time rate, each option's distance from the best option is scaled 0–100% of the range; we pick the option whose biggest sacrifice is smallest. Ties go to the smaller total sacrifice, then cheaper, then faster. Recomputed every time, never hardcoded."],
  ["Weight limits", "Weight per pallet = gross weight ÷ pallets, rounded to 0.01 kg. A limit is inclusive: exactly 500 kg is accepted by a 500 kg service; 750.01 kg is accepted by none."],
  ["Repacking scenarios", "Shown separately and only applied when the seller approves. Gross weight is kept unchanged (the data has no pallet tare weight), and the scenario says so."],
  ["Transit and dates", "Transit days are treated as calendar days, so delivery dates are estimates. “Today” is the current date in India (IST); a ready date of today passes R-10."],
  ["Dangerous goods (R-06)", "Whole-word phrase matching on descriptions, with negations removed first (“battery-free”, “phone case”, “empty bottle”). Devices that usually contain a lithium battery (laptops, phones, speakers…) are flagged Red until the seller confirms there's no battery."],
  ["HS codes", "Spaces and dots are ignored (6912.00 → 691200). A 5-digit code is flagged with a note that Excel may have dropped a leading zero; it is never padded automatically."],
  ["Fix confidence", "Arithmetic correction: a total recomputed from the item lines. Evidence-supported: the only option the rest of the booking agrees with (e.g. the quantity that also matches the declared value). Needs seller confirmation: facts only the seller knows. Nothing is changed without the seller's click, and every change can be undone."],
  ["Verdict", "Blocked (any red) → Incomplete (missing details) → Passed with warnings (amber only) → Passed. The final state is “Ready for booking”: this MVP does not place the order with a carrier."],
];

const STEPS = [
  { t: "Input", d: "Chat or the Bookings + Items workbook" },
  { t: "Booking model", d: "Raw value, clean value and source per field" },
  { t: "10 checks", d: "Plus missing details, each with evidence" },
  { t: "Carrier", d: "Eligible by weight, then ranked by priority" },
  { t: "Result", d: "Verdict, fixes, carrier and next steps" },
];

function Disclosure({ title, sub, children, open }: { title: string; sub: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="group rounded-2xl bg-white ring-1 ring-line" open={open}>
      <summary className="flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-ink-3">{sub}</p>
        </div>
        <span className="text-sm font-medium text-brand group-open:hidden">Show</span>
        <span className="hidden text-sm font-medium text-brand group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}

export default function Page() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 py-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">How it works</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          Code decides, AI only talks. Every check, total and ranking comes from the official rulebook and rate card, so the same booking always gets the
          same answer.
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-5" aria-label="Five-step flow">
        {STEPS.map((s, i) => (
          <li key={s.t} className="relative rounded-2xl bg-white p-4 ring-1 ring-line">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-xs font-semibold text-white" aria-hidden>
              {i + 1}
            </span>
            <div className="mt-3 font-semibold">{s.t}</div>
            <div className="mt-1 text-sm text-ink-2">{s.d}</div>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["AI’s only job", "Turn a chat message into proposed edits. Code validates each one before anything changes."],
          ["If AI is down", "A built-in parser and the guided booking fields take over. Every check still runs."],
          ["Nothing silent", "Fixes need the seller’s click, every change is logged, and the upload is never modified."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl bg-canvas p-4">
            <div className="text-sm font-semibold">{t}</div>
            <div className="mt-1 text-sm text-ink-2">{d}</div>
          </div>
        ))}
      </div>

      <Disclosure title="Decisions and assumptions" sub={`${ASSUMPTIONS.length} judgement calls, each written down`}>
        <dl className="divide-y divide-line">
          {ASSUMPTIONS.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[200px_minmax(0,1fr)]">
              <dt className="font-medium">{k}</dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>

      <Disclosure title="Rulebook" sub="R-01 to R-10 · six Red (block), four Amber (warn)">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {RULES.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-2.5 align-top font-mono text-xs font-semibold">{r.id}</td>
                <td className="px-2 py-2.5">
                  <div>{r.rule}</div>
                  <div className="text-xs text-ink-3">{r.consequence}</div>
                </td>
                <td className={`px-5 py-2.5 align-top text-xs font-semibold ${r.severity === "red" ? "text-red" : "text-amber"}`}>{r.severity === "red" ? "Red" : "Amber"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Disclosure>

      <Disclosure title="Rate card" sub="Fixed · 3 services × 3 destination countries">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-canvas text-left text-xs text-ink-3">
              <tr>
                <th className="px-5 py-2 font-medium">Carrier</th>
                <th className="px-2 py-2 font-medium">Route</th>
                <th className="px-2 py-2 text-right font-medium">£ / pallet</th>
                <th className="px-2 py-2 text-right font-medium">Transit</th>
                <th className="px-2 py-2 text-right font-medium">On-time</th>
                <th className="px-5 py-2 text-right font-medium">Max kg / pallet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tnum">
              {RATE_CARD.map((o) => (
                <tr key={`${o.carrier}-${o.destCountry}`}>
                  <td className="px-5 py-2">
                    {o.carrier} <span className="text-ink-3">{o.service}</span>
                  </td>
                  <td className="px-2 py-2">UK → {o.destCountry}</td>
                  <td className="px-2 py-2 text-right">£{o.pricePerPallet}</td>
                  <td className="px-2 py-2 text-right">{o.transitDays} days</td>
                  <td className="px-2 py-2 text-right">{o.onTimeRate}%</td>
                  <td className="px-5 py-2 text-right">{o.maxKgPerPallet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-ink-3">
          Weight bands: up to 400 kg per pallet all three services qualify; 400–500 kg Economy and Standard; 500–750 kg Standard only; above 750 kg none.
        </p>
      </Disclosure>
    </div>
  );
}
