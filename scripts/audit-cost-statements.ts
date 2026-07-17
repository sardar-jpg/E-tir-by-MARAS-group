/**
 * audit-cost-statements.ts — READ-ONLY legacy Cost Statement audit
 * (Accounting Phase B). Run manually with:
 *
 *   npx tsx scripts/audit-cost-statements.ts
 *
 * Requires the same Firestore Application Default Credentials the server
 * uses (see .env.example). It NEVER writes: it lists, for human review,
 * every existing statement that
 *   1. contains mixed item currencies (or an item currency ≠ statement),
 *   2. has a saved companyName different from the authoritative shipment,
 *   3. carries invalid numeric values (non-finite or negative),
 *   4. is expense-overpaid (paidAmount > totalCost),
 *   5. is missing the Phase B optional fields (customerReceivedAmount /
 *      revision / agreedCurrency) — informational only; the application
 *      resolves these safely at read time (0 / 1 / statement currency).
 *
 * This is the documented migration-audit companion to Phase B: no
 * automatic rewrite happens anywhere — statements are only ever updated
 * through the normal save route when an admin edits them.
 */
import "../src/lib/loadEnv";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { CostStatement, Shipment } from "../src/types";

function bad(n: unknown): boolean {
  return typeof n !== "number" || !Number.isFinite(n) || n < 0;
}

async function main() {
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const [stmtSnap, shipSnap] = await Promise.all([
    db.collection("costStatements").get(),
    db.collection("shipments").get(),
  ]);
  const shipments = new Map<string, Shipment>();
  shipSnap.docs.forEach((d) => shipments.set(d.id, d.data() as Shipment));

  let flagged = 0;
  for (const docSnap of stmtSnap.docs) {
    const s = docSnap.data() as CostStatement;
    const issues: string[] = [];

    const itemCurrencies = new Set((s.items || []).map((i) => i.currency || s.currency));
    if (itemCurrencies.size > 1 || (itemCurrencies.size === 1 && !itemCurrencies.has(s.currency))) {
      issues.push(`mixed/mismatched item currencies: [${[...itemCurrencies].join(", ")}] vs statement ${s.currency}`);
    }

    const ship = shipments.get(s.shipmentId);
    if (ship && (s.companyName || "") !== (ship.companyName || "")) {
      issues.push(`companyName "${s.companyName}" differs from shipment "${ship.companyName}"`);
    }
    if (!ship) issues.push("no matching shipment record found");

    if (bad(s.totalCost) || bad(s.paidAmount)) issues.push("invalid statement numerics (totalCost/paidAmount)");
    for (const it of s.items || []) {
      if (bad(it.quantity) || bad(it.unitPrice) || bad(it.totalAmount)) {
        issues.push(`invalid numerics on item "${it.description || it.id}"`);
        break;
      }
    }

    if (typeof s.totalCost === "number" && typeof s.paidAmount === "number" && s.paidAmount > s.totalCost) {
      issues.push(`expense overpayment: paid ${s.paidAmount} > totalCost ${s.totalCost}`);
    }

    const missing: string[] = [];
    if (s.customerReceivedAmount === undefined) missing.push("customerReceivedAmount(→0)");
    if (s.revision === undefined) missing.push("revision(→1)");
    if (s.agreedCurrency === undefined) missing.push("agreedCurrency(→statement currency)");
    if (missing.length) issues.push(`missing Phase B fields (safe defaults apply): ${missing.join(", ")}`);

    if (issues.length) {
      flagged++;
      console.log(`\n${s.shipmentNumber || s.shipmentId}:`);
      issues.forEach((i) => console.log(`  - ${i}`));
    }
  }
  console.log(`\nAudited ${stmtSnap.size} cost statement(s); ${flagged} flagged for review. Nothing was modified.`);
}

main().catch((err) => {
  console.error("Audit failed (read-only, nothing was modified):", err);
  process.exit(1);
});
