import { describe, it, expect } from "vitest";
import {
  isClientStaffAccount,
  canClientSelfDeleteAccount,
  canClientSendChatMessage,
  normalizeClientUsername,
  buildClientUsernameField,
  buildClientPasswordUpdateField,
  matchesClientLoginIdentifier,
  hasDuplicateClientUsername,
  isShipmentVisibleToClientCompany,
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

  it("an empty query never matches, even against a client with blank/missing fields", () => {
    const blankClient = { username: undefined, email: "", companyName: "" };
    expect(matchesClientLoginIdentifier(blankClient, "")).toBe(false);
    const populatedClient = { username: "someone", email: "someone@example.com", companyName: "Acme Freight" };
    expect(matchesClientLoginIdentifier(populatedClient, "")).toBe(false);
  });

  it("a whitespace-only query never matches — POST /api/login's own blank check (`!username`) does not catch this case, so the helper must reject it independently", () => {
    const blankClient = { username: undefined, email: "", companyName: "" };
    expect(matchesClientLoginIdentifier(blankClient, "   ")).toBe(false);
    const populatedClient = { username: "someone", email: "someone@example.com", companyName: "Acme Freight" };
    expect(matchesClientLoginIdentifier(populatedClient, "   ")).toBe(false);
  });

  it("missing email/companyName fields do not accidentally match each other or a blank query", () => {
    const noEmailNoCompany = { username: "realuser", email: undefined, companyName: undefined };
    expect(matchesClientLoginIdentifier(noEmailNoCompany as any, "realuser")).toBe(true);
    expect(matchesClientLoginIdentifier(noEmailNoCompany as any, "")).toBe(false);
    // Two different clients that both omit email/companyName must never match each other's blank fields.
    const anotherBlankClient = { username: "otheruser", email: undefined, companyName: undefined };
    expect(matchesClientLoginIdentifier(anotherBlankClient as any, "realuser")).toBe(false);
  });
});

describe("buildClientPasswordUpdateField", () => {
  it("includes password only when non-blank — the fix for PUT /api/clients/:id previously being able to hash and store an empty-string password", () => {
    expect(buildClientPasswordUpdateField("NewStrongPass1!")).toEqual({ password: "NewStrongPass1!" });
    expect(buildClientPasswordUpdateField("  NewStrongPass1!  ")).toEqual({ password: "NewStrongPass1!" });
  });

  it("blank password fields on edit preserve the current password — omits the key entirely rather than storing an empty hash", () => {
    expect(buildClientPasswordUpdateField(undefined)).toEqual({});
    expect(buildClientPasswordUpdateField("")).toEqual({});
    expect(buildClientPasswordUpdateField("   ")).toEqual({});
  });
});

describe("hasDuplicateClientUsername", () => {
  const existing = [
    { id: "client-1", username: "clientreviewer" },
    { id: "client-2", username: "acme.owner" },
    { id: "client-3", username: undefined },
  ];

  it("rejects a case-insensitive duplicate on create", () => {
    expect(hasDuplicateClientUsername(existing, "ClientReviewer")).toBe(true);
    expect(hasDuplicateClientUsername(existing, "CLIENTREVIEWER")).toBe(true);
  });

  it("rejects a whitespace-normalized duplicate on create", () => {
    expect(hasDuplicateClientUsername(existing, "  clientreviewer  ")).toBe(true);
  });

  it("allows a genuinely new username", () => {
    expect(hasDuplicateClientUsername(existing, "brand.new.user")).toBe(false);
  });

  it("a blank/whitespace-only candidate is never flagged as a duplicate (matches buildClientUsernameField's own omit-if-blank rule)", () => {
    expect(hasDuplicateClientUsername(existing, "")).toBe(false);
    expect(hasDuplicateClientUsername(existing, "   ")).toBe(false);
    expect(hasDuplicateClientUsername(existing, undefined)).toBe(false);
  });

  it("excludes the record's own id on edit — keeping your own existing username is not a duplicate of yourself", () => {
    expect(hasDuplicateClientUsername(existing, "clientreviewer", "client-1")).toBe(false);
    // But it's still a duplicate if a DIFFERENT record already has it.
    expect(hasDuplicateClientUsername(existing, "clientreviewer", "client-2")).toBe(true);
  });

  it("multiple Client Staff accounts can exist under one company, as long as their usernames differ", () => {
    const staffAccounts = [
      { id: "staff-1", username: "acme.staff.one" },
      { id: "staff-2", username: "acme.staff.two" },
    ];
    expect(hasDuplicateClientUsername(staffAccounts, "acme.staff.three")).toBe(false);
    expect(hasDuplicateClientUsername(staffAccounts, "acme.staff.one")).toBe(true);
  });
});

describe("isShipmentVisibleToClientCompany", () => {
  it("a shipment is visible when its companyName exactly matches the client's companyName", () => {
    expect(isShipmentVisibleToClientCompany("Acme Freight", "Acme Freight")).toBe(true);
  });

  it("Client Staff sees the same company shipments as Client Owner — the rule takes only companyName strings, never isEmployee", () => {
    const shipmentCompanyName = "MARAS Review Client Co.";
    const ownerCompanyName = "MARAS Review Client Co."; // Client Owner record's companyName
    const staffCompanyName = "MARAS Review Client Co."; // Client Staff record's own, independently-copied companyName
    expect(isShipmentVisibleToClientCompany(shipmentCompanyName, ownerCompanyName)).toBe(true);
    expect(isShipmentVisibleToClientCompany(shipmentCompanyName, staffCompanyName)).toBe(true);
  });

  it("Client Staff cannot see another company's shipments", () => {
    expect(isShipmentVisibleToClientCompany("Acme Freight", "Other Company Ltd.")).toBe(false);
  });

  it("a shipment with no companyName is never visible to any client", () => {
    expect(isShipmentVisibleToClientCompany(undefined, "Acme Freight")).toBe(false);
    expect(isShipmentVisibleToClientCompany("", "Acme Freight")).toBe(false);
  });
});

describe("Client Owner vs Client Staff — username storage and login, end to end through the pure helpers", () => {
  it("a new Client Owner (isEmployee omitted) stores its username correctly and can log in immediately by that username", () => {
    const ownerField = buildClientUsernameField("owner.reviewer");
    expect(ownerField).toEqual({ username: "owner.reviewer" });
    const ownerRecord = { username: (ownerField as { username: string }).username, email: "", companyName: "Acme Freight" };
    expect(matchesClientLoginIdentifier(ownerRecord, "owner.reviewer")).toBe(true);
  });

  it("a new Client Staff account (isEmployee: true) stores its username correctly and can log in immediately by that username — identical mechanism to Owner, since buildClientUsernameField/matchesClientLoginIdentifier never branch on isEmployee", () => {
    const staffField = buildClientUsernameField("staff.reviewer");
    expect(staffField).toEqual({ username: "staff.reviewer" });
    const staffRecord = {
      username: (staffField as { username: string }).username,
      email: "",
      companyName: "Acme Freight",
      isEmployee: true,
    };
    expect(matchesClientLoginIdentifier(staffRecord, "staff.reviewer")).toBe(true);
    // isClientStaffAccount correctly identifies it as staff, independent of the login/username mechanism above.
    expect(isClientStaffAccount(staffRecord)).toBe(true);
  });

  it("an Owner and a Staff account under the same company must each still get their own distinct, non-colliding username", () => {
    const existingOwner = { id: "owner-1", username: "acme.owner" };
    expect(hasDuplicateClientUsername([existingOwner], "acme.staff")).toBe(false);
    expect(hasDuplicateClientUsername([existingOwner], "acme.owner")).toBe(true);
  });
});
