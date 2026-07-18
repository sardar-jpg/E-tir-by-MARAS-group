import { describe, it, expect } from "vitest";
import {
  resolveMarasAiAvailability,
  validateMarasAiChatBody,
  buildShipmentAiContext,
  buildMonitoringAiContext,
  buildMarasAiInput,
  MARAS_AI_SYSTEM_PROMPT,
  MARAS_AI_MAX_MESSAGE_CHARS,
  MARAS_AI_MAX_HISTORY_TURNS,
} from "./marasAiCore";
import type { Shipment } from "../types";

describe("resolveMarasAiAvailability — both switches required", () => {
  it("enabled only when MARAS_AI_ENABLED=true AND a key exists", () => {
    expect(resolveMarasAiAvailability({ MARAS_AI_ENABLED: "true", OPENAI_API_KEY: "sk-x" })).toEqual({ enabled: true });
  });
  it("disabled flag wins regardless of key", () => {
    expect(resolveMarasAiAvailability({ MARAS_AI_ENABLED: "", OPENAI_API_KEY: "sk-x" })).toEqual({ enabled: false, reason: "disabled" });
    expect(resolveMarasAiAvailability({ MARAS_AI_ENABLED: "false", OPENAI_API_KEY: "sk-x" })).toEqual({ enabled: false, reason: "disabled" });
  });
  it("missing key is its own clear reason", () => {
    expect(resolveMarasAiAvailability({ MARAS_AI_ENABLED: "true", OPENAI_API_KEY: "  " })).toEqual({ enabled: false, reason: "missing_api_key" });
    expect(resolveMarasAiAvailability({ MARAS_AI_ENABLED: "true" })).toEqual({ enabled: false, reason: "missing_api_key" });
  });
});

describe("the MARAS AI system prompt states every required rule", () => {
  const required = [
    "MARAS AI",
    "internal AI assistant for eTIR by MARAS",
    "Admin employees only",
    "concise and practical",
    "Never invent shipment facts",
    "unavailable",
    "FACTS",
    "SUGGESTIONS",
    "Protect internal and financial information",
    "Never claim a message was sent",
    "backend confirms it",
    "language the employee writes in",
  ];
  for (const phrase of required) {
    it(`contains: ${phrase}`, () => {
      expect(MARAS_AI_SYSTEM_PROMPT).toContain(phrase);
    });
  }
  it("never uses a forbidden product name", () => {
    for (const banned of ["Admin AI", "eTIR AI", "AI Assistant", "MARAS Assistant"]) {
      expect(MARAS_AI_SYSTEM_PROMPT).not.toContain(banned);
    }
  });
});

describe("validateMarasAiChatBody", () => {
  it("accepts a message with capped history and optional context", () => {
    const r = validateMarasAiChatBody({
      message: "  Summarize shipment MAR-2026-1001  ",
      history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }, { role: "hacker", text: "x" }, { role: "user", text: "" }],
      context: { shipmentId: " shipment-1001 ", page: "dashboard" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.message).toBe("Summarize shipment MAR-2026-1001");
      expect(r.history).toEqual([{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }]);
      expect(r.shipmentId).toBe("shipment-1001");
      expect(r.page).toBe("dashboard");
    }
  });
  it("rejects empty and oversized messages", () => {
    expect(validateMarasAiChatBody({ message: "   " }).ok).toBe(false);
    expect(validateMarasAiChatBody({ message: "x".repeat(MARAS_AI_MAX_MESSAGE_CHARS + 1) }).ok).toBe(false);
  });
  it("keeps only the newest history turns", () => {
    const history = Array.from({ length: 40 }, (_, i) => ({ role: "user" as const, text: `m${i}` }));
    const r = validateMarasAiChatBody({ message: "q", history });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.history).toHaveLength(MARAS_AI_MAX_HISTORY_TURNS);
      expect(r.history[r.history.length - 1].text).toBe("m39");
    }
  });
});

describe("buildShipmentAiContext — whitelist only, secrets can never leak", () => {
  const shipment = {
    id: "shipment-1001",
    shipmentNumber: "MAR-2026-1001",
    status: "In Transit",
    loadingCity: "Mersin",
    loadingCountry: "TR",
    deliveryCity: "Erbil",
    deliveryCountry: "IQ",
    companyName: "Client Ltd",
    assignedDriverName: "Murat",
    truckNumber: "33 ABC 123",
    cargoDescription: "Steel",
    cargoWeight: 21000,
    agreedAmount: 5000,
    currency: "USD",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-18T00:00:00Z",
    internalNotes: "priority client",
    documents: [{ id: "d1", category: "cmr", name: "cmr.pdf" }],
    timeline: [],
    // Fields that MUST NOT appear in any AI prompt:
    shareToken: "SECRET-SHARE-TOKEN-XYZ",
    isLinkShared: true,
  } as unknown as Shipment;

  it("includes the operational facts", () => {
    const ctx = buildShipmentAiContext(shipment, undefined, undefined);
    expect(ctx).toContain("MAR-2026-1001");
    expect(ctx).toContain("In Transit");
    expect(ctx).toContain("Mersin");
    expect(ctx).toContain("cmr.pdf");
    expect(ctx).toContain("5000 USD");
  });

  it("NEVER contains the share token or any token/credential material", () => {
    const ctx = buildShipmentAiContext(shipment, undefined, undefined);
    expect(ctx).not.toContain("SECRET-SHARE-TOKEN-XYZ");
    expect(ctx.toLowerCase()).not.toContain("sharetoken");
    expect(ctx.toLowerCase()).not.toContain("password");
  });
});

describe("buildMonitoringAiContext", () => {
  it("says plainly when there are no alerts", () => {
    expect(buildMonitoringAiContext([])).toContain("no technical alerts");
  });
  it("digests alerts with severity, area, count, and suggested action", () => {
    const ctx = buildMonitoringAiContext([
      { title: "Slow API request", severity: "medium", area: "GET /api/shipments", count: 4, time: "t", explanation: "took 4000ms", suggestedAction: "Profile the endpoint." },
    ]);
    expect(ctx).toContain("[MEDIUM] Slow API request");
    expect(ctx).toContain("x4");
    expect(ctx).toContain("Profile the endpoint.");
  });
});

describe("buildMarasAiInput", () => {
  it("appends the new message after the history in order", () => {
    expect(buildMarasAiInput([{ role: "user", text: "a" }, { role: "assistant", text: "b" }], "c")).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);
  });
});
