import { describe, it, expect } from "vitest";
import {
  isClientStaffAccount,
  canClientSelfDeleteAccount,
  canClientSendChatMessage,
  normalizeClientUsername,
  buildClientUsernameField,
  matchesClientLoginIdentifier,
} from "./clientAccess";

describe("isClientStaffAccount", () => {
  it("is true only when isEmployee is explicitly true", () => {
    expect(isClientStaffAccount({ isEmployee: true })).toBe(true);
    expect(isClientStaffAccount({ isEmployee: false })).toBe(false);
    expect(isClientStaffAccount({ isEmployee: undefined })).toBe(false);
    expect(isClientStaffAccount({})).toBe(false);
  });
});

describe("canClientSelfDeleteAccount", () => {
  it("allows the company owner account to self-delete", () => {
    expect(canClientSelfDeleteAccount({ isEmployee: false })).toBe(true);
    expect(canClientSelfDeleteAccount({})).toBe(true);
  });

  it("blocks a Client Staff account from self-deleting — MARAS Admin only", () => {
    expect(canClientSelfDeleteAccount({ isEmployee: true })).toBe(false);
  });
});

describe("canClientSendChatMessage", () => {
  it("customer-chat-enablement-safety-review: gives Client Staff the same chat send capability as the company owner", () => {
    expect(canClientSendChatMessage({ isEmployee: true })).toBe(true);
    expect(canClientSendChatMessage({ isEmployee: false })).toBe(true);
    expect(canClientSendChatMessage({})).toBe(true);
  });
});

// fix/client-create-username

describe("normalizeClientUsername", () => {
  it("trims and lowercases, matching POST /api/login's normalizedQuery rule", () => {
    expect(normalizeClientUsername("  ClientReviewer  ")).toBe("clientreviewer");
    expect(normalizeClientUsername("ALLCAPS")).toBe("allcaps");
    expect(normalizeClientUsername("already.normal")).toBe("already.normal");
  });

  it("returns an empty string for missing/blank input", () => {
    expect(normalizeClientUsername(undefined)).toBe("");
    expect(normalizeClientUsername("")).toBe("");
    expect(normalizeClientUsername("   ")).toBe("");
  });
});

describe("buildClientUsernameField", () => {
  it("stores the submitted username, normalized — the regression this fix covers: POST /api/clients previously omitted this field entirely", () => {
    expect(buildClientUsernameField("clientreviewer")).toEqual({ username: "clientreviewer" });
    expect(buildClientUsernameField("  ClientReviewer  ")).toEqual({ username: "clientreviewer" });
  });

  it("omits the username key entirely for missing or invalid (blank/whitespace-only) input, matching the existing isEmployee/password conditional-spread pattern in POST /api/clients", () => {
    expect(buildClientUsernameField(undefined)).toEqual({});
    expect(buildClientUsernameField("")).toEqual({});
    expect(buildClientUsernameField("   ")).toEqual({});
  });
});

describe("matchesClientLoginIdentifier", () => {
  it("lets a newly created client authenticate using the exact username it was created with, including different casing/whitespace on the login attempt", () => {
    // Simulates the real flow: admin submits "ClientReviewer" at creation time,
    // POST /api/clients stores it via buildClientUsernameField (trimmed+lowercased).
    const stored = buildClientUsernameField("ClientReviewer") as { username: string };
    const client = { username: stored.username, email: "client.reviewer@etir.app", companyName: "MARAS Review Client Co." };

    // A later login attempt with any casing/whitespace normalizes the same way
    // POST /api/login does (`username.toLowerCase().trim()`) before matching.
    expect(matchesClientLoginIdentifier(client, "clientreviewer".toLowerCase().trim())).toBe(true);
    expect(matchesClientLoginIdentifier(client, "  ClientReviewer  ".toLowerCase().trim())).toBe(true);
    expect(matchesClientLoginIdentifier(client, "CLIENTREVIEWER".toLowerCase().trim())).toBe(true);
  });

  it("existing email login behavior is unchanged — case-insensitive exact match", () => {
    const client = { username: "", email: "Contact@Example.com", companyName: "Acme Freight" };
    expect(matchesClientLoginIdentifier(client, "contact@example.com")).toBe(true);
    expect(matchesClientLoginIdentifier(client, "wrong@example.com")).toBe(false);
  });

  it("existing company-name login behavior is unchanged — case-insensitive exact match", () => {
    const client = { username: "", email: "", companyName: "Acme Freight" };
    expect(matchesClientLoginIdentifier(client, "acme freight")).toBe(true);
    expect(matchesClientLoginIdentifier(client, "acme")).toBe(false);
  });

  it("a client with no username set is not reachable by any non-blank username-shaped query", () => {
    const client = { username: undefined, email: "someone@example.com", companyName: "Acme Freight" };
    expect(matchesClientLoginIdentifier(client, "someusername")).toBe(false);
  });

  it("does not cross-match a different client's username/email/company name", () => {
    const client = { username: "clientreviewer", email: "client.reviewer@etir.app", companyName: "MARAS Review Client Co." };
    expect(matchesClientLoginIdentifier(client, "someoneelse")).toBe(false);
  });
});
