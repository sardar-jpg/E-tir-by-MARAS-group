/**
 * check-production-config.ts — operator-facing production config check
 * (Stage 2 PR 1, audit finding H-1). Prints a presence table (variable
 * NAMES and set/missing booleans only — NEVER values) plus every contract
 * issue, then exits non-zero if any fatal issue exists.
 *
 * By default the environment is assessed AS PRODUCTION (that is this
 * script's whole purpose — checking a production-shaped environment from
 * wherever it runs). Pass --dev to assess with the current NODE_ENV.
 *
 * Usage:
 *   npm run check-production-config          # assess current env as production
 *   npm run check-production-config -- --dev # assess as-is (local dev)
 */
import { assessProductionConfig, summarizeProductionConfig } from "../src/lib/productionConfig";

const asDev = process.argv.includes("--dev");
const env: Record<string, string | undefined> = asDev
  ? { ...process.env }
  : { ...process.env, NODE_ENV: "production" };

console.log(`eTIR production configuration check (${asDev ? "current mode" : "assessed as production"})`);
console.log("");
console.log("Variable                        Kind    Required  State    Secret Manager name");
console.log("------------------------------  ------  --------  -------  --------------------------------");
for (const row of summarizeProductionConfig(env)) {
  console.log(
    `${row.name.padEnd(30)}  ${row.kind.padEnd(6)}  ${(row.required ? "yes" : "no").padEnd(8)}  ${(row.set ? "SET" : "missing").padEnd(7)}  ${row.secretName || "-"}`
  );
}

const issues = assessProductionConfig(env);
console.log("");
if (issues.length === 0) {
  console.log("No configuration issues found.");
} else {
  for (const issue of issues) {
    console.log(`[${issue.level.toUpperCase()}] ${issue.code}: ${issue.message}`);
  }
}

const fatal = issues.filter((i) => i.level === "fatal");
if (fatal.length > 0) {
  console.error("");
  console.error(`${fatal.length} fatal configuration issue(s) — a production rollout with this environment would refuse to start.`);
  process.exit(1);
}
