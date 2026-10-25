// Turns one seller message into structured booking edits using Gemini.
// The model never sees rule outcomes and never computes totals; the browser
// validates and applies whatever comes back. Any failure returns
// { ok: false } so the client can fall back to its deterministic parser.

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CHAT_OPS } from "@/core/chat";
import { ALL_DEST_CITIES, DEST_CITIES, ITEM_ORIGINS, ORIGIN_CITIES } from "@/core/config";
import { istToday } from "@/core/values";

export const maxDuration = 60;

const scalar = z.union([z.string(), z.number()]).nullable().optional();

const responseSchema = z.object({
  edits: z
    .array(
      z.object({
        op: z.enum(CHAT_OPS),
        field: z.string().nullable().optional(),
        value: scalar,
        delta: z.number().nullable().optional(),
        itemId: z.string().nullable().optional(),
        item: z
          .object({
            sku: scalar,
            description: scalar,
            hsCode: scalar,
            quantity: scalar,
            unitPrice: scalar,
            unitsPerCarton: scalar,
            cartons: scalar,
            unitWeight: scalar,
            countryOfOrigin: scalar,
          })
          .nullable()
          .optional(),
        carrier: z.string().nullable().optional(),
        question: z.string().nullable().optional(),
      })
    )
    .max(40),
  reply: z.string().max(600),
});

const requestSchema = z.object({
  message: z.string().min(1).max(2000),
  booking: z.unknown(),
  asked: z.array(z.string()).max(10).optional(),
});

function system(today: string) {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `You turn a seller's message into edits on a UK → EU freight booking. Return JSON only.

TODAY is ${weekday} ${today} (India time). Resolve relative dates ("next Friday", "in 3 days", "5th Nov") to DD-MM-YYYY. "Friday"/"next Friday" = the coming Friday.

OPERATIONS
- set_field {field, value}: booking fields: sellerName, originCity, destCity, destinationType, readyDate, sellerPriority, pallets, grossWeight, appointment, cartons, declaredValue.
  Only set cartons or declaredValue if the seller explicitly states a TOTAL for the whole shipment. Never calculate totals yourself.
- adjust_number {field, delta}: relative changes, e.g. "add a pallet" → field "pallets", delta 1; "two fewer pallets" → delta -2. Fields: pallets, grossWeight, cartons, declaredValue.
- add_item {item:{sku, description, hsCode, quantity, unitPrice, unitsPerCarton, cartons, unitWeight, countryOfOrigin}}: a NEW product line. Only fill what the seller said.
- update_item {itemId, field, value}: change an EXISTING product. itemId must be one of the itemIds in the booking. Match "the mugs" etc. by description.
- remove_item {itemId}
- mark_unknown {field, itemId?}: the seller says they don't know something (e.g. HS code).
- choose_carrier {carrier}: only if the seller explicitly names "Carrier A", "Carrier B" or "Carrier C" (Economy = A, Standard = B, Express = C). carrier null clears it.
- confirm_no_battery {itemId}: the seller confirms a product contains no battery.
- clarify {question}: the message is ambiguous (e.g. "the mug" could be two items). Ask one short question.

ALLOWED VALUES (use these exact spellings)
- originCity: ${ORIGIN_CITIES.join(", ")} (origin country is always United Kingdom)
- destCity: ${Object.entries(DEST_CITIES).map(([c, cs]) => `${cs.join("/")} (${c})`).join("; ")}
- destinationType: Warehouse (fulfilment/distribution centre, e.g. an Amazon warehouse) or Business address (shop, office)
- sellerPriority: Cheapest, Fastest, Most reliable, Balanced
- appointment: Yes or No
- countryOfOrigin: ${ITEM_ORIGINS.join(", ")} (where the product was MADE)
If the seller names a city outside these lists, still pass it through with set_field so the app can explain; never substitute another city.

UNITS
- Weights in kg. "half a tonne" = 500, "1.2 tonnes" = 1200. Unit weight "500 g each" = 0.5.
- Money in GBP numbers without the £ sign.
- grossWeight is the TOTAL shipment weight; unitWeight is per single unit.
- "12 per carton/box" = unitsPerCarton 12. "90 cartons of mugs" = item cartons 90.

RULES
- Never invent values the seller did not say. Never guess HS codes.
- Several facts in one message → several edits.
- reply: one short, friendly sentence acknowledging what you understood. Do NOT ask for missing information (the app does that), unless you used clarify.
- Greetings or small talk → no edits, a short reply.`;
}

const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  h.n += 1;
  return h.n > 40;
}

// OpenRouter (OpenAI-compatible) route to Gemini, used when only an
// OPENROUTER_API_KEY is configured.
async function viaOpenRouter(key: string, model: string, sys: string, prompt: string) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Pre-Flight" },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${sys}\n\nRespond with a single JSON object: {"edits": [ {op, field?, value?, delta?, itemId?, item?, carrier?, question?} ], "reply": string}. No markdown.`,
        },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text: string = j?.choices?.[0]?.message?.content ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return responseSchema.parse(JSON.parse(json));
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey && !orKey) return NextResponse.json({ ok: false, reason: "no-key" });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return NextResponse.json({ ok: false, reason: "rate-limited" });

  let body: z.infer<typeof requestSchema>;
  try {
    const raw = await req.text();
    if (raw.length > 100_000) return NextResponse.json({ ok: false, reason: "too-large" });
    body = requestSchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, reason: "bad-request" }, { status: 400 });
  }

  const today = istToday();
  const prompt = `Current booking (values null = not provided yet; "UNKNOWN" = seller said they don't know):
${JSON.stringify(body.booking).slice(0, 20000)}

The app last asked the seller about: ${(body.asked ?? []).join(", ") || "nothing yet"}.
Valid destination cities: ${ALL_DEST_CITIES.join(", ")}.

Seller message:
"""${body.message}"""`;

  if (apiKey) {
    const google = createGoogleGenerativeAI({ apiKey });
    const models = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []).concat(["gemini-3.8-flash", "gemini-3-flash", "gemini-2.5-flash"]);
    for (const model of [...new Set(models)]) {
      try {
        const { object } = await generateObject({
          model: google(model),
          schema: responseSchema,
          system: system(today),
          prompt,
          temperature: 0,
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(20_000),
        });
        return NextResponse.json({ ok: true, model, edits: object.edits, reply: object.reply });
      } catch (e) {
        console.error(`chat model ${model} failed:`, (e as Error).message);
      }
    }
  }
  if (orKey) {
    const models = (process.env.OPENROUTER_MODEL ? [process.env.OPENROUTER_MODEL] : []).concat(["google/gemini-2.5-flash", "google/gemini-2.0-flash-001"]);
    for (const model of [...new Set(models)]) {
      try {
        const object = await viaOpenRouter(orKey, model, system(today), prompt);
        return NextResponse.json({ ok: true, model, edits: object.edits, reply: object.reply });
      } catch (e) {
        console.error(`openrouter ${model} failed:`, (e as Error).message);
      }
    }
  }
  return NextResponse.json({ ok: false, reason: "model-error" });
}
