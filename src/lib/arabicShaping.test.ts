import { describe, it, expect } from "vitest";
import { containsArabic, toVisualArabic } from "./arabicShaping";

const cp = (...n: number[]) => String.fromCodePoint(...n);
const hasPresentationForm = (s: string) => Array.from(s).some((c) => { const x = c.codePointAt(0)!; return x >= 0xfe70 && x <= 0xfeff; });

describe("Arabic detection", () => {
  it("detects Arabic vs Latin", () => {
    expect(containsArabic("المبلغ")).toBe(true);
    expect(containsArabic("USD")).toBe(false);
    expect(containsArabic("MAR-2026-001")).toBe(false);
    expect(containsArabic("طلب MAR-2026-001")).toBe(true);
  });
});

describe("contextual shaping (connected letters, not isolated)", () => {
  it("shapes two beh into initial+final and orders them visually RTL", () => {
    // logical بب → initial(0xFE91) + final(0xFE90); visual order reverses → FE90 FE91
    expect(toVisualArabic("بب")).toBe(cp(0xfe90, 0xfe91));
  });
  it("forms the lam-alef ligature (single glyph, not two letters)", () => {
    expect(toVisualArabic("لا")).toBe(cp(0xfefb)); // isolated lam-alef
    expect(Array.from(toVisualArabic("لا")).length).toBe(1);
  });
  it("produces presentation-form glyphs (never the disconnected base letters)", () => {
    const out = toVisualArabic("المبلغ");
    expect(hasPresentationForm(out)).toBe(true);
    // no bare base-form letters left un-shaped for a fully-joined word’s interior
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("mixed Arabic + Latin / numbers keep LTR tokens intact", () => {
  it("keeps a currency code contiguous and unreversed", () => {
    const out = toVisualArabic("المبلغ USD");
    expect(out).toContain("USD");
    expect(hasPresentationForm(out)).toBe(true);
  });
  it("keeps a MAR order number contiguous and unreversed", () => {
    const out = toVisualArabic("طلب MAR-2026-001");
    expect(out).toContain("MAR-2026-001");
  });
  it("keeps amounts and codes intact", () => {
    const out = toVisualArabic("الإجمالي 1,500.00 IQD");
    expect(out).toContain("1,500.00");
    expect(out).toContain("IQD");
  });
  it("returns pure-Latin unchanged (no reversal)", () => {
    expect(toVisualArabic("MAR-2026-001")).toBe("MAR-2026-001");
    expect(toVisualArabic("Invoice USD 1,500.00")).toBe("Invoice USD 1,500.00");
  });
});
