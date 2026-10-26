import { describe, expect, it } from "vitest";
import { analyze } from "@/core/analyze";
import { applyChatEdits, nextAsk, offlineItemNote, parseLocally, resolveRelativeDate, stageProgress } from "@/core/chat";
import { emptyChatBooking } from "@/core/edit";
import { commit, newWorkspace } from "@/core/workspace";
import { TODAY } from "./helpers";

const fresh = () => emptyChatBooking("c1");

function filled() {
  return applyChatEdits(fresh(), [
    { op: "set_field", field: "originCity", value: "Manchester" },
    { op: "set_field", field: "destCity", value: "Frankfurt" },
    { op: "set_field", field: "destinationType", value: "Warehouse" },
    { op: "set_field", field: "readyDate", value: "30-10-2026" },
    { op: "set_field", field: "sellerPriority", value: "Cheapest" },
    { op: "set_field", field: "pallets", value: 3 },
    { op: "set_field", field: "grossWeight", value: 620 },
    { op: "set_field", field: "appointment", value: "Yes" },
    { op: "set_field", field: "sellerName", value: "Northfield Goods" },
    { op: "add_item", item: { description: "Ceramic mug", quantity: 1080, unitPrice: 5, unitsPerCarton: 12, unitWeight: 0.5, hsCode: "691200", countryOfOrigin: "United Kingdom" } },
  ]).booking;
}

describe("chat edits", () => {
  it("a complete conversation reaches a passed booking with calculated totals", () => {
    const b = filled();
    expect(b.destCountry.value).toBe("Germany");
    expect(b.items[0].cartons.value).toBe(90);
    expect(b.cartons).toMatchObject({ value: 90, source: "calculated" });
    expect(b.declaredValue).toMatchObject({ value: 5400, source: "calculated" });
    expect(nextAsk(b)).toBeNull();
    expect(analyze(b, TODAY).verdict).toBe("passed");
  });

  it("changing a quantity recalculates the calculated totals", () => {
    const b = applyChatEdits(filled(), [{ op: "update_item", itemId: "it-1", field: "quantity", value: 1200 }]).booking;
    expect(b.items[0].cartons.value).toBe(100);
    expect(b.cartons.value).toBe(100);
    expect(b.declaredValue.value).toBe(6000);
  });

  it("add a pallet twice adds two pallets and re-runs the carrier", () => {
    let b = filled();
    b = applyChatEdits(b, [{ op: "adjust_number", field: "pallets", delta: 1 }]).booking;
    b = applyChatEdits(b, [{ op: "adjust_number", field: "pallets", delta: 1 }]).booking;
    expect(b.pallets.value).toBe(5);
    expect(analyze(b, TODAY).carrier.perPallet).toBe(124);
  });

  it("adding to an unknown pallet count is rejected, not guessed", () => {
    const r = applyChatEdits(fresh(), [{ op: "adjust_number", field: "pallets", delta: 1 }]);
    expect(r.rejected.length).toBe(1);
    expect(r.booking.pallets.value).toBeNull();
  });

  it("an unsupported city is rejected with the valid options", () => {
    const r = applyChatEdits(filled(), [{ op: "set_field", field: "destCity", value: "Madrid" }]);
    expect(r.rejected[0]).toMatch(/Madrid/);
    expect(r.booking.destCity.value).toBe("Frankfurt");
  });

  it("'I don't know the HS code' for an item added in the same message", () => {
    const r = applyChatEdits(filled(), [
      { op: "add_item", item: { description: "Bluetooth speaker", quantity: 200, unitPrice: 20, unitsPerCarton: 10, unitWeight: 0.4, countryOfOrigin: "China" } },
      { op: "mark_unknown", field: "hsCode", itemId: "it-99" },
    ]);
    expect(r.booking.items[1].hsCode.status).toBe("unknown");
    expect(nextAsk(r.booking)).toBeNull(); // not asked again
    expect(analyze(r.booking, TODAY).verdict).toBe("blocked"); // still can't pass without an HS code
  });

  it("an explicit carrier choice is honoured and checked", () => {
    const r = applyChatEdits(filled(), [{ op: "choose_carrier", carrier: "Carrier C" }]);
    expect(analyze(r.booking, TODAY).carrier.selected?.option.carrier).toBe("Carrier C");
  });

  it("ignores junk operations without crashing", () => {
    const r = applyChatEdits(filled(), [
      { op: "set_field", field: "hacked", value: 1 },
      { op: "update_item", itemId: "nope", field: "quantity", value: 1 } as never,
      { op: "set_field", field: "pallets", value: "lots" },
    ]);
    expect(r.booking.pallets.value).toBe(3);
  });

  it("the change log records what a chat change did", () => {
    const b = filled();
    const ws = commit(newWorkspace(b), applyChatEdits(b, [{ op: "set_field", field: "grossWeight", value: 1860 }]).booking, "chat", "chat", TODAY);
    expect(ws.log[0].carrierBefore).toMatch(/Carrier A/);
    expect(ws.log[0].carrierAfter).toMatch(/Carrier B/);
  });
});

describe("questions", () => {
  it("asks route questions first, at most three at a time", () => {
    const a = nextAsk(fresh())!;
    expect(a.keys).toEqual(["originCity", "destCity", "destinationType"]);
  });
  it("groups an item's missing fields into one sentence", () => {
    const b = applyChatEdits(filled(), [{ op: "add_item", item: { description: "Tea towel" } }]).booking;
    expect(nextAsk(b)!.text).toMatch(/^For the Tea towel, I still need the quantity, unit price/);
  });
});

describe("offline parser", () => {
  it("understands a full first message", () => {
    const e = parseLocally("Sending 3 pallets of mugs from Manchester to an Amazon warehouse in Frankfurt, ready next Friday. Cheapest please.", fresh(), [], TODAY);
    const b = applyChatEdits(fresh(), e).booking;
    expect(b.pallets.value).toBe(3);
    expect(b.originCity.value).toBe("Manchester");
    expect(b.destCity.value).toBe("Frankfurt");
    expect(b.destinationType.value).toBe("Warehouse");
    expect(b.sellerPriority.value).toBe("Cheapest");
    expect(b.readyDate.value).toBe("2026-10-30");
  });
  it("add a pallet / half a tonne / yes to the appointment", () => {
    const b = filled();
    expect(parseLocally("add a pallet", b, [], TODAY)).toContainEqual({ op: "adjust_number", field: "pallets", delta: 1 });
    expect(parseLocally("about half a tonne", b, ["grossWeight"], TODAY)).toContainEqual({ op: "set_field", field: "grossWeight", value: 500 });
    expect(parseLocally("yes it's booked", b, ["appointment"], TODAY)).toContainEqual({ op: "set_field", field: "appointment", value: "Yes" });
  });
  it("relative dates", () => {
    expect(resolveRelativeDate("tomorrow", TODAY)).toBe("2026-10-27");
    expect(resolveRelativeDate("on 5th Nov", TODAY)).toBe("2026-11-05");
    expect(resolveRelativeDate("in 2 weeks", TODAY)).toBe("2026-11-09");
  });
});

describe("AI-unavailable fallback", () => {
  it("never creates a product from a natural first message", () => {
    const msg = "Sending 1080 ceramic mugs at £5 each, 12 per carton, from Manchester to Frankfurt";
    const e = parseLocally(msg, fresh(), [], TODAY);
    expect(e.some((x) => x.op === "add_item")).toBe(false);
    expect(offlineItemNote(msg, e, fresh(), [])).toMatch(/haven't added any products/);
  });
  it("route, load, date and priority still parse offline", () => {
    const e = parseLocally("2 pallets, 450 kg total, Leeds to Paris, business address, ready tomorrow, fastest", fresh(), [], TODAY);
    const b = applyChatEdits(fresh(), e).booking;
    expect([b.pallets.value, b.grossWeight.value, b.originCity.value, b.destCity.value, b.destinationType.value, b.readyDate.value, b.sellerPriority.value]).toEqual([
      2, 450, "Leeds", "Paris", "Business address", "2026-10-27", "Fastest",
    ]);
  });
  it("no product note for messages that aren't about goods", () => {
    expect(offlineItemNote("add a pallet", [{ op: "adjust_number", field: "pallets", delta: 1 }], filled(), [])).toBeNull();
  });
  it("stage progress follows the missing questions", () => {
    const p = stageProgress(fresh());
    expect(p.map((x) => x.stage)).toEqual(["Route", "Goods", "Load", "Delivery"]);
    expect(stageProgress(filled()).every((x) => x.open === 0)).toBe(true);
  });
});

describe("fallback note stays quiet for non-goods changes", () => {
  it("'add a pallet' while goods are being asked doesn't repeat the products note", () => {
    const e = [{ op: "adjust_number" as const, field: "pallets", delta: 1 }];
    expect(offlineItemNote("add a pallet", e, fresh(), ["items"])).toBeNull();
  });
  it("an unparsed reply to the goods question gets the note", () => {
    expect(offlineItemNote("some lovely mugs", [], fresh(), ["items"])).toMatch(/Goods section/);
  });
});
