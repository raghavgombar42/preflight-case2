# Pre-Flight · UK → EU shipment booking & error checker

Case 2, Mesa AI × Ops Hackathon (October 2026). Live: https://preflight-case2-sepia.vercel.app

Book a pallet shipment by chat or by uploading the official Bookings + Items workbook. Every booking is checked against the 10-rule rulebook, each problem shows its evidence, where the shipment would fail and a fix labelled by confidence, and the carrier is chosen to fit the seller's priority.

## Pages

- `/book`: conversational booking. The model (Gemini via OpenRouter or Google) only proposes structured edits; code validates and applies them, decides what is still missing and re-runs every check after each message. Falls back to a deterministic parser and an editable form if the model is unavailable.
- `/check`: upload → review queue (Blocked → Incomplete → Warnings → Ready) → booking detail with one-click fixes, undo, change log and print view. Files are parsed in the browser; nothing is stored on a server.
- `/how-it-works`: rules, rate card, decisions and assumptions.

## Code

```
src/core/      pure, tested business logic (no React)
  config.ts      allowed values, rate card, rulebook, R-06 phrase lists
  model.ts       booking model: raw value, clean value, status and source per field
  values.ts      normalisers (strict DD-MM-YYYY, HS codes, numbers), IST date
  workbook.ts    reads the template by sheet and header name, keeps row numbers
  edit.ts        immutable patches, calculated totals for chat, diffs
  carrier.ts     eligibility by weight, priority ranking, minimax regret, repack scenarios
  rules.ts       R-01 … R-10 + data completeness
  analyze.ts     verdict, fix advisor (simulates each fix), advisories, timeline
  chat.ts        chat edit validation, next question, offline parser
  workspace.ts   original + working copy, undo, change log
src/ui/        shared React components (booking view, field editor)
src/app/       pages and /api/chat
tests/         vitest suites (rules, boundaries, multi-rule fixes, parser, chat)
scripts/make-sample.mjs   builds public/sample-bookings.xlsx from the template
```

## Run

```sh
npm install
npm test          # vitest
npm run dev
```

Environment (Vercel): `OPENROUTER_API_KEY` + `OPENROUTER_MODEL`, or `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`). Without a key the chat runs in offline mode.

See `DECISIONS.md` for every assumption.
