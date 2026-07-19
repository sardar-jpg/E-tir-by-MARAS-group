/**
 * arabicShaping.ts — pure, dependency-free Arabic text shaping + a
 * lightweight bidi reordering, for rendering Arabic with jsPDF (which does
 * NOT apply OpenType GSUB shaping). We map each Arabic letter to its correct
 * contextual Presentation-Forms-B glyph (isolated / initial / medial /
 * final), form the lam-alef ligatures, then reorder to VISUAL order so
 * jsPDF's left-to-right glyph drawing shows the text right-to-left, while
 * embedded Latin/number runs (USD, IQD, MAR-2026-001, amounts) keep their
 * natural left-to-right order and are never reversed.
 *
 * The presentation-forms table is generated from the Unicode database
 * (unicodedata) so it is authoritative. This is our own MIT-clean code — no
 * GPL/third-party shaper. Joining class is derived from the table: a letter
 * that has initial+medial forms is dual-joining; one with only isolated+
 * final is right-joining (joins to the previous letter only); anything not
 * in the table breaks joining.
 */

interface Forms { iso: number; ini?: number; med?: number; fin?: number }
const FORMS: Record<number, Forms> = {
  0x0621:{iso:0xfe80},0x0622:{iso:0xfe81,fin:0xfe82},0x0623:{iso:0xfe83,fin:0xfe84},0x0624:{iso:0xfe85,fin:0xfe86},0x0625:{iso:0xfe87,fin:0xfe88},0x0626:{iso:0xfe89,fin:0xfe8a,ini:0xfe8b,med:0xfe8c},0x0627:{iso:0xfe8d,fin:0xfe8e},0x0628:{iso:0xfe8f,fin:0xfe90,ini:0xfe91,med:0xfe92},0x0629:{iso:0xfe93,fin:0xfe94},0x062a:{iso:0xfe95,fin:0xfe96,ini:0xfe97,med:0xfe98},0x062b:{iso:0xfe99,fin:0xfe9a,ini:0xfe9b,med:0xfe9c},0x062c:{iso:0xfe9d,fin:0xfe9e,ini:0xfe9f,med:0xfea0},0x062d:{iso:0xfea1,fin:0xfea2,ini:0xfea3,med:0xfea4},0x062e:{iso:0xfea5,fin:0xfea6,ini:0xfea7,med:0xfea8},0x062f:{iso:0xfea9,fin:0xfeaa},0x0630:{iso:0xfeab,fin:0xfeac},0x0631:{iso:0xfead,fin:0xfeae},0x0632:{iso:0xfeaf,fin:0xfeb0},0x0633:{iso:0xfeb1,fin:0xfeb2,ini:0xfeb3,med:0xfeb4},0x0634:{iso:0xfeb5,fin:0xfeb6,ini:0xfeb7,med:0xfeb8},0x0635:{iso:0xfeb9,fin:0xfeba,ini:0xfebb,med:0xfebc},0x0636:{iso:0xfebd,fin:0xfebe,ini:0xfebf,med:0xfec0},0x0637:{iso:0xfec1,fin:0xfec2,ini:0xfec3,med:0xfec4},0x0638:{iso:0xfec5,fin:0xfec6,ini:0xfec7,med:0xfec8},0x0639:{iso:0xfec9,fin:0xfeca,ini:0xfecb,med:0xfecc},0x063a:{iso:0xfecd,fin:0xfece,ini:0xfecf,med:0xfed0},0x0641:{iso:0xfed1,fin:0xfed2,ini:0xfed3,med:0xfed4},0x0642:{iso:0xfed5,fin:0xfed6,ini:0xfed7,med:0xfed8},0x0643:{iso:0xfed9,fin:0xfeda,ini:0xfedb,med:0xfedc},0x0644:{iso:0xfedd,fin:0xfede,ini:0xfedf,med:0xfee0},0x0645:{iso:0xfee1,fin:0xfee2,ini:0xfee3,med:0xfee4},0x0646:{iso:0xfee5,fin:0xfee6,ini:0xfee7,med:0xfee8},0x0647:{iso:0xfee9,fin:0xfeea,ini:0xfeeb,med:0xfeec},0x0648:{iso:0xfeed,fin:0xfeee},0x0649:{iso:0xfeef,fin:0xfef0},0x064a:{iso:0xfef1,fin:0xfef2,ini:0xfef3,med:0xfef4},
};
// (lam 0x0644) + these alef variants → a single ligature glyph.
const LAMALEF: Record<number, { iso: number; fin: number }> = {
  0x0622:{iso:0xfef5,fin:0xfef6},0x0623:{iso:0xfef7,fin:0xfef8},0x0625:{iso:0xfef9,fin:0xfefa},0x0627:{iso:0xfefb,fin:0xfefc},
};
/** Combining marks (tashkeel) — transparent to joining; emitted as-is. */
const isTransparent = (cp: number): boolean => (cp >= 0x064b && cp <= 0x065f) || cp === 0x0670 || (cp >= 0x06d6 && cp <= 0x06ed);
const isArabicCp = (cp: number): boolean => (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);
const isJoining = (cp: number): boolean => cp in FORMS;
const joinsForward = (cp: number): boolean => { const f = FORMS[cp]; return !!(f && f.ini); };

export function containsArabic(s: string): boolean {
  for (const ch of s) if (isArabicCp(ch.codePointAt(0)!)) return true;
  return false;
}

interface Tok { ch: string; rtl: boolean }

/**
 * Shape a logical Arabic string into an array of glyph tokens (each tagged
 * as RTL or not). Non-Arabic characters pass through unchanged.
 */
function shapeToTokens(input: string): Tok[] {
  const cps = Array.from(input).map((c) => c.codePointAt(0)!);
  const out: Tok[] = [];
  // neighbor helpers skipping transparent marks
  const prevJoin = (i: number): boolean => {
    for (let j = i - 1; j >= 0; j--) { if (isTransparent(cps[j])) continue; return isJoining(cps[j]) && joinsForward(cps[j]); }
    return false;
  };
  const nextJoinable = (i: number): number => {
    for (let j = i + 1; j < cps.length; j++) { if (isTransparent(cps[j])) continue; return cps[j]; }
    return -1;
  };
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (isTransparent(cp)) { out.push({ ch: String.fromCodePoint(cp), rtl: true }); continue; }
    if (!isJoining(cp)) { out.push({ ch: String.fromCodePoint(cp), rtl: isArabicCp(cp) }); continue; }
    // lam-alef ligature: lam (0x0644) immediately followed (skipping marks) by an alef in LAMALEF.
    if (cp === 0x0644) {
      const nx = nextJoinable(i);
      if (nx in LAMALEF) {
        const connectsPrev = prevJoin(i);
        const glyph = connectsPrev ? LAMALEF[nx].fin : LAMALEF[nx].iso;
        out.push({ ch: String.fromCodePoint(glyph), rtl: true });
        // consume the alef we just merged
        let j = i + 1; while (j < cps.length && isTransparent(cps[j])) j++;
        i = j;
        continue;
      }
    }
    const f = FORMS[cp];
    const cPrev = prevJoin(i);
    const nx = nextJoinable(i);
    const cNext = !!f.ini && nx !== -1 && isJoining(nx);
    let glyph: number;
    if (cPrev && cNext) glyph = f.med ?? f.fin ?? f.iso;
    else if (cPrev && !cNext) glyph = f.fin ?? f.iso;
    else if (!cPrev && cNext) glyph = f.ini ?? f.iso;
    else glyph = f.iso;
    out.push({ ch: String.fromCodePoint(glyph), rtl: true });
  }
  return out;
}

/**
 * Convert a logical string (possibly mixed Arabic + Latin) into VISUAL
 * order for jsPDF: Arabic runs are shaped and reversed, non-Arabic runs
 * (Latin words, digits, currency codes, MAR numbers) keep their order, and
 * the run ORDER is reversed so the whole line reads right-to-left. A string
 * with no Arabic is returned unchanged.
 */
export function toVisualArabic(input: string): string {
  if (!containsArabic(input)) return input;
  const toks = shapeToTokens(input);
  // group into maximal same-direction runs
  const runs: { rtl: boolean; chars: string[] }[] = [];
  for (const t of toks) {
    const last = runs[runs.length - 1];
    if (last && last.rtl === t.rtl) last.chars.push(t.ch);
    else runs.push({ rtl: t.rtl, chars: [t.ch] });
  }
  let out = "";
  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r];
    out += run.rtl ? run.chars.slice().reverse().join("") : run.chars.join("");
  }
  return out;
}
