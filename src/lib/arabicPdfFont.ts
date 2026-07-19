/**
 * arabicPdfFont.ts — loads the IBM Plex Sans Arabic TTF (from the
 * @expo-google-fonts/ibm-plex-sans-arabic package: MIT wrapper + OFL-1.1
 * font — the SAME family already used in the web UI) and registers it with
 * a jsPDF document so Arabic can be drawn. Reads a LOCAL TTF file only — no
 * remote URL at PDF-generation time. Node-only (server-side rendering).
 *
 * jsPDF applies no OpenType shaping, so callers must pass text through
 * toVisualArabic (arabicShaping.ts) before drawing; this module only makes
 * the glyphs available under the font name "IBMPlexArabic".
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const ARABIC_FONT_NAME = "IBMPlexArabic";
const PKG = "@expo-google-fonts/ibm-plex-sans-arabic";
const REGULAR_REL = "400Regular/IBMPlexSansArabic_400Regular.ttf";
const BOLD_REL = "700Bold/IBMPlexSansArabic_700Bold.ttf";

let cache: { regular: string; bold: string } | null | undefined;

function resolveTtf(rel: string): string | null {
  const candidates: string[] = [];
  // 1) createRequire(...).resolve — works when package exports allow it.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createRequire } = require("node:module");
    const req = createRequire(typeof __filename !== "undefined" ? __filename : process.cwd() + "/x.js");
    try { candidates.push(req.resolve(`${PKG}/${rel}`)); } catch { /* subpath not exported */ }
    try { candidates.push(join(req.resolve(`${PKG}/package.json`), "..", rel)); } catch { /* no pkg export */ }
  } catch { /* createRequire unavailable */ }
  // 2) cwd-based (server + vitest both run from the repo root).
  candidates.push(join(process.cwd(), "node_modules", PKG, rel));
  for (const p of candidates) { try { if (p && existsSync(p)) return p; } catch { /* keep trying */ } }
  return null;
}

/** Read + base64-encode the Arabic TTFs (cached). Returns null if unavailable. */
export function loadArabicFontBase64(): { regular: string; bold: string } | null {
  if (cache !== undefined) return cache;
  try {
    const regPath = resolveTtf(REGULAR_REL);
    if (!regPath) { cache = null; return cache; }
    const regular = readFileSync(regPath).toString("base64");
    const boldPath = resolveTtf(BOLD_REL);
    const bold = boldPath ? readFileSync(boldPath).toString("base64") : regular;
    cache = { regular, bold };
  } catch {
    cache = null;
  }
  return cache;
}

/**
 * Register IBM Plex Sans Arabic (normal + bold) on a jsPDF doc. Returns true
 * if the font is available and registered; false if the asset is missing
 * (caller should fall back to the Latin font + sanitizer).
 */
export function registerArabicFont(doc: any): boolean {
  const fonts = loadArabicFontBase64();
  if (!fonts) return false;
  try {
    doc.addFileToVFS("IBMPlexSansArabic-Regular.ttf", fonts.regular);
    doc.addFont("IBMPlexSansArabic-Regular.ttf", ARABIC_FONT_NAME, "normal");
    doc.addFileToVFS("IBMPlexSansArabic-Bold.ttf", fonts.bold);
    doc.addFont("IBMPlexSansArabic-Bold.ttf", ARABIC_FONT_NAME, "bold");
    return true;
  } catch {
    return false;
  }
}
