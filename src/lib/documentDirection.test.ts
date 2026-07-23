import { describe, it, expect } from "vitest";
import { resolveDocumentDirection, applyDocumentLanguage } from "./documentDirection";

describe("resolveDocumentDirection", () => {
  it("returns rtl for Arabic", () => {
    expect(resolveDocumentDirection("ar")).toBe("rtl");
  });
  it("returns ltr for English", () => {
    expect(resolveDocumentDirection("en")).toBe("ltr");
  });
  it("returns ltr for Turkish", () => {
    expect(resolveDocumentDirection("tr")).toBe("ltr");
  });
});

describe("applyDocumentLanguage", () => {
  it("sets lang=ar and dir=rtl on the target element for Arabic", () => {
    const target = { lang: "", dir: "" };
    applyDocumentLanguage("ar", target);
    expect(target.lang).toBe("ar");
    expect(target.dir).toBe("rtl");
  });

  it("sets lang=en and dir=ltr on the target element for English", () => {
    const target = { lang: "", dir: "" };
    applyDocumentLanguage("en", target);
    expect(target.lang).toBe("en");
    expect(target.dir).toBe("ltr");
  });

  it("sets lang=tr and dir=ltr on the target element for Turkish", () => {
    const target = { lang: "", dir: "" };
    applyDocumentLanguage("tr", target);
    expect(target.lang).toBe("tr");
    expect(target.dir).toBe("ltr");
  });

  it("overwrites a previous direction when the language changes back to LTR", () => {
    const target = { lang: "ar", dir: "rtl" };
    applyDocumentLanguage("en", target);
    expect(target.lang).toBe("en");
    expect(target.dir).toBe("ltr");
  });
});
