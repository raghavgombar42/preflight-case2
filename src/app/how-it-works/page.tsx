import type { Metadata } from "next";
import { RATE_CARD, RULES } from "@/core/config";

export const metadata: Metadata = { title: "How it works · Pre-Flight" };

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

export default function Page() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">How it works</h1>
        <p className="mt-2 text-ink-2">
          Every check, total and carrier ranking is computed by deterministic code from the official rulebook and rate card, so the same booking
          always gets the same answer. AI is used only to turn chat messages into structured edits; those edits are validated before anything
          changes, and the app keeps working (via a guided form) if the AI is unavailable.
        </p>
      </div>

      <section className="rounded-xl border border-line bg-white">
        <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Flow</h2>
        <ol className="grid gap-px bg-line sm:grid-cols-5">
          {[
            ["Input", "Chat message or uploaded Bookings + Items sheets"],
            ["One booking model", "Raw value, clean value and source kept for every field"],
            ["Checks", "10 rules + missing-detail check, each with evidence"],
            ["Carrier", "Eligible by weight first, then ranked by priority"],
            ["Result", "Verdict, fixes, carrier, confirmation and next steps"],
          ].map(([t, d], i) => (
            <li key={t} className="bg-white p-4">
              <div className="text-xs font-semibold text-brand">Step {i + 1}</div>
              <div className="font-medium">{t}</div>
              <div className="text-sm text-ink-2">{d}</div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-line bg-white">
        <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Rulebook</h2>
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
      </section>

      <section className="rounded-xl border border-line bg-white">
        <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Rate card (fixed)</h2>
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
          Weight bands: up to 400 kg per pallet all three services are eligible; 400–500 kg Economy and Standard; 500–750 kg Standard only; above
          750 kg none.
        </p>
      </section>

      <section className="rounded-xl border border-line bg-white">
        <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Decisions and assumptions</h2>
        <dl className="divide-y divide-line">
          {ASSUMPTIONS.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[200px_minmax(0,1fr)]">
              <dt className="font-medium">{k}</dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
