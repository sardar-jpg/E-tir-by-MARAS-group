import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractServerUid, isDenyAllRules, assessRulesPosture } from "./firebaseRulesUid";

const ROOT = join(__dirname, "..", "..");

const rulesWithUid = (uid: string) => `
  service cloud.firestore {
    match /databases/{database}/documents {
      match /{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == "${uid}";
      }
    }
  }
`;

const DENY_ALL = `
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /{document=**} {
        allow read, write: if false;
      }
    }
  }
`;

describe("extractServerUid / isDenyAllRules", () => {
  it("extracts a UID from a rules-style request.auth.uid check", () => {
    expect(extractServerUid(rulesWithUid("abc123"))).toBe("abc123");
  });

  it("returns null when no UID check is present", () => {
    expect(extractServerUid(DENY_ALL)).toBeNull();
  });

  it("deny-all means EVERY active allow statement is the canonical rule and no UID grant exists", () => {
    expect(isDenyAllRules(DENY_ALL)).toBe(true);
    expect(isDenyAllRules(rulesWithUid("abc"))).toBe(false);
    expect(isDenyAllRules(DENY_ALL.replace("allow read, write: if false;", "allow read, write: if false;\nallow get: if false;"))).toBe(false);
  });
});

describe("assessRulesPosture — the H-3 regression guard (structural allow-statement scan)", () => {
  it("accepts the hardened posture: canonical deny-all only, in both files", () => {
    const check = assessRulesPosture(DENY_ALL, DENY_ALL);
    expect(check.problems).toEqual([]);
  });

  it("accepts formatting and whitespace variations of the canonical deny-all", () => {
    const spaced = DENY_ALL.replace("allow read, write: if false;", "allow   read ,write :   if  false ;");
    const multiline = DENY_ALL.replace("allow read, write: if false;", "allow read,\n          write:\n          if false;");
    expect(assessRulesPosture(spaced, multiline).problems).toEqual([]);
  });

  it("FAILS if legacy hardcoded server-UID authorization returns to either file", () => {
    const fs = assessRulesPosture(rulesWithUid("legacy-uid-1"), DENY_ALL);
    expect(fs.problems.some((p) => p.includes("firestore.rules") && p.includes("legacy hardcoded server-UID"))).toBe(true);
    const st = assessRulesPosture(DENY_ALL, rulesWithUid("legacy-uid-2"));
    expect(st.problems.some((p) => p.includes("storage.rules") && p.includes("legacy hardcoded server-UID"))).toBe(true);
  });

  it("FAILS on ANY allow statement beyond the canonical deny-all — not just known-bad patterns", () => {
    // Deny-all present but a second conditional grant added: the exact
    // review scenario — no blacklist pattern would catch a custom claim.
    const adminClaim = DENY_ALL.replace(
      "allow read, write: if false;",
      "allow read, write: if false;\n        allow read: if request.auth.token.admin == true;"
    );
    const c1 = assessRulesPosture(adminClaim, DENY_ALL);
    expect(c1.problems.some((p) => p.includes("firestore.rules") && p.includes("other than the canonical deny-all") && p.includes("request.auth.token.admin"))).toBe(true);

    // Even a harmless-looking EXTRA denial is a posture violation: the
    // contract is "exactly the canonical rule and nothing else".
    const extraDeny = DENY_ALL.replace(
      "allow read, write: if false;",
      "allow read, write: if false;\n        allow get: if false;"
    );
    expect(assessRulesPosture(DENY_ALL, extraDeny).problems.some((p) => p.includes("storage.rules") && p.includes('"allow get: if false;"'))).toBe(true);

    // Nested permissive allow inside a deeper match block.
    const nested = DENY_ALL.replace(
      "match /{document=**} {\n        allow read, write: if false;\n      }",
      "match /{document=**} {\n        allow read, write: if false;\n        match /public/{doc} {\n          allow list: if true;\n        }\n      }"
    );
    expect(assessRulesPosture(nested, DENY_ALL).problems.some((p) => p.includes("allow list: if true;"))).toBe(true);

    // The old blacklist cases still fail structurally: if true, bare
    // allow, any-signed-in-user.
    for (const bad of ["allow read, write: if true;", "allow read, write;", "allow read, write: if request.auth != null;"]) {
      const mutated = DENY_ALL.replace("allow read, write: if false;", bad);
      const check = assessRulesPosture(mutated, DENY_ALL);
      expect(check.problems.some((p) => p.includes("other than the canonical deny-all"))).toBe(true);
      expect(check.problems.some((p) => p.includes("missing the explicit deny-all"))).toBe(true);
    }
  });

  it("FAILS when no active deny-all rule exists at all", () => {
    const empty = "rules_version = '2'; service cloud.firestore { match /databases/{d}/documents { } }";
    expect(assessRulesPosture(empty, DENY_ALL).problems.some((p) => p.includes("missing the explicit deny-all"))).toBe(true);
  });

  it("comments can neither trigger nor satisfy the checks", () => {
    // A permissive allow inside a comment must NOT fail the check…
    const permissiveInComment = DENY_ALL + `\n// example of what must never exist: allow read: if request.auth.token.admin == true;`;
    expect(assessRulesPosture(permissiveInComment, DENY_ALL).problems).toEqual([]);
    // …a deny-all that exists ONLY in a comment must NOT pass…
    const commentOnly = `// allow read, write: if false;\nservice cloud.firestore { match /databases/{d}/documents { match /{document=**} { allow read, write: if true; } } }`;
    const check = assessRulesPosture(commentOnly, DENY_ALL);
    expect(check.problems.some((p) => p.includes("other than the canonical deny-all"))).toBe(true);
    expect(check.problems.some((p) => p.includes("missing the explicit deny-all"))).toBe(true);
    // …and a UID mentioned only in a comment must not trigger the legacy alarm.
    const uidInComment = DENY_ALL + `\n// historical note: request.auth.uid == "old-uid" was the pre-#121 model`;
    expect(assessRulesPosture(uidInComment, DENY_ALL).problems).toEqual([]);
  });
});

describe("the REAL rules files ship the hardened posture (browser/client access denied)", () => {
  const firestoreRules = readFileSync(join(ROOT, "firestore.rules"), "utf-8");
  const storageRules = readFileSync(join(ROOT, "storage.rules"), "utf-8");

  it("firestore.rules and storage.rules are deny-all with no UID and no permissive grant", () => {
    const check = assessRulesPosture(firestoreRules, storageRules);
    expect(check.problems).toEqual([]);
    expect(extractServerUid(firestoreRules)).toBeNull();
    expect(extractServerUid(storageRules)).toBeNull();
  });

  it("no production source uses the Firestore/Storage client SDK — firebase/auth (identity) only", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(entry) || entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
        const src = readFileSync(p, "utf-8");
        if (/from\s+["']firebase\/(firestore|storage|database)["']/.test(src)) offenders.push(p);
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("Maps key delivery is role-scoped and never public (H-4 repo side)", () => {
  const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
  const routeAt = SERVER.indexOf('app.get("/api/maps-key"');
  const ROUTE = SERVER.slice(routeAt, routeAt + 900);

  it("the maps-key route allows only clients and GPS-permitted admins; drivers get 403", () => {
    expect(routeAt).toBeGreaterThan(-1);
    expect(ROUTE).toContain('session.role === "client"');
    expect(ROUTE).toContain('session.role === "admin" && canViewGpsTracking(session.adminType');
    expect(ROUTE).toContain("403");
  });

  it("GOOGLE_MAPS_PLATFORM_KEY has exactly two reads: the gated route and the server-side distance-matrix call — never share/public payloads, never copied to Firestore", () => {
    const occurrences = SERVER.split("GOOGLE_MAPS_PLATFORM_KEY").length - 1;
    expect(occurrences).toBe(2);
    // The old startup write of the key into a Firestore configs document
    // (nothing ever read it) must stay gone.
    expect(SERVER).not.toContain('doc("google_maps")');
    // The distance-matrix usage is server-side only: within that route
    // region the key is used to CALL Google, never placed in a response.
    const dmAt = SERVER.indexOf('app.get("/api/shipments/:id/distance-matrix"');
    const routeAt2 = SERVER.indexOf('app.get("/api/maps-key"');
    const dmRegion = SERVER.slice(dmAt, routeAt2 > dmAt ? SERVER.indexOf('app.put("/api/shipments/:id"', dmAt) : dmAt + 20000);
    expect(dmRegion).not.toMatch(/res\.json\([^)]*mapsKey/);
    // The public share view builder exposes an explicit allowlist that
    // contains no key-like field at all.
    const SHARE_LIB = readFileSync(join(ROOT, "src", "lib", "publicShareView.ts"), "utf-8");
    expect(SHARE_LIB).not.toContain("maps");
    expect(SHARE_LIB).not.toContain("GOOGLE_MAPS_PLATFORM_KEY");
  });

  it("only the real map surfaces fetch the key (admin tracking map, client shipment map, dashboard live-ops map)", () => {
    const consumers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(entry) || entry.includes(".test.")) continue;
        if (readFileSync(p, "utf-8").includes("maps-key")) consumers.push(entry);
      }
    };
    walk(join(ROOT, "src"));
    // The Dashboard's compact Live Operations Map (LiveOperationsMap.tsx) is
    // an admin-only surface added in the Dashboard redesign; it reuses the
    // same role-scoped /api/maps-key path as the other two map surfaces.
    expect(consumers.sort()).toEqual(["ClientShipmentMap.tsx", "LiveOperationsMap.tsx", "TrackingMap.tsx"]);
  });
});
