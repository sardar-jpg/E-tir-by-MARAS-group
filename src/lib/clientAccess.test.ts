import { describe, it, expect } from "vitest";
import {
  isClientStaffAccount,
  canClientSendChatMessage,
  normalizeClientUsername,
  buildClientUsernameField,
  buildClientPasswordUpdateField,
  matchesClientLoginIdentifier,
  hasDuplicateClientUsername,
  isShipmentVisibleToClientCompany,
  resolveClientAccountDeleteAuthorization,
} from "./clientAccess";

describe("isClientStaffAccount", () => {
  it("is true only when isEmployee is explicitly true", () => {
    expect(isClientStaffAccount({ isEmployee: true })).toBe(true);
    expect(isClientStaffAccount({ isEmployee: false })).toBe(false);
    expect(isClientStaffAccount({ isEmployee: undefined })).toBe(false);
    expect(isClientStaffAccount({})).toBe(false);
  });
});

describe("canClientSendChatMessage", () => {
  it("customer-chat-enablement-safety-review: gives Client Staff the same chat send capability as the company owner", () => {
    expect(canClientSendChatMessage({ isEmployee: true })).toBe(true);
    expect(canClientSendChatMessage({ isEmployee: false })).toBe(true);
    expect(canClientSendChatMessage({})).toBe(true);
  });
});

describe("resolveClientAccountDeleteAuthorization — final confirmed account-deletion rule", () => {
  const OWNER_ID = "client-owner-1";
  const STAFF_ID = "client-staff-1";
  const OTHER_STAFF_ID = "client-staff-2";

  it("Client Owner can delete their own personal account", () => {
    const decision = resolveClientAccountDeleteAuthorization({
      requestedId: OWNER_ID,
      session: { role: "client", id: OWNER_ID },
    });
    expect(decision.allowed).toBe(true);
  });

  it("Client Staff can delete their own personal account — identical mechanism to Owner, no isEmployee check at all", () => {
    const decision = resolveClientAccountDeleteAuthorization({
      requestedId: STAFF_ID,
      session: { role: "client", id: STAFF_ID },
    });
    expect(decision.allowed).toBe(true);
  });

  it("deleting either personal account only ever authorizes that ONE record id — never implies any other record (company, other accounts) is affected", () => {
    const ownerDecision = resolveClientAccountDeleteAuthorization({
      requestedId: OWNER_ID,
      session: { role: "client", id: OWNER_ID },
    });
    const staffDecision = resolveClientAccountDeleteAuthorization({
      requestedId: STAFF_ID,
      session: { role: "client", id: STAFF_ID },
    });
    // Each decision is scoped to exactly the requested id — the function
    // has no concept of "also delete related records," so a caller can
    // never derive authorization for anything beyond the single id checked.
    expect(ownerDecision).toEqual({ allowed: true });
    expect(staffDecision).toEqual({ allowed: true });
  });

  it("Client Owner cannot delete a Client Staff account", () => {
    const decision = resolveClientAccountDeleteAuthorization({
      requestedId: STAFF_ID,
      session: { role: "client", id: OWNER_ID },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("You can only delete your own account.");
  });

  it("Client Staff cannot delete another Client Staff account", () => {
    const decision = resolveClientAccountDeleteAuthorization({
      requestedId: OTHER_STAFF_ID,
      session: { role: "client", id: STAFF_ID },
    });
    expect(decision.allowed).toBe(false);
  });

  it("Client Staff cannot delete the Client Owner account", () => {
    const decision = resolveClientAccountDeleteAuthorization({
      requestedId: OWNER_ID,
      session: { role: "client", id: STAFF_ID },
    });
    expect(decision.allowed).toBe(false);
  });

  it("neither Owner nor Staff can delete \"the company\" — there is no id a client session can supply, other than its own, that this function ever authorizes", () => {
    const someOtherCompanyRecordId = "client-owner-999";
    expect(
      resolveClientAccountDeleteAuthorization({
        requestedId: someOtherCompanyRecordId,
        session: { role: "client", id: OWNER_ID },
      }).allowed
    ).toBe(false);
    expect(
      resolveClientAccountDeleteAuthorization({
        requestedId: someOtherCompanyRecordId,
        session: { role: "client", id: STAFF_ID },
      }).allowed
    ).toBe(false);
  });

  it("Super Admin can delete a selected Client account — Owner or Staff", () => {
    const ownerTarget = resolveClientAccountDeleteAuthorization({
      requestedId: OWNER_ID,
      session: { role: "admin", id: "admin-1", adminType: "super" },
    });
    const staffTarget = resolveClientAccountDeleteAuthorization({
      requestedId: STAFF_ID,
      session: { role: "admin", id: "admin-1", adminType: "super" },
    });
    expect(ownerTarget.allowed).toBe(true);
    expect(staffTarget.allowed).toBe(true);
  });

  it("Operation Admin cannot delete any Client account — this is the exact bug this fix corrects: adminType !== \"accounts\" is NOT the same as isSuperAdmin", () => {
    const decision = resolveClientAccountDeleteAuthorization({
      requestedId: STAFF_ID,
      session: { role: "admin", id: "admin-2", adminType: "operation" },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("You can only delete your own account.");
  });

  it("Accounts Admin cannot delete any Client account", () => {
    const decision = resolveClientAccountDeleteAuthorization({
      requestedId: OWNER_ID,
      session: { role: "admin", id: "admin-3", adminType: "accounts" },
    });
    expect(decision.allowed).toBe(false);
  });

  it("other, non-super admin types (including an unrecognized/future adminType string) cannot delete any Client account", () => {
    expect(
      resolveClientAccountDeleteAuthorization({
        requestedId: OWNER_ID,
        session: { role: "admin", id: "admin-4", adminType: "some-future-admin-type" },
      }).allowed
    ).toBe(false);
    expect(
      resolveClientAccountDeleteAuthorization({
        requestedId: OWNER_ID,
        session: { role: "admin", id: "admin-5", adminType: undefined },
      }).allowed
    ).toBe(false);
  });

  it("a driver session is never authorized to delete a Client record, even its own id coincidentally matching", () => {
    const decision = resolveClientAccountDeleteAuthorization({
      requestedId: "driver-1",
      session: { role: "driver", id: "driver-1" },
    });
    expect(decision.allowed).toBe(false);
  });

  it("personal-account deletion authorization never extends beyond the single requested id — no cascade to company shipments, documents, or other accounts is representable by this decision", () => {
    // The function's return type is a plain { allowed, reason? } boolean-ish
    // decision about ONE id — it has no way to also authorize deleting any
    // other record, so "deleting my own account" can never, by construction,
    // imply authorization to delete shipments/documents/other Client
    // accounts. Demonstrated by confirming a Staff self-delete decision
    // grants nothing beyond its own id, even when other accounts (Owner,
    // another Staff member) exist in the same "company".
    const staffSelfDelete = resolveClientAccountDeleteAuthorization({
      requestedId: STAFF_ID,
      session: { role: "client", id: STAFF_ID },
    });
    expect(staffSelfDelete).toEqual({ allowed: true });
    expect(
      resolveClientAccountDeleteAuthorization({ requestedId: OWNER_ID, session: { role: "client", id: STAFF_ID } }).allowed
    ).toBe(false);
    expect(
      resolveClientAccountDeleteAuthorization({ requestedId: OTHER_STAFF_ID, session: { role: "client", id: STAFF_ID } }).allowed
    ).toBe(false);
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
