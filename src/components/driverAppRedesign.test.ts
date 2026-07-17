import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * feature/driver-app-comprehensive-redesign — UI contracts for the
 * redesigned Driver App that have no pure-helper home (those live in
 * driverJobFlow.test.ts as real behavior tests). This project's vitest
 * setup has no jsdom/testing-library (see shipmentStatusChatUi.test.ts
 * for the same situation), so structural render contracts are pinned at
 * the source level:
 *  - the bottom navigation contains exactly Home, Jobs, Chat, Account,
 *    localized in en/tr/ar,
 *  - Arabic RTL correctness: the driver surfaces use logical layout
 *    utilities only, never physical left/right ones,
 *  - GPS transmissions carry only location fields — no stale
 *    driver-profile spread anywhere in the reporting hook, and no GPS
 *    payload construction left in the container,
 *  - privacy: no driver-facing surface references customer identity,
 *    customer pricing, internal notes, or accounting fields,
 *  - the redesigned screens still call the exact same backend endpoints,
 *  - Google Sign-In remains absent from every driver surface.
 */

function read(relPath: string): string {
  return readFileSync(join(__dirname, relPath), "utf-8");
}

const DRIVER_DIR = join(__dirname, "driver");
const driverComponentFiles = readdirSync(DRIVER_DIR).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
const driverSources: Array<[string, string]> = [
  ...driverComponentFiles.map((f): [string, string] => [`driver/${f}`, read(`driver/${f}`)]),
  ["DriverApplication.tsx", read("DriverApplication.tsx")],
  ["../hooks/driver/useDriverActiveJob.ts", read("../hooks/driver/useDriverActiveJob.ts")],
  ["../hooks/driver/useDriverLocationReporting.ts", read("../hooks/driver/useDriverLocationReporting.ts")],
];

describe("DriverBottomNavigation — exactly Home, Offers, Job, Chat, Documents, Profile", () => {
  const SOURCE = read("driver/DriverBottomNavigation.tsx");

  it("declares exactly the six required sections, in order — nothing more", () => {
    expect(SOURCE).toContain('const TABS: DriverTab[] = ["home", "offers", "job", "chat", "documents", "profile"];');
    expect(SOURCE).toContain('export type DriverTab = "home" | "offers" | "job" | "chat" | "documents" | "profile";');
    // Retired sections must not resurface as navigation items.
    expect(SOURCE).not.toMatch(/"menu"|"notifications"|"jobs"|"account"/);
    expect(SOURCE).toContain("grid-cols-6");
  });

  it("localizes every tab label in English, Turkish, and Arabic", () => {
    for (const tab of ["home", "offers", "job", "chat", "documents", "profile"]) {
      const entry = SOURCE.slice(SOURCE.indexOf(`${tab}: {`));
      expect(entry).toContain("en:");
      expect(entry).toContain("tr:");
      expect(entry).toContain("ar:");
    }
    expect(SOURCE).toContain("الرئيسية");
    expect(SOURCE).toContain("Ana Sayfa");
    expect(SOURCE).toContain("العروض");
  });

  it("reserves the device safe-area inset so the bar never sits under a home indicator", () => {
    expect(SOURCE).toContain("env(safe-area-inset-bottom)");
  });

  it("is the navigation the container actually renders", () => {
    const APP = read("DriverApplication.tsx");
    expect(APP).toContain("<DriverBottomNavigation");
    expect(APP).not.toContain("DriverBottomNav ");
  });
});

describe("Arabic RTL — driver surfaces use logical layout utilities only", () => {
  it.each(driverSources.map(([name]) => name))("%s contains no physical left/right Tailwind utilities", (name) => {
    const source = driverSources.find(([n]) => n === name)![1];
    // Physical utilities that break RTL mirroring. Logical equivalents
    // (ms-/me-/ps-/pe-/start-/end-/text-start/text-end) are required
    // instead. `rtl:` variants are explicitly directional-aware and fine.
    const banned = [
      /className="[^"]*\btext-left\b/,
      /className="[^"]*\btext-right\b/,
      /className="[^"]*\b(-?)m[lr]-\d/,
      /className="[^"]*\bp[lr]-\d/,
      /className="[^"]*\b(-?)(left|right)-\d/,
      /className={`[^`]*\btext-left\b/,
      /className={`[^`]*\btext-right\b/,
      /className={`[^`]*\b(-?)m[lr]-\d/,
      /className={`[^`]*\bp[lr]-\d/,
      /className={`[^`]*\b(-?)(left|right)-\d/,
    ];
    for (const pattern of banned) {
      expect(source).not.toMatch(pattern);
    }
  });

  it("directional arrows mirror under RTL", () => {
    const CARD = read("driver/DriverActiveJobCard.tsx");
    expect(CARD).toContain("rtl:rotate-180");
  });
});

describe("GPS payload — location fields only, never a stale profile spread", () => {
  const HOOK = read("../hooks/driver/useDriverLocationReporting.ts");

  it("every transmission body is built by buildDriverLocationUpdatePayload", () => {
    const bodies = HOOK.match(/body: JSON\.stringify\(([^)]*)\)/g) || [];
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).toContain("buildDriverLocationUpdatePayload");
    }
  });

  it("never spreads a driver record into a request body", () => {
    expect(HOOK).not.toContain("...dr");
    expect(HOOK).not.toMatch(/name:|username:|truckNumber:|avatarUrl:/);
  });

  it("the container no longer constructs any GPS payload itself", () => {
    const APP = read("DriverApplication.tsx");
    expect(APP).not.toContain("latitude:");
    expect(APP).not.toContain("longitude:");
    expect(APP).toContain("useDriverLocationReporting({");
  });

  it("reporting lifecycle is keyed to the shared active-job rule, not the open screen", () => {
    const APP = read("DriverApplication.tsx");
    expect(APP).toContain("const { activeJob, isReportingLocation } = useDriverActiveJob(shipments);");
    expect(APP).toContain("isActive: isReportingLocation,");
  });
});

describe("Privacy — driver surfaces never reference customer/internal fields", () => {
  const FORBIDDEN = [
    "companyName",
    "internalNotes",
    "customerEmails",
    "customerNotificationHistory",
    "loadingContactNumber",
    "deliveryContactNumber",
    "costStatement",
    "CostStatement",
    "totalCost",
    "paidAmount",
    "remainingBalance",
    "profit",
    "margin",
    "invoiceNumber",
  ];

  it.each(driverSources.map(([name]) => name))("%s references none of the forbidden fields", (name) => {
    const source = driverSources.find(([n]) => n === name)![1];
    for (const field of FORBIDDEN) {
      expect(source).not.toContain(field);
    }
  });

  it("driver payment surfaces resolve the amount through resolveDriverAgreedAmount only", () => {
    for (const file of ["driver/DriverActiveJobCard.tsx", "driver/DriverJobDetails.tsx"]) {
      const source = read(file);
      expect(source).toContain("resolveDriverAgreedAmount");
      // Never reads the raw field off the shipment directly.
      expect(source).not.toMatch(/\bs\.agreedAmount\b|shipment\.agreedAmount\b/);
    }
  });
});

describe("Backend contracts — redesigned screens call the same endpoints", () => {
  const APP = read("DriverApplication.tsx");

  it("status updates still go through PUT /api/shipments/:id/status with role driver", () => {
    expect(APP).toContain("`/api/shipments/${shipment.id}/status`");
    expect(APP).toContain('role: "driver"');
  });

  it("chat send/read/pagination still use the shipment chat endpoints", () => {
    expect(APP).toContain("`/api/shipments/${activeShipment.id}/chat`");
    expect(APP).toContain("/chat/seen`");
    expect(APP).toContain("/chat?since=");
    expect(APP).toContain("/chat?cursor=");
  });

  it("uploads still go through POST /api/upload, notifications through the per-notification read endpoint", () => {
    expect(APP).toContain('"/api/upload"');
    expect(APP).toContain("`/api/notifications/${id}/read`");
  });

  it("the account screen keeps the protected deletion workflow endpoints", () => {
    const ACCOUNT = read("driver/DriverAccountScreen.tsx");
    expect(ACCOUNT).toContain('"/api/account"');
    expect(ACCOUNT).toContain('"/api/drivers/finish-firebase-deletion"');
    expect(ACCOUNT).toContain("deleteFirebaseIdentityWithRetry");
    expect(ACCOUNT).toContain("resolveDriverAccountDeletionOutcome");
  });

  it("the assignment decline still uses the dedicated Assigned→New workflow (the only backward movement)", () => {
    const fnStart = APP.indexOf("const handleRejectAssignment");
    expect(fnStart).toBeGreaterThan(-1);
    const fnRegion = APP.slice(fnStart, fnStart + 1600);
    expect(fnRegion).toContain('status: "New"');
  });
});

describe("Plain language & Google Sign-In absence", () => {
  it.each(driverSources.map(([name]) => name))("%s contains no infrastructure jargon or Google Sign-In", (name) => {
    const source = driverSources.find(([n]) => n === name)![1];
    for (const banned of [
      "Driver Node Console",
      "Radio connection",
      "telemetry",
      "Telemetry",
      "Purge",
      "gateway",
      "Simulation Node",
      "GoogleAuthProvider",
      "signInWithPopup",
      "Sign in with Google",
    ]) {
      expect(source).not.toContain(banned);
    }
  });

  it("closed chat shows a plain-language read-only banner", () => {
    const CHAT = read("driver/DriverChatScreen.tsx");
    expect(CHAT).toContain("new messages can't be sent");
    expect(CHAT).toContain("{isChatClosed ? (");
  });
});

describe("Documents section — unified model, no category special-casing", () => {
  const DOCS = read("driver/DriverDocumentsScreen.tsx");

  it("groups and labels entirely through the shipmentDocuments registry", () => {
    expect(DOCS).toContain("listDocumentCategories()");
    expect(DOCS).toContain("getDocumentCategoryPolicy(");
    // No category literal — CMR included — may appear in the code.
    const codeOnly = DOCS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/["'](cmr|invoice|packing_list|t1|tir_carnet|customs|delivery_proof|photo|other)["']/);
  });

  it("keeps the driver's only upload path as the chat attachment handoff — no second upload pipeline", () => {
    expect(DOCS).toContain("onSendDocumentViaChat");
    expect(DOCS).not.toContain("apiFetch(");
  });
});

describe("Profile section — routes read-only, availability switch lives on Home", () => {
  const ACCOUNT = read("driver/DriverAccountScreen.tsx");
  const HOME = read("driver/DriverHomeScreen.tsx");

  it("shows registered routes read-only (managed by Operations); the driver UI never writes workingRoutes", () => {
    expect(ACCOUNT).toContain("workingRoutes");
    expect(ACCOUNT).toContain("routesManaged");
    expect(ACCOUNT).not.toContain("workingRoutes:");
  });

  it("the interactive Available-for-Offers switch is on Home; Profile only displays the status", () => {
    expect(HOME).toContain("availableForOffers: !offersEnabled");
    expect(ACCOUNT).not.toContain("availableForOffers: !offersEnabled");
    expect(ACCOUNT).toContain("driver?.availableForOffers !== false");
  });
});

describe("Chat behavior contracts", () => {
  const APP = read("DriverApplication.tsx");

  it("the chat lock is passed straight from isShipmentChatClosed (isShipmentClosed) into the chat screen", () => {
    expect(APP).toContain("isChatClosed={isShipmentChatClosed}");
  });

  it("the composer submit gate uses the shared canSubmitChatMessage guard with the lock", () => {
    const CHAT = read("driver/DriverChatScreen.tsx");
    expect(CHAT).toContain("canSubmitChatMessage({ text: newMessageText, hasAttachment: false, isSending, isLocked: isChatClosed })");
  });

  it("reading a thread marks only that shipment's chat notifications read, per-user", () => {
    expect(APP).toContain("n.type === 'chat' && n.shipmentId === activeShipment.id && !isNotificationReadForUser(n, loggedInDriverId || \"\")");
  });
});
