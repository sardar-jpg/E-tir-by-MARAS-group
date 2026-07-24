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

describe("DriverBottomNavigation — exactly Home, Job, Chat, Profile", () => {
  const SOURCE = read("driver/DriverBottomNavigation.tsx");

  it("declares exactly the four required sections, in order — nothing more", () => {
    expect(SOURCE).toContain('const TABS: DriverTab[] = ["home", "job", "chat", "profile"];');
    expect(SOURCE).toContain('export type DriverTab = "home" | "job" | "chat" | "profile";');
    // Retired sections must not resurface as navigation items.
    expect(SOURCE).not.toMatch(/"menu"|"notifications"|"jobs"|"account"|"offers"|"documents"/);
    expect(SOURCE).toContain("grid-cols-4");
  });

  it("localizes every tab label in English, Turkish, and Arabic", () => {
    for (const tab of ["home", "job", "chat", "profile"]) {
      const entry = SOURCE.slice(SOURCE.indexOf(`${tab}: {`));
      expect(entry).toContain("en:");
      expect(entry).toContain("tr:");
      expect(entry).toContain("ar:");
    }
    expect(SOURCE).toContain("الرئيسية");
    expect(SOURCE).toContain("Ana Sayfa");
  });

  it("the Job tab carries the unseen-offers badge; Chat carries the unread badge", () => {
    expect(SOURCE).toContain('tab === "chat" ? chatUnreadCount : tab === "job" ? pendingOffersCount : 0');
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
    // The design system's ONE canonical route element owns the arrow —
    // list rows render routes through it, so mirroring is fixed in
    // exactly one place. (Revision A: the Home hero renders its own
    // wrap-friendly route line with the same rtl:rotate-180 arrow.)
    const ROUTE = read("driver/RouteBlock.tsx");
    expect(ROUTE).toContain("rtl:rotate-180");
    const JOB = read("driver/DriverActiveJobScreen.tsx");
    expect(JOB).toContain("<RouteBlock");
    const HOME = read("driver/DriverHomeScreen.tsx");
    expect(HOME).toContain("rtl:rotate-180");
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
    // Revision A: the agreed amount appears ONLY in the details view
    // (an existing driver-authorized field), resolved through the shared
    // helper — never read raw off the shipment, never on Home.
    const source = read("driver/DriverJobDetails.tsx");
    expect(source).toContain("resolveDriverAgreedAmount");
    expect(source).not.toMatch(/\bs\.agreedAmount\b|shipment\.agreedAmount\b/);
    expect(read("driver/DriverHomeScreen.tsx")).not.toContain("agreedAmount");
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

  it("closed chat shows the read-only notice in all three languages, and the composer branch is lock-gated", () => {
    const CHAT = read("driver/DriverChatScreen.tsx");
    expect(CHAT).toContain("This job is closed. The conversation is now read-only.");
    expect(CHAT).toContain("İş kapatıldı. Görüşme artık salt okunur.");
    expect(CHAT).toContain("تم إغلاق العمل. أصبحت المحادثة للقراءة فقط.");
    expect(CHAT).toContain("{isChatClosed ? (");
  });
});

describe("Documents flow through the shipment chat — no standalone driver documents UI", () => {
  it("there is no DriverDocumentsScreen and no documents navigation anywhere in the driver app", () => {
    expect(driverComponentFiles).not.toContain("DriverDocumentsScreen.tsx");
    const APP = read("DriverApplication.tsx");
    expect(APP).not.toContain("DriverDocumentsScreen");
    expect(APP).not.toContain("'documents'");
  });

  it("the Job screen offers one Shipment Chat shortcut, not a documents shortcut", () => {
    const JOB = read("driver/DriverActiveJobScreen.tsx");
    expect(JOB).toContain("Shipment Chat");
    expect(JOB).not.toContain("onOpenDocuments");
  });

  it("chat renders shipment files recognizably: named download link plus inline image preview", () => {
    const CHAT = read("driver/DriverChatScreen.tsx");
    expect(CHAT).toContain('msg.type === "file"');
    expect(CHAT).toContain("msg.fileUrl");
    expect(CHAT).toContain("download={msg.fileName");
  });

  it("the job details view keeps the existing read-only shared-documents section (admin-published files stay reachable)", () => {
    const DETAILS = read("driver/DriverJobDetails.tsx");
    expect(DETAILS).toContain("DriverDocumentSection");
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

describe("Shipment-chat lifecycle — chat exists only after the driver accepts the job", () => {
  const APP = read("DriverApplication.tsx");

  it("thread list, unread badges, auto-select, deep-links, and openJobChat are all gated by isDriverChatAvailable", () => {
    expect(APP).toContain('import { isDriverChatAvailable } from "../lib/driverJobFlow";');
    expect(APP).toContain("shipments.filter(s => isDriverChatAvailable(s.status)).sort");
    expect(APP).toContain("chatAvailableShipmentIds.has(n.shipmentId)");
    expect(APP).toContain("activeJob && isDriverChatAvailable(activeJob.status)");
    expect(APP).toContain("if (!isDriverChatAvailable(shipment.status)) {");
    expect(APP).toContain("target && isDriverChatAvailable(target.status)");
  });

  it("the Chat tab with no accepted job shows the informational empty state with an Open Job action — no conversation is created", () => {
    expect(APP).toContain("activeTab === 'chat' && chatJobs.length === 0");
    expect(APP).toContain("<DriverChatEmptyState");
    const EMPTY = read("driver/DriverChatEmptyState.tsx");
    expect(EMPTY).toContain("Shipment chat becomes available after you accept an assigned job.");
    expect(EMPTY).toContain("تعمل محادثة الشحنة بعد قبول العمل.");
    expect(EMPTY).toContain("Sevkiyat mesajlaşması, atanan bir işi kabul etmenizden sonra açılır.");
    expect(EMPTY).toContain("onOpenJob");
    // No support contact, no customer chat, no general chat — the CODE
    // may not offer any of them (the doc comment naming the rule is fine).
    const emptyCodeOnly = EMPTY.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(emptyCodeOnly).not.toMatch(/support|customer|tel:/i);
  });

  it("job surfaces hide chat affordances before acceptance (Home shortcut, screen shortcut, file handoff)", () => {
    const HOME = read("driver/DriverHomeScreen.tsx");
    expect(HOME).toContain("const chatAvailable = isDriverChatAvailable(activeJob.status);");
    expect(HOME).toContain("{chatAvailable && (");
    const JOB = read("driver/DriverActiveJobScreen.tsx");
    expect(JOB).toContain("isDriverChatAvailable(activeJob.status) ? (");
    expect(JOB).toContain("chatAfterAccept");
    const DETAILS = read("driver/DriverJobDetails.tsx");
    expect(DETAILS).toContain("canSendDocuments={!closed && isDriverChatAvailable(s.status)}");
  });

  it("there is no chat action during the offer stage", () => {
    const OFFERS = read("driver/DriverOffersScreen.tsx");
    expect(OFFERS).not.toContain("Ask MARAS");
    expect(OFFERS).not.toContain("onAskMaras");
    const JOB = read("driver/DriverActiveJobScreen.tsx");
    expect(JOB).not.toContain("onAskMaras");
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

/* ═══════════════════ Revision A (approved redesign) contracts ═══════════════════ */

describe("Revision A — one legal primary action via the existing next-action rule", () => {
  it("Home hosts DriverNextAction; the action derives from getDriverNextAction only (no duplicated lifecycle logic)", () => {
    const HOME = read("driver/DriverHomeScreen.tsx");
    expect(HOME).toContain("<DriverNextAction");
    const ACTION = read("driver/DriverNextAction.tsx");
    expect(ACTION).toContain("getDriverNextAction(shipment.status, shipment.freightType)");
    // Never a dropdown of statuses, never a client-side sequence copy.
    expect(ACTION).not.toContain("<select");
    expect(ACTION).not.toContain("LAND_STATUS_SEQUENCE");
  });

  it("the confirmation moment states the exact lifecycle consequence and keeps confirm/cancel behavior", () => {
    const ACTION = read("driver/DriverNextAction.tsx");
    expect(ACTION).toContain("This will update the shipment status to");
    expect(ACTION).toContain("onSubmitNextStatus");
    expect(ACTION).toContain("setConfirming(false)");
    // Poll-driven status change under an open confirm resets it (unchanged rule).
    expect(ACTION).toContain("[shipment.id, shipment.status]");
  });

  it("the reminder checklist is reminder-only: static copy, never stored, never gating the confirm", () => {
    const ACTION = read("driver/DriverNextAction.tsx");
    expect(ACTION).toContain("Reminder only — not recorded");
    // No checkbox state, no persistence, no payload from the checklist.
    expect(ACTION).not.toContain('type="checkbox"');
    expect(ACTION).not.toContain("localStorage");
    expect(ACTION).not.toMatch(/apiFetch|fetch\(/);
  });
});

describe("Revision A — files live in chat; neutral wording; no phone action", () => {
  const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the chat attach sheet exists with neutral wording (Attach to chat / Files / Recent attachments)", () => {
    const CHAT = read("driver/DriverChatScreen.tsx");
    expect(CHAT).toContain("Attach to chat");
    expect(CHAT).toContain("Recent attachments");
    expect(CHAT).toContain("Sohbete ekle");
    expect(CHAT).toContain("إرفاق إلى الدردشة");
    // All attach routes feed the SAME existing upload flow.
    expect(CHAT.match(/onAttachmentSelected\(e\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("no driver-facing 'Upload Document' or Documents-module wording anywhere", () => {
    for (const [name, source] of driverSources) {
      expect(source, name).not.toContain("Upload Document");
      expect(source, name).not.toContain("Documents page");
      expect(source, name).not.toContain("Documents tab");
    }
    // The details section label is the neutral "Files".
    const DETAILS = read("driver/DriverJobDetails.tsx");
    expect(DETAILS).toContain('files: "Files"');
    expect(DETAILS).not.toContain('"Documents"');
  });

  it("no phone action exists on any driver surface (Chat is the only channel)", () => {
    for (const [name, source] of driverSources) {
      expect(codeOnly(source), name).not.toContain("tel:");
    }
  });
});

describe("Revision A — trust fixes", () => {
  it("a real offline indicator exists, driven by browser connectivity events", () => {
    const APP = read("DriverApplication.tsx");
    expect(APP).toContain('window.addEventListener("offline"');
    expect(APP).toContain('window.addEventListener("online"');
    expect(APP).toContain("You are offline — updates will resume automatically.");
  });

  it("GPS 'checking' falls to the honest unavailable state after a timeout — no fabricated coordinates", () => {
    const HOOK = read("../hooks/driver/useDriverLocationReporting.ts");
    expect(HOOK).toContain("GPS_CHECKING_TIMEOUT_MS");
    expect(HOOK).toContain("setGpsAvailable((prev) => (prev === null ? false : prev))");
    // The timeout path only ever flips the UI state — it never invents a fix.
    const timeoutEffect = HOOK.slice(HOOK.indexOf("GPS_CHECKING_TIMEOUT_MS);", HOOK.indexOf("// Revision A trust fix: while reporting")));
    expect(timeoutEffect).not.toContain("setLastGpsCoords");
    expect(timeoutEffect).not.toContain("transmitGPS");
  });

  it("the GPS banner never claims GPS is active — it renders only the unavailable state", () => {
    const APP = read("DriverApplication.tsx");
    expect(APP).toContain("isReportingLocation && gpsAvailable === false");
    expect(APP).not.toContain("gpsAvailable === true");
  });

  it("logout requires confirmation", () => {
    const ACCOUNT = read("driver/DriverAccountScreen.tsx");
    expect(ACCOUNT).toContain("setShowLogoutConfirm(true)");
    expect(ACCOUNT).toContain("logoutConfirmTitle");
    // The direct onLogout call lives only inside the confirm dialog / deletion flow.
    expect(ACCOUNT).not.toContain("onClick={onLogout}\n          className=\"w-full min-h-[52px]");
  });

  it("Arabic/Turkish notification text localizes embedded status names at display time", () => {
    const PANEL = read("driver/NotificationsPanel.tsx");
    expect(PANEL).toContain("localizedNotificationText");
    const APP = read("DriverApplication.tsx");
    expect(APP).toContain("localizeStatusesInText");
  });

  it("Home renders no activity feed at all (five elements only); notifications stay server-scoped", () => {
    const HOME = read("driver/DriverHomeScreen.tsx");
    expect(HOME).not.toContain("recentNotifications");
    expect(HOME).not.toContain("Recent activity");
    const APP = read("DriverApplication.tsx");
    // The driver's notification list remains the server-scoped endpoint.
    expect(APP).toContain('apiFetch("/api/notifications")');
  });
});

describe("Revision A — honest progress, no fabricated operational data", () => {
  const codeOnly = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  it("Trip Progress derives only from the stored status's confirmed sequence position — never GPS", () => {
    const JOB = read("driver/DriverActiveJobScreen.tsx");
    expect(JOB).toContain("getJourneyProgress(activeJob.status, activeJob.freightType)");
    expect(JOB).toContain("Based on confirmed steps");
    expect(codeOnly(JOB).toLowerCase()).not.toContain("gps");
    const UI = read("driver/driverUi.ts");
    expect(UI).toContain("sequence.indexOf(status)");
  });

  it("no ETA, distance, or map is rendered on Home or Trip Progress", () => {
    for (const file of ["driver/DriverHomeScreen.tsx", "driver/DriverActiveJobScreen.tsx"]) {
      const source = codeOnly(read(file));
      expect(source, file).not.toMatch(/\bETA\b/);
      expect(source, file).not.toMatch(/\bdistanceKm\b|\bdistance\b/i);
      expect(source, file).not.toContain("googleapis.com/maps");
      expect(source, file).not.toContain("Map(");
    }
  });

  it("Home contains exactly the approved five elements — no KPI tiles, timeline, or dashboard cards", () => {
    const HOME = read("driver/DriverHomeScreen.tsx");
    expect(HOME).toContain("Active shipment");            // 1 hero card
    expect(HOME).toContain("STATUS_DESCRIPTIONS");        // 2 current status
    expect(HOME).toContain("<DriverNextAction");          // 3 one primary action
    expect(HOME).toContain("onOpenChat(activeJob)");      // 4 chat
    expect(HOME).toContain("onOpenDetails(activeJob)");   // 5 details
    expect(HOME).not.toContain("DriverStatusTimeline");   // timeline lives on Trip Progress
  });
});
