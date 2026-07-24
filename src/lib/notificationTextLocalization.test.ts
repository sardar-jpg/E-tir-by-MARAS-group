import { describe, it, expect } from "vitest";
import { localizeStatusesInText, localizedNotificationText } from "./notificationTextLocalization";
import { getShipmentStatusLabel } from "./shipmentStatusTransitions";

describe("localizeStatusesInText — display-time status localization", () => {
  it("replaces a raw English status inside a Turkish sentence", () => {
    const trLabel = getShipmentStatusLabel("In Transit").tr;
    expect(localizeStatusesInText("Durum Güncellemesi: In Transit", "tr")).toBe(`Durum Güncellemesi: ${trLabel}`);
  });

  it("replaces a raw English status inside an Arabic sentence", () => {
    const arLabel = getShipmentStatusLabel("Customs Clearance").ar;
    expect(localizeStatusesInText("تحديث الحالة: Customs Clearance", "ar")).toBe(`تحديث الحالة: ${arLabel}`);
  });

  it("returns English text untouched (the English label IS the status name)", () => {
    expect(localizeStatusesInText("Status Update: In Transit", "en")).toBe("Status Update: In Transit");
  });

  it("replaces the longest status first — 'Arrived at Port' never half-replaced by 'Arrived'", () => {
    const out = localizeStatusesInText("Şimdi: Arrived at Port", "tr");
    const full = getShipmentStatusLabel("Arrived at Port").tr;
    expect(out).toBe(`Şimdi: ${full}`);
    expect(out).not.toContain("at Port");
  });

  it("replaces multiple occurrences and leaves unknown words alone", () => {
    const trLoaded = getShipmentStatusLabel("Loaded").tr;
    const out = localizeStatusesInText("Loaded ve yine Loaded, kamyon hazır", "tr");
    expect(out).toBe(`${trLoaded} ve yine ${trLoaded}, kamyon hazır`);
  });

  it("handles empty/absent text safely", () => {
    expect(localizeStatusesInText("", "tr")).toBe("");
  });
});

describe("localizedNotificationText — language pick + embedded-status localization", () => {
  const n = {
    titleEn: "Status Update: Loading",
    titleTr: "Durum Güncellemesi: Loading",
    titleAr: "تحديث الحالة: Loading",
    messageEn: "Shipment X is now Loading.",
    messageTr: "X sevkiyatı şimdi Loading durumunda.",
    messageAr: "الشحنة X الآن في حالة Loading.",
  };

  it("picks the Turkish fields and localizes the embedded status", () => {
    const trLabel = getShipmentStatusLabel("Loading").tr;
    const out = localizedNotificationText(n, "tr");
    expect(out.title).toBe(`Durum Güncellemesi: ${trLabel}`);
    expect(out.message).toContain(trLabel);
    expect(out.message).not.toContain("Loading");
  });

  it("picks the Arabic fields and localizes the embedded status", () => {
    const arLabel = getShipmentStatusLabel("Loading").ar;
    const out = localizedNotificationText(n, "ar");
    expect(out.title).toBe(`تحديث الحالة: ${arLabel}`);
  });

  it("falls back to English fields when a translation is missing", () => {
    const out = localizedNotificationText({ titleEn: "Hello", messageEn: "World" }, "tr");
    expect(out.title).toBe("Hello");
    expect(out.message).toBe("World");
  });
});
