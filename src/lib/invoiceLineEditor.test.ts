import { describe, it, expect } from "vitest";
import {
  emptyLineDraft, addLineDraft, duplicateLineDraft, deleteLineDraft,
  lineDraftHasData, lineRowNumber, makeLineId, type LineDraft,
} from "./invoiceLineEditor";
import { computeLineAmount } from "./customerInvoiceLines";

const filled = (over: Partial<LineDraft> = {}): LineDraft => ({
  id: "a", serviceType: "Sea Freight", customServiceType: "", description: "Guangzhou to Basra",
  quantity: "2", unit: "Container", customUnit: "", unitPrice: "1500", ...over,
});

describe("invoiceLineEditor — pure row operations", () => {
  it("row numbering is 1-based and follows array order", () => {
    const ls = [filled({ id: "a" }), filled({ id: "b" }), filled({ id: "c" })];
    expect(lineRowNumber(ls, "a")).toBe(1);
    expect(lineRowNumber(ls, "b")).toBe(2);
    expect(lineRowNumber(ls, "c")).toBe(3);
    expect(lineRowNumber(ls, "missing")).toBe(0);
  });

  it("addLineDraft appends one blank editable row", () => {
    const ls = addLineDraft([filled()], "new-1");
    expect(ls).toHaveLength(2);
    expect(ls[1].id).toBe("new-1");
    expect(ls[1].serviceType).toBe("");
    expect(ls[1].quantity).toBe("1");
  });

  it("supports building a table of 10+ rows", () => {
    let ls = [emptyLineDraft("l0")];
    for (let i = 1; i < 15; i++) ls = addLineDraft(ls, `l${i}`);
    expect(ls).toHaveLength(15);
    expect(new Set(ls.map((l) => l.id)).size).toBe(15); // all ids unique
  });

  it("duplicateLineDraft copies content, assigns a NEW id, inserts below", () => {
    const ls = [filled({ id: "a" }), filled({ id: "b", serviceType: "Land Freight" })];
    const out = duplicateLineDraft(ls, "a", "dup-1");
    expect(out).toHaveLength(3);
    expect(out[1].id).toBe("dup-1");                 // new id
    expect(out[1].id).not.toBe("a");                 // never reuses source id
    expect(out[1].serviceType).toBe("Sea Freight");  // content copied
    expect(out[1].description).toBe("Guangzhou to Basra");
    expect(out[1].quantity).toBe("2");
    expect(out[1].unit).toBe("Container");
    expect(out[1].unitPrice).toBe("1500");
    expect(out[2].id).toBe("b");                      // original order preserved after
  });

  it("duplicated line copies custom service/unit values too", () => {
    const src = filled({ id: "a", serviceType: "Other", customServiceType: "Special Escort", unit: "Other", customUnit: "Convoy" });
    const out = duplicateLineDraft([src], "a", "dup-2");
    expect(out[1].customServiceType).toBe("Special Escort");
    expect(out[1].customUnit).toBe("Convoy");
  });

  it("duplicated line re-derives its Amount from quantity x unit price", () => {
    const out = duplicateLineDraft([filled({ id: "a", quantity: "2", unitPrice: "1500" })], "a", "dup-3");
    // Amount is not stored on the draft; it is recomputed the same way for the copy.
    expect(computeLineAmount(Number(out[1].quantity), Number(out[1].unitPrice))).toBe(3000);
  });

  it("makeLineId never produces a server-style id (always l-prefixed, unique)", () => {
    const a = makeLineId(); const b = makeLineId();
    expect(a.startsWith("l-")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("deleteLineDraft removes any line", () => {
    const ls = [filled({ id: "a" }), filled({ id: "b" }), filled({ id: "c" })];
    expect(deleteLineDraft(ls, "b").map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("deleting the last remaining row keeps one editable blank row", () => {
    const out = deleteLineDraft([filled({ id: "only" })], "only", "fresh-1");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("fresh-1");
    expect(out[0].serviceType).toBe("");
    expect(lineDraftHasData(out[0])).toBe(false);
  });

  it("lineDraftHasData distinguishes blank vs filled rows", () => {
    expect(lineDraftHasData(emptyLineDraft("x"))).toBe(false);
    expect(lineDraftHasData(filled())).toBe(true);
    expect(lineDraftHasData({ ...emptyLineDraft("x"), description: "note" })).toBe(true);
    expect(lineDraftHasData({ ...emptyLineDraft("x"), quantity: "3" })).toBe(true);
    expect(lineDraftHasData({ ...emptyLineDraft("x"), quantity: "1" })).toBe(false); // default qty is not "data"
  });
});
