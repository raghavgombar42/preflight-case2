# Decisions & assumptions

| # | Decision | Why | How we'd validate it in the real world |
|---|---|---|---|
| A1 | R-02: \|declared − Σ(qty × price)\| ÷ Σ ≤ 1%, exactly 1% passes, compared in pence | Rule says "within 1%" without a base | Confirm with the forwarder's customs team (a broker told us real tolerance is zero, so we also show an advisory when the value isn't exact) |
| A2 | R-05 is checked against the selected carrier: the seller's explicit choice in chat, otherwise our recommendation. A priority is not a carrier choice | No chosen-carrier column in the data | Observe how sellers pick services today |
| A3 | Balanced = minimax regret over eligible services (cost, transit, on-time scaled to the eligible range); tie-break on total regret, then cost, transit, on-time, name | "Best trade-off" with no weights; equal-weight scoring is a knife-edge that flips when an option drops out | Ask sellers to rank trade-offs; compare with forwarder recommendations |
| A4 | Weight per pallet rounded to 0.01 kg; limits inclusive (500 kg passes a 500 kg service, 750.01 kg fails all) | Rulebook says "must not exceed" | Carrier terms |
| A5 | Repack scenarios keep gross weight unchanged and are applied only on seller approval | No pallet tare weight in the data | Measure pallet tare |
| A6 | Transit days are calendar days; delivery dates are estimates | Rate card gives days only | Carrier SLAs |
| A7 | "Today" is the current date in IST, recomputed in the browser | Judges test in India; servers run in UTC | n/a |
| A8 | R-06: whole-word phrase match after removing negations ("battery-free", "phone case", empty containers); devices likely to contain a lithium battery are Red until the seller confirms none | Free-text descriptions; carriers reject batteries loose or built in | Compare with the carrier's dangerous-goods list |
| A9 | A 5-digit HS code is flagged with a leading-zero note, never padded automatically | Could be a lost zero or a wrong code | UK Trade Tariff lookup |
| A10 | Fix labels: Arithmetic correction / Evidence-supported / Needs seller confirmation. Nothing changes without a click; every change can be undone; the uploaded original is never modified | Avoid false certainty; seller is liable for declarations | User testing |
| A11 | Rules never produce "incomplete" themselves; a separate completeness check names each missing field. A rule that can't be checked never counts as a pass | Missing data must not look like a pass | n/a |
| A12 | Template example row (BK-001) is processed like any booking and tagged | Never drop judge data by position | n/a |
| A13 | Final state is "Ready for booking", never "Booked" | No carrier integration | n/a |
| A14 | In chat, cartons and declared value are calculated from the items unless the seller states a total; stated totals are checked like uploads | Prevent drift; still detect seller mistakes | n/a |
| B1 | Stateless: uploads are parsed in the browser; no database | Nothing to break or leak; no size limits on the server | n/a |
| B2 | The model only returns structured edits, which are validated against allowed values before anything changes. If edits are rejected, the reply shows what actually happened | Prevent hallucinated changes | n/a |
