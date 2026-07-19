/**
 * accountingPdfRender.ts — ONE server-side renderer (jsPDF in Node) for
 * every accounting document, driven by the pure AccountingPdfModel. Reuses
 * the existing final-cost-statement rendering approach (dynamic jsPDF
 * import, MARAS orange header, Latin sanitizer) and adds: Company-Profile
 * branding (logo via data: URI, footer, signature/stamp), a configurable
 * bank block, DRAFT/VOID watermark, page numbers, and RTL/LTR layout.
 *
 * Arabic NOTE: jsPDF's core fonts are Latin. Layout direction (RTL) is
 * honored, and Arabic labels are carried in the model, but rendering Arabic
 * GLYPHS requires embedding an Arabic TTF (e.g. Noto Naskh) — a follow-up
 * when a licensed font asset is supplied. English/Turkish render fully.
 */
import type { AccountingPdfModel, PdfColumn } from "./accountingPdfModel";
import { toVisualArabic } from "./arabicShaping";
import { registerArabicFont, ARABIC_FONT_NAME } from "./arabicPdfFont";

const sanitizeLatin = (v: unknown): string =>
  String(v ?? "")
    .replace(/ı/g, "i").replace(/İ/g, "I").replace(/ş/g, "s").replace(/Ş/g, "S")
    .replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ç/g, "c").replace(/Ç/g, "C")
    .replace(/ö/g, "o").replace(/Ö/g, "O").replace(/ü/g, "u").replace(/Ü/g, "U");

const BADGE_COLOR: Record<string, [number, number, number]> = {
  draft: [100, 116, 139], issued: [22, 101, 52], final: [22, 101, 52], void: [190, 18, 60],
};

export async function renderAccountingPdf(model: AccountingPdfModel): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 15;
  const rtl = model.direction === "rtl";
  const startX = rtl ? W - M : M;
  // Phase 11 controlled template options (bounded; safe defaults).
  const templateFont = model.render?.fontFamily || "helvetica";
  const HS = model.render?.headingSize || 15;
  const accent = model.render?.accent || [234, 88, 12];
  const logoMm = model.render?.logoSizeMm || 22;
  // Arabic: register IBM Plex Sans Arabic + shape text to visual order.
  // Falls back to the Latin font + sanitizer if the font asset is missing.
  const wantArabic = model.language === "ar";
  const arabic = wantArabic && registerArabicFont(doc);
  const FONT = arabic ? ARABIC_FONT_NAME : templateFont;
  const sanitize = arabic ? (v: unknown) => toVisualArabic(String(v ?? "")) : sanitizeLatin;
  const text = (v: unknown, x: number, y: number, opts?: any) => doc.text(sanitize(v), x, y, opts);
  // Direction-aware line: label+value laid out from the leading edge.
  const label = (v: unknown, y: number) => text(v, startX, y, { align: rtl ? "right" : "left" });

  // ── Header band ──
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 0, W, 28, "F");
  // Logo (data: URI only — no network in this environment).
  let logoDrawn = false;
  if (model.company.logoUrl && model.company.logoUrl.startsWith("data:image")) {
    try {
      const fmt = model.company.logoUrl.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(model.company.logoUrl, fmt, rtl ? W - M - logoMm : M, 4, logoMm, Math.min(20, logoMm));
      logoDrawn = true;
    } catch { /* fall back to text */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont(FONT, "bold");
  doc.setFontSize(HS);
  const nameX = logoDrawn ? (rtl ? W - M - (logoMm + 4) : M + (logoMm + 4)) : startX;
  text(model.company.name, nameX, 12, { align: rtl ? "right" : "left" });
  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  const contact = [model.company.address, [model.company.phone, model.company.email].filter(Boolean).join("  ·  "), model.company.website].filter(Boolean).slice(0, 2);
  contact.forEach((c, i) => text(c!, nameX, 17 + i * 4, { align: rtl ? "right" : "left" }));

  // Document title + badge (opposite edge).
  const titleX = rtl ? M : W - M;
  doc.setFont(FONT, "bold");
  doc.setFontSize(13);
  text(model.title, titleX, 12, { align: rtl ? "left" : "right" });
  if (model.badge) {
    const [r, g, b] = BADGE_COLOR[model.badge.kind] || BADGE_COLOR.issued;
    doc.setFillColor(r, g, b);
    const bw = 34, bx = rtl ? M : W - M - bw;
    doc.roundedRect(bx, 16, bw, 8, 1.5, 1.5, "F");
    doc.setFontSize(9);
    text(model.badge.text, bx + bw / 2, 21.5, { align: "center" });
  }

  doc.setTextColor(15, 23, 42);
  let y = 36;

  // Internal notice banner (voucher / cost statement).
  if (model.internalNotice) {
    doc.setFillColor(254, 226, 226);
    doc.rect(M, y - 4, W - 2 * M, 7, "F");
    doc.setTextColor(153, 27, 27);
    doc.setFont(FONT, "bold");
    doc.setFontSize(8);
    text(model.internalNotice, W / 2, y + 0.5, { align: "center" });
    doc.setTextColor(15, 23, 42);
    y += 9;
  }

  // ── Parties + meta grid ──
  doc.setFontSize(9);
  for (const p of model.parties) {
    doc.setFont(FONT, "bold");
    label(`${p.label}: `, y);
    doc.setFont(FONT, "normal");
    const off = rtl ? -doc.getTextWidth(sanitize(p.label + ": ")) : doc.getTextWidth(sanitize(p.label + ": "));
    text(p.value, startX + off, y, { align: rtl ? "right" : "left" });
    y += 6;
  }
  y += 1;
  const half = model.meta.length > 4 ? Math.ceil(model.meta.length / 2) : model.meta.length;
  const colGap = (W - 2 * M) / 2;
  model.meta.forEach((row, i) => {
    const col = i < half ? 0 : 1;
    const rowY = y + (i % half) * 5.5;
    const baseX = rtl ? W - M - col * colGap : M + col * colGap;
    doc.setFont(FONT, "bold"); doc.setFontSize(8);
    text(`${row.label}:`, baseX, rowY, { align: rtl ? "right" : "left" });
    doc.setFont(FONT, "normal");
    const lw = rtl ? -doc.getTextWidth(sanitize(row.label + ": ")) : doc.getTextWidth(sanitize(row.label + ": "));
    text(row.value, baseX + lw, rowY, { align: rtl ? "right" : "left" });
  });
  y += half * 5.5 + 4;

  // ── Line-item table ──
  if (model.columns && model.rows) {
    y = drawTable(doc, model.columns, model.rows, y, W, M, rtl, sanitize, FONT);
  }

  // ── Totals (leading edge, opposite side) ──
  if (model.totals && model.totals.length) {
    y += 2;
    for (const t of model.totals) {
      doc.setFont(FONT, t.strong ? "bold" : "normal");
      doc.setFontSize(t.strong ? 11 : 9);
      const tx = rtl ? M : W - M;
      text(`${t.label}:  ${t.value}`, tx, y, { align: rtl ? "left" : "right" });
      y += t.strong ? 7 : 5.5;
    }
  }

  // ── Payment terms + notes ──
  doc.setFontSize(8); doc.setTextColor(71, 85, 105);
  if (model.paymentTerms) { doc.setFont(FONT, "bold"); label(model.paymentTerms, y); y += 5; }
  if (model.notes) {
    doc.setFont(FONT, "normal");
    const lines = doc.splitTextToSize(sanitize(model.notes), W - 2 * M) as string[];
    lines.forEach((ln) => { label(ln, y); y += 4.5; });
    y += 2;
  }
  doc.setTextColor(15, 23, 42);

  // ── Bank block ──
  if (model.flags.showBank && model.bank) {
    const b = model.bank;
    doc.setDrawColor(226, 232, 240); doc.setFillColor(248, 250, 252);
    doc.roundedRect(M, y, W - 2 * M, 22, 1.5, 1.5, "FD");
    doc.setFont(FONT, "bold"); doc.setFontSize(8);
    label("Bank Details", y + 5.5);
    doc.setFont(FONT, "normal");
    const bl = [`${b.bankName}${b.branch ? " — " + b.branch : ""}`, `${b.accountHolderName}  ·  ${b.accountNumber}`, [b.iban ? "IBAN: " + b.iban : "", b.swift ? "SWIFT: " + b.swift : "", b.currency].filter(Boolean).join("   ")];
    bl.forEach((ln, i) => label(ln, y + 11 + i * 4.5));
    y += 26;
  }

  // ── Signature / stamp ──
  if (model.flags.showSignature || model.flags.showStamp) {
    const sy = Math.min(y + 6, H - 40);
    doc.setDrawColor(148, 163, 184);
    if (model.flags.showSignature) {
      const sx = rtl ? W - M - 55 : M;
      if (model.company.signatureUrl?.startsWith("data:image")) { try { doc.addImage(model.company.signatureUrl, "PNG", sx, sy, 40, 14); } catch { /* ignore */ } }
      doc.line(sx, sy + 16, sx + 55, sy + 16);
      doc.setFontSize(7.5); text("Authorized Signature", sx, sy + 20);
    }
    if (model.flags.showStamp && model.company.stampUrl?.startsWith("data:image")) {
      const tx = rtl ? M : W - M - 30;
      try { doc.addImage(model.company.stampUrl, "PNG", tx, sy, 28, 28); } catch { /* ignore */ }
    }
  }

  // ── Watermark for non-issued docs ──
  if (model.badge && (model.badge.kind === "draft" || model.badge.kind === "void")) {
    doc.setTextColor(226, 232, 240); doc.setFont(FONT, "bold"); doc.setFontSize(72);
    try { (doc as any).text(sanitize(model.badge.text), W / 2, H / 2, { align: "center", angle: 35 }); } catch { /* older jsPDF */ }
    doc.setTextColor(15, 23, 42);
  }

  // ── Footer + page numbers on every page ──
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.line(M, H - 14, W - M, H - 14);
    doc.setFont(FONT, "normal"); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
    if (model.footerText) doc.text(sanitize(model.footerText), rtl ? W - M : M, H - 9, { align: rtl ? "right" : "left" });
    if (model.flags.showPageNumbers) doc.text(`Page ${p} / ${pages}`, rtl ? M : W - M, H - 9, { align: rtl ? "left" : "right" });
    doc.setTextColor(15, 23, 42);
  }

  return Buffer.from(doc.output("arraybuffer"));
}

function drawTable(doc: any, columns: PdfColumn[], rows: Record<string, string>[], startY: number, W: number, M: number, rtl: boolean, sanitize: (v: unknown) => string, FONT: string): number {
  const usable = W - 2 * M;
  // First column is flexible; the rest are fixed-ish.
  const fixed = Math.min(30, usable / (columns.length + 1));
  const firstW = usable - fixed * (columns.length - 1);
  const widths = columns.map((_, i) => (i === 0 ? firstW : fixed));
  // x positions per column, honoring direction (column 0 on the leading edge).
  const xs: number[] = [];
  let acc = rtl ? W - M : M;
  for (let i = 0; i < columns.length; i++) {
    xs.push(acc);
    acc += (rtl ? -1 : 1) * widths[i];
  }
  let y = startY;
  // Header row.
  doc.setFillColor(241, 245, 249); doc.rect(M, y - 4.5, usable, 7, "F");
  doc.setFont(FONT, "bold"); doc.setFontSize(8); doc.setTextColor(51, 65, 85);
  columns.forEach((c, i) => {
    const align = c.align === "right" ? (rtl ? "left" : "right") : (rtl ? "right" : "left");
    const x = c.align === "right" ? xs[i] + (rtl ? -widths[i] + 2 : widths[i] - 2) : xs[i] + (rtl ? -2 : 2);
    doc.text(sanitize(c.label), x, y, { align });
  });
  y += 5;
  doc.setFont(FONT, "normal"); doc.setTextColor(15, 23, 42);
  for (const row of rows) {
    if (y > 265) { doc.addPage(); y = 20; }
    columns.forEach((c, i) => {
      const align = c.align === "right" ? (rtl ? "left" : "right") : (rtl ? "right" : "left");
      const x = c.align === "right" ? xs[i] + (rtl ? -widths[i] + 2 : widths[i] - 2) : xs[i] + (rtl ? -2 : 2);
      const cell = doc.splitTextToSize(sanitize(row[c.key] ?? ""), widths[i] - 3) as string[];
      doc.text(cell[0] ?? "", x, y, { align });
    });
    doc.setDrawColor(241, 245, 249); doc.line(M, y + 1.5, W - M, y + 1.5);
    y += 6;
  }
  return y + 2;
}
