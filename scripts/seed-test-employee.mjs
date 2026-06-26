/**
 * seed-test-employee.mjs
 *
 * Creates one view-only employee account under an existing client company.
 * Run with:
 *   SERVER_FIREBASE_EMAIL=<email> SERVER_FIREBASE_PASSWORD=<pass> node scripts/seed-test-employee.mjs
 *
 * The script picks the first client that has at least one shipment,
 * then creates a new account under the same companyName with isEmployee: true.
 */

import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import crypto from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// ── Firebase client SDK (same version as server.ts) ──────────────────────────
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  getDocs,
  setDoc,
  doc,
} from "firebase/firestore";

// ── Config ────────────────────────────────────────────────────────────────────
const configPath = join(projectRoot, "firebase-applet-config.json");
const firebaseConfig = JSON.parse(readFileSync(configPath, "utf8"));
const databaseId = firebaseConfig.firestoreDatabaseId;

const SERVER_EMAIL = process.env.SERVER_FIREBASE_EMAIL;
const SERVER_PASS  = process.env.SERVER_FIREBASE_PASSWORD;

if (!SERVER_EMAIL || !SERVER_PASS) {
  console.error("ERROR: Set SERVER_FIREBASE_EMAIL and SERVER_FIREBASE_PASSWORD env vars.");
  process.exit(1);
}

// ── Password hashing (mirrors src/lib/auth.ts hashPassword) ──────────────────
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(plain, salt, 100_000, 64, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

// ── Test credentials ──────────────────────────────────────────────────────────
const TEST_USERNAME = "test.employee";
const TEST_PASSWORD = "EtirEmployee1!";

// ── Main ──────────────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, databaseId);

console.log("Signing in as server account…");
await signInWithEmailAndPassword(auth, SERVER_EMAIL, SERVER_PASS);
console.log("Signed in.");

// Load all clients and shipments
const [clientsSnap, shipmentsSnap] = await Promise.all([
  getDocs(collection(db, "clients")),
  getDocs(collection(db, "shipments")),
]);

const clients  = clientsSnap.docs.map(d => d.data());
const shipments = shipmentsSnap.docs.map(d => d.data());

// Find a client whose companyName appears in at least one shipment
const clientWithShipments = clients.find(c =>
  c.companyName && shipments.some(s => s.companyName === c.companyName)
);

if (!clientWithShipments) {
  console.error("No client with matching shipments found. Create a shipment for a client first.");
  process.exit(1);
}

console.log(`\nUsing company: "${clientWithShipments.companyName}" (original client id: ${clientWithShipments.id})`);
console.log(`Shipments visible to this company: ${shipments.filter(s => s.companyName === clientWithShipments.companyName).length}`);

// Build the employee account
const employeeId = `client-employee-test-${Date.now()}`;
const newEmployee = {
  id: employeeId,
  companyName: clientWithShipments.companyName,
  contactName: "Test Employee",
  phone: "",
  email: "",
  address: "",
  notes: "Test view-only employee account — safe to delete",
  createdAt: new Date().toISOString(),
  username: TEST_USERNAME,
  password: hashPassword(TEST_PASSWORD),
  isEmployee: true,
};

await setDoc(doc(db, "clients", employeeId), newEmployee);

console.log("\n✅ Employee account created:");
console.log(`   Company:  ${newEmployee.companyName}`);
console.log(`   Username: ${TEST_USERNAME}`);
console.log(`   Password: ${TEST_PASSWORD}`);
console.log(`   Doc ID:   ${employeeId}`);
console.log("\nDelete this document from Firestore when done testing.");
