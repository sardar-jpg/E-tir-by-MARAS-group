import { describe, it, expect } from "vitest";
import { defaultTemplateConfig, validateTemplateConfig, resolveTemplateRender, PRESET_ACCENT } from "./accountingTemplateConfig";

describe("controlled template config — bounded + safe", () => {
  it("has sensible per-doc-type defaults", () => {
    expect(defaultTemplateConfig("invoice").showBank).toBe(true);
    expect(defaultTemplateConfig("statement").showBank).toBe(false);
    expect(defaultTemplateConfig("voucher").showSignature).toBe(true);
    expect(defaultTemplateConfig("invoice").fontFamily).toBe("helvetica");
  });
  it("clamps sizes and restricts enums to the safe sets", () => {
    const c = validateTemplateConfig("invoice", { headingSize: 999, bodySize: 1, fontFamily: "comic-sans", presetId: "hacker", logoPosition: "middle", logoSize: "huge", defaultLanguage: "de" });
    expect(c.headingSize).toBe(20);   // clamped to max
    expect(c.bodySize).toBe(7);       // clamped to min
    expect(c.fontFamily).toBe("helvetica"); // fell back (not in safe list)
    expect(c.presetId).toBe("standard");
    expect(c.logoPosition).toBe("left");
    expect(c.logoSize).toBe("medium");
    expect(c.defaultLanguage).toBe("en");
  });
  it("accepts valid custom values + trims text fields", () => {
    const c = validateTemplateConfig("invoice", { presetId: "modern", fontFamily: "times", headingSize: 16, bodySize: 10, logoPosition: "right", logoSize: "large", showBank: false, footerText: "  Thank you  ", paymentTerms: "Net 30", defaultLanguage: "ar" });
    expect(c.presetId).toBe("modern");
    expect(c.fontFamily).toBe("times");
    expect(c.headingSize).toBe(16);
    expect(c.logoPosition).toBe("right");
    expect(c.showBank).toBe(false);
    expect(c.footerText).toBe("Thank you");
    expect(c.defaultLanguage).toBe("ar");
  });
  it("resolves render options (accent by preset, logo size in mm)", () => {
    const r = resolveTemplateRender(validateTemplateConfig("invoice", { presetId: "modern", logoSize: "large" }));
    expect(r.accent).toEqual(PRESET_ACCENT.modern);
    expect(r.logoSizeMm).toBe(26);
    expect(resolveTemplateRender(validateTemplateConfig("invoice", { logoSize: "small" })).logoSizeMm).toBe(14);
  });
});
