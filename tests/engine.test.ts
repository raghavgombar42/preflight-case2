import { describe, expect, it } from "vitest";
import { analyze } from "@/core/analyze";
import { decideCarrier, rankOptions } from "@/core/carrier";
import { routeOptions } from "@/core/config";
import { applyPatch } from "@/core/edit";
import { r06Match } from "@/core/rules";
import { TODAY, booking } from "./helpers";

const run = (b = booking()) => analyze(b, TODAY);
const keys = (a: ReturnType<typeof run>) => a.findings.map((f) => f.key);
const status = (a: ReturnType<typeof run>, id: string) => a.rules.find((r) => r.id === id)!.status;

describe("template example", () => {
  it("BK-001 passes every rule while its ready date is in the future", () => {
    const a = run();
    expect(a.verdict).toBe("passed");
    expect(a.rules.every((r) => r.status === "pass")).toBe(true);
    expect(a.carrier.recommended?.option.carrier).toBe("Carrier A");
  });
  it("is not hardcoded as clean: after 5 Nov R-10 fires", () => {
    const a = analyze(booking(), "2026-11-06");
    expect(a.verdict).toBe("warnings");
    expect(keys(a)).toContain("R-10:booking");
  });
});

describe("each rule fires on its own", () => {
  it("R-01 missing HS", () => {
    const a = run(booking({}, [{ hsCode: null }]));
    expect(keys(a)).toEqual(["R-01:it-1"]);
    expect(a.verdict).toBe("blocked");
  });
  it("R-01 five digits gets the leading-zero note, not repaired", () => {
    const a = run(booking({}, [{ hsCode: 90111 }]));
    const f = a.findings.find((x) => x.ruleId === "R-01")!;
    expect(f.detail).toMatch(/leading 0/);
    expect(a.booking.items[0].hsCode.value).toBe("90111");
  });
  it("R-01 accepts 6912.00 and numeric 691200", () => {
    expect(status(run(booking({}, [{ hsCode: "6912.00" }])), "R-01")).toBe("pass");
    expect(status(run(booking({}, [{ hsCode: 691200 }])), "R-01")).toBe("pass");
  });
  it("R-01 rejects letters", () => {
    expect(status(run(booking({}, [{ hsCode: "69A200" }])), "R-01")).toBe("fail");
  });
  it("R-02 exactly 1% passes, 1.01% fails", () => {
    expect(status(run(booking({ declaredValue: 5454 })), "R-02")).toBe("pass");
    expect(status(run(booking({ declaredValue: 5346 })), "R-02")).toBe("pass");
    expect(status(run(booking({ declaredValue: 5454.55 })), "R-02")).toBe("fail");
  });
  it("R-02 0 and 0 passes without division by zero", () => {
    expect(status(run(booking({ declaredValue: 0 }, [{ unitPrice: 0 }])), "R-02")).toBe("pass");
  });
  it("R-02 alone", () => {
    expect(keys(run(booking({ declaredValue: 6000 })))).toEqual(["R-02:booking"]);
  });
  it("R-03 alone (cartons wrong, booking total right)", () => {
    const a = run(booking({ cartons: 90 }, [{ quantity: 1080, unitsPerCarton: 12, cartons: 91 }]));
    expect(keys(a)).toContain("R-03:it-1");
  });
  it("R-04 alone", () => {
    expect(keys(run(booking({ cartons: 95 })))).toEqual(["R-04:booking"]);
  });
  it("R-05 no eligible carrier above 750 kg per pallet", () => {
    const a = run(booking({ grossWeight: 2400, pallets: 3 }));
    expect(keys(a)).toEqual(["R-05:booking"]);
    expect(a.carrier.status).toBe("no-eligible");
    expect(a.carrier.scenarios.length).toBe(3);
  });
  it("R-06 clear match", () => {
    const a = run(booking({}, [{ description: "Lithium-ion power bank 10000mAh" }]));
    expect(keys(a)).toEqual(["R-06:it-1"]);
  });
  it("R-07 alone", () => {
    expect(keys(run(booking({ grossWeight: 500 })))).toEqual(["R-07:booking"]);
  });
  it("R-07 equal passes", () => {
    expect(status(run(booking({ grossWeight: 540 })), "R-07")).toBe("pass");
  });
  it("R-08 warehouse without appointment; n/a for business address", () => {
    expect(keys(run(booking({ appointment: "No" })))).toEqual(["R-08:booking"]);
    const a = run(booking({ appointment: "No", destinationType: "Business address" }));
    expect(status(a, "R-08")).toBe("na");
    expect(a.verdict).toBe("passed");
  });
  it("R-09 blank origin", () => {
    const a = run(booking({}, [{ countryOfOrigin: null }]));
    expect(keys(a)).toEqual(["R-09:it-1"]);
    expect(a.verdict).toBe("warnings");
  });
  it("R-10 today passes, yesterday warns", () => {
    expect(status(run(booking({ readyDate: "26-10-2026" })), "R-10")).toBe("pass");
    expect(status(run(booking({ readyDate: "25-10-2026" })), "R-10")).toBe("fail");
  });
  it("05-11-2026 is 5 November, not 11 May", () => {
    expect(run().booking.readyDate.value).toBe("2026-11-05");
  });
});

describe("R-06 phrase handling", () => {
  it.each([
    ["Battery-free LED candle", null],
    ["Phone case, silicone", null],
    ["Perfume bottle, empty", null],
    ["Glass perfume bottles, empty", null],
    ["Solvent-free wood glue", null],
    ["Ceramic coffee mug", null],
    ["Aerosol deodorant 150ml", "aerosol"],
    ["Nail polish remover", "flammable"],
    ["Eau de parfum 50 ml", "flammable"],
    ["AA batteries pack of 4", "generic-battery"],
    ["Lithium-ion power bank 10000mAh", "lithium"],
    ["Spare battery pack, chemistry not stated", "generic-battery"],
    ["Bluetooth speaker", "likely-battery"],
    ["Laptop 14 inch", "likely-battery"],
  ])("%s → %s", (desc, kind) => {
    expect(r06Match(desc)?.kind ?? null).toBe(kind);
  });
  it("seller confirmation clears a likely-battery item", () => {
    const b = booking({}, [{ description: "Bluetooth speaker" }]);
    expect(run(b).verdict).toBe("blocked");
    const cleared = applyPatch(b, { kind: "r06Clear", itemId: "it-1" }).booking;
    expect(run(cleared).verdict).toBe("passed");
  });
});

describe("carrier selection", () => {
  const pp = (perPallet: number, priority: string, dest = "Germany") =>
    decideCarrier(booking({ grossWeight: perPallet * 2, pallets: 2, sellerPriority: priority, destCity: { Germany: "Berlin", France: "Paris", Netherlands: "Amsterdam" }[dest], destCountry: dest }));

  it("weight boundaries 400 / 500 / 750 / 750.01", () => {
    expect(pp(400, "Fastest").recommended?.option.carrier).toBe("Carrier C");
    expect(pp(400.01, "Fastest").recommended?.option.carrier).toBe("Carrier B");
    expect(pp(500, "Cheapest").recommended?.option.carrier).toBe("Carrier A");
    expect(pp(500.01, "Cheapest").recommended?.option.carrier).toBe("Carrier B");
    expect(pp(750, "Cheapest").recommended?.option.carrier).toBe("Carrier B");
    expect(pp(750.01, "Cheapest").status).toBe("no-eligible");
  });
  it.each(["Germany", "France", "Netherlands"])("priority × band matrix on %s", (dest) => {
    const expectTable: Record<string, [string, string, string]> = {
      Cheapest: ["Carrier A", "Carrier A", "Carrier B"],
      Fastest: ["Carrier C", "Carrier B", "Carrier B"],
      "Most reliable": ["Carrier C", "Carrier B", "Carrier B"],
      Balanced: ["Carrier B", "Carrier B", "Carrier B"],
    };
    for (const [priority, [low, mid, high]] of Object.entries(expectTable)) {
      expect(pp(300, priority, dest).recommended?.option.carrier).toBe(low);
      expect(pp(450, priority, dest).recommended?.option.carrier).toBe(mid);
      expect(pp(600, priority, dest).recommended?.option.carrier).toBe(high);
    }
  });
  it("Balanced uses minimax regret with total-regret tie-break", () => {
    const all = rankOptions(routeOptions("Germany"), 3, "Balanced");
    expect(all[0].opt.carrier).toBe("Carrier B");
    expect(all[0].regret!.max).toBeCloseTo(0.5);
    const two = rankOptions(routeOptions("Germany").filter((o) => o.carrier !== "Carrier C"), 3, "Balanced");
    expect(two[0].regret!.max).toBe(1);
    expect(two[1].regret!.max).toBe(1);
    expect(two[0].opt.carrier).toBe("Carrier B");
  });
  it("Cheapest at 620 kg/pallet: R-05 passes with B and a trade-off notice is shown", () => {
    const a = run(booking({ grossWeight: 1860, pallets: 3 }, [{}]));
    expect(status(a, "R-05")).toBe("pass");
    expect(a.carrier.recommended?.option.carrier).toBe("Carrier B");
    expect(a.carrier.tradeOff).toMatch(/Carrier A/);
    expect(a.carrier.scenarios[0].pallets).toBe(4);
  });
  it("an explicit carrier choice that is too light fails R-05", () => {
    const b = applyPatch(booking({ grossWeight: 1350, pallets: 3 }), { kind: "chooseCarrier", carrier: "Carrier C" }).booking;
    const a = run(b);
    expect(status(a, "R-05")).toBe("fail");
    expect(a.verdict).toBe("blocked");
  });
  it("pallets zero is incomplete, never a crash", () => {
    const a = run(booking({ pallets: 0 }));
    expect(status(a, "R-05")).toBe("cannot-check");
    expect(a.verdict).toBe("incomplete");
  });
  it("missing priority gives no recommendation and an incomplete verdict", () => {
    const a = run(booking({ sellerPriority: null }));
    expect(a.carrier.recommended).toBeNull();
    expect(a.verdict).toBe("incomplete");
  });
});

describe("multi-rule diagnosis", () => {
  it("M1: a quantity typo is identified with evidence and clears R-02 too", () => {
    const a = run(booking({ declaredValue: 5400 }, [{ quantity: 1000 }]));
    expect(keys(a).sort()).toEqual(["R-02:booking", "R-03:it-1"]);
    const r03 = a.findings.find((f) => f.ruleId === "R-03")!;
    expect(r03.fix.confidence).toBe("evidence");
    expect(r03.fix.actions[0].patches[0]).toMatchObject({ field: "quantity", value: 1080 });
    expect(r03.fix.actions[0].resolves).toEqual(expect.arrayContaining(["R-03:it-1", "R-02:booking"]));
    const r02 = a.findings.find((f) => f.ruleId === "R-02")!;
    expect(r02.fix.text).toMatch(/Likely root cause/);
  });
  it("M2: when evidence doesn't point anywhere, it asks the seller", () => {
    const a = run(booking({ declaredValue: 5000, cartons: 90 }, [{ quantity: 1000 }]));
    const r03 = a.findings.find((f) => f.ruleId === "R-03")!;
    expect(r03.fix.confidence).toBe("confirm");
  });
  it("M3: applying the fix re-evaluates every dependent check together", () => {
    const b = booking({ declaredValue: 5400 }, [{ quantity: 1000 }]);
    const fixed = applyPatch(b, { kind: "item", itemId: "it-1", field: "quantity", value: 1080 }).booking;
    expect(run(fixed).verdict).toBe("passed");
    expect(b.items[0].quantity.value).toBe(1000); // original untouched
  });
});

describe("data completeness", () => {
  it("booking with no items is incomplete", () => {
    expect(run(booking({}, [])).verdict).toBe("incomplete");
  });
  it("city/country mismatch is flagged", () => {
    const a = run(booking({ destCity: "Paris", destCountry: "Germany" }));
    expect(a.findings.some((f) => f.key === "DATA:booking.cityCountry")).toBe(true);
  });
  it("two items with the same SKU stay separate rows", () => {
    const a = run(booking({ cartons: 180, declaredValue: 10800, grossWeight: 1300, pallets: 4 }, [{}, {}]));
    expect(a.booking.items.map((i) => i.id)).toEqual(["it-1", "it-2"]);
    const edited = applyPatch(a.booking, { kind: "item", itemId: "it-2", field: "quantity", value: 1 }).booking;
    expect(edited.items[0].quantity.value).toBe(1080);
  });
});

describe("advisories never change the verdict", () => {
  it("value within 1% but not exact", () => {
    const a = run(booking({ declaredValue: 5420 }));
    expect(a.verdict).toBe("passed");
    expect(a.advisories.some((x) => x.key === "value-precision")).toBe(true);
  });
  it("origin mismatch in description", () => {
    const a = run(booking({}, [{ description: "Mug, made in China" }]));
    expect(a.verdict).toBe("passed");
    expect(a.advisories.some((x) => x.key.startsWith("origin-mismatch"))).toBe(true);
  });
});

describe("R-06 battery outcomes", () => {
  it("explicit lithium is restricted outright with no confirm option", () => {
    const a = run(booking({}, [{ description: "Lithium-ion power bank 10000mAh" }]));
    const f = a.findings.find((x) => x.ruleId === "R-06")!;
    expect(f.title).toMatch(/lithium battery \(restricted dangerous goods\)/);
    expect(f.fix.actions.map((x) => x.id)).toEqual(["r06-remove"]);
  });
  it("a generic battery asks for chemistry and stays Red until confirmed", () => {
    const b = booking({}, [{ description: "AA batteries, pack of 4" }]);
    const f = run(b).findings.find((x) => x.ruleId === "R-06")!;
    expect(f.severity).toBe("red");
    expect(f.title).toMatch(/battery chemistry must be confirmed/);
    expect(f.detail).toMatch(/cannot accept lithium batteries/);
    expect(run(applyPatch(b, { kind: "r06Clear", itemId: "it-1" }).booking).verdict).toBe("passed");
  });
  it("aerosols and flammables are unchanged and can't be cleared by confirmation", () => {
    const b = applyPatch(booking({}, [{ description: "Aerosol deodorant 150ml" }]), { kind: "r06Clear", itemId: "it-1" }).booking;
    expect(run(b).verdict).toBe("blocked");
  });
});
