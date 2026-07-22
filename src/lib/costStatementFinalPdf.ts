/**
 * costStatementFinalPdf.ts — server-side renderer for the final
 * approved-and-closed cost statement PDF (PR #6). Runs jsPDF in Node
 * (dynamically imported, like the client export in AdminPanel.tsx) and
 * draws EXACTLY the pure FinalPdfModel snapshot — never live data. Returns
 * a Buffer for the existing Firebase Storage save path.
 *
 * MARAS branding is applied consistently with the interactive export
 * (same header band + typographic hierarchy); the Latin-only text
 * sanitizer mirrors the client export so Turkish characters render safely.
 */
import type { FinalPdfModel } from "./costStatementFinalPdfModel";
import { toVisualArabic } from "./arabicShaping";
import { registerArabicFont, ARABIC_FONT_NAME } from "./arabicPdfFont";

const sanitizeLatin = (v: unknown): string =>
  String(v ?? "")
    .replace(/ı/g, "i").replace(/İ/g, "I").replace(/ş/g, "s").replace(/Ş/g, "S")
    .replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ç/g, "c").replace(/Ç/g, "C")
    .replace(/ö/g, "o").replace(/Ö/g, "O").replace(/ü/g, "u").replace(/Ü/g, "U");

const money = (v: number): string => (Number.isFinite(v) ? v : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function renderFinalCostStatementPdf(model: FinalPdfModel): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210;
  const M = 15;
  let y = 0;

  // Arabic support (same approach as the shared accounting renderer): embed
  // IBM Plex Sans Arabic + shape to visual order; fall back to Latin if the
  // font asset is missing. Font family switches to Arabic when direction=rtl.
  const arabic = model.direction === "rtl" && registerArabicFont(doc);
  const FONT = arabic ? ARABIC_FONT_NAME : "helvetica";
  const sanitize = arabic ? (v: unknown) => toVisualArabic(String(v ?? "")) : sanitizeLatin;
  const text = (v: unknown, x: number, yy: number, opts?: any) => doc.text(sanitize(v), x, yy, opts);

  // Header band (MARAS brand orange).
  doc.setFillColor(234, 88, 12);
  doc.rect(0, 0, W, 26, "F");
  // Phase 10: Company Profile logo (data: URI only — no network here).
  let titleX = M;
  if (model.brandLogoUrl && model.brandLogoUrl.startsWith("data:image")) {
    try {
      doc.addImage(model.brandLogoUrl, model.brandLogoUrl.includes("image/png") ? "PNG" : "JPEG", M, 4, 18, 18);
      titleX = M + 22;
    } catch { /* fall back to text-only header */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont(FONT, "bold");
  doc.setFontSize(15);
  text(model.brandName || model.title, titleX, 11);
  doc.setFontSize(8);
  doc.setFont(FONT, "normal");
  if (model.brandName) text(model.title, titleX, 16);
  text(model.internalNotice, titleX, model.brandName ? 21 : 19);

  // FINAL badge.
  doc.setFillColor(22, 101, 52);
  doc.roundedRect(W - M - 62, 5, 62, 16, 2, 2, "F");
  doc.setFont(FONT, "bold");
  doc.setFontSize(10);
  text(model.finalLabel, W - M - 31, 14, { align: "center" });

  y = 36;
  doc.setTextColor(15, 23, 42);

  // Metadata grid.
  doc.setFontSize(9);
  const meta: Array<[string, string]> = [
    ["Shipment Ref", model.shipmentNumber],
    ["Customer", model.companyName],
    ["Freight Type", model.freightType],
    ["Statement Date", model.statementDate],
    ["Statement Currency", model.currency],
    ["Final Revision", `Rev-${model.finalStatementRevision}`],
    ["Finalized At", model.finalizedAt],
  ];
  for (let i = 0; i < meta.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * 95;
    const ry = y + row * 6;
    doc.setFont(FONT, "bold");
    text(`${meta[i][0]}:`, x, ry);
    doc.setFont(FONT, "normal");
    text(meta[i][1], x + 38, ry);
  }
  y += Math.ceil(meta.length / 2) * 6 + 6;

  // Cost items table.
  doc.setFont(FONT, "bold");
  doc.setFontSize(10);
  text("Cost Item Breakdown", M, y);
  y += 4;
  doc.setFillColor(241, 245, 249);
  doc.rect(M, y, W - 2 * M, 7, "F");
  doc.setFontSize(8);
  text("Description", M + 2, y + 5);
  text("Supplier", M + 62, y + 5);
  text("Qty", M + 110, y + 5, { align: "right" });
  text("Unit", M + 140, y + 5, { align: "right" });
  text("Line Total", W - M - 2, y + 5, { align: "right" });
  y += 9;
  doc.setFont(FONT, "normal");
  for (const it of model.items) {
    if (y > 250) { doc.addPage(); y = 20; }
    text(it.description.slice(0, 34), M + 2, y);
    text(it.supplierName.slice(0, 26), M + 62, y);
    text(String(it.quantity), M + 110, y, { align: "right" });
    text(money(it.unitPrice), M + 140, y, { align: "right" });
    text(`${money(it.totalAmount)} ${it.currency}`, W - M - 2, y, { align: "right" });
    y += 6;
  }
  y += 2;
  doc.setDrawColor(203, 213, 225);
  doc.line(M, y, W - M, y);
  y += 6;

  // Totals block.
  const totals: Array<[string, string]> = [
    ["Total Cost", `${money(model.totalCost)} ${model.currency}`],
    ["Expense Paid", `${money(model.paidAmount)} ${model.currency}`],
    ["Expense Remaining", `${money(model.expenseRemaining)} ${model.currency}`],
    ["Driver Agreed Amount (Reference Only)", model.agreedAmount === null ? "—" : `${money(model.agreedAmount)} ${model.agreedCurrency || ""}`],
    ["Customer Received", `${money(model.customerReceived)} ${model.invoiceCurrency || ""}`],
    ["Customer Receivable", `${money(model.customerReceivable)} ${model.invoiceCurrency || ""}`],
  ];
  if (model.customerCredit > 0) totals.push(["Customer Credit", `${money(model.customerCredit)} ${model.invoiceCurrency || ""}`]);
  totals.push(["Gross Profit", model.grossProfit === null ? (model.grossProfitNote || "Pending") : `${money(model.grossProfit)} ${model.invoiceCurrency || model.currency}`]);
  doc.setFontSize(9);
  for (const [label, val] of totals) {
    doc.setFont(FONT, "bold");
    text(`${label}:`, W - M - 70, y);
    doc.setFont(FONT, "normal");
    text(val, W - M - 2, y, { align: "right" });
    y += 6;
  }
  if (model.grossProfitNote) {
    doc.setFontSize(7);
    doc.setTextColor(180, 83, 9);
    text(model.grossProfitNote, M, y);
    doc.setTextColor(15, 23, 42);
    y += 6;
  }

  // Notes.
  if (model.notes) {
    y += 2;
    doc.setFont(FONT, "bold");
    doc.setFontSize(9);
    text("Notes", M, y);
    y += 5;
    doc.setFont(FONT, "normal");
    doc.setFontSize(8);
    for (const line of doc.splitTextToSize(sanitize(model.notes), W - 2 * M) as string[]) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.text(line, M, y);
      y += 5;
    }
  }

  // Approval section.
  if (y > 235) { doc.addPage(); y = 20; }
  y += 4;
  doc.setFont(FONT, "bold");
  doc.setFontSize(10);
  text("Approval Record", M, y);
  y += 6;
  doc.setFontSize(9);
  for (const a of model.approvals) {
    doc.setFont(FONT, "bold");
    text(`${a.label}:`, M, y);
    doc.setFont(FONT, "normal");
    text(a.name, M + 45, y);
    text(a.approvedAt ? `${a.status} — ${a.approvedAt}` : a.status, W - M - 2, y, { align: "right" });
    y += 6;
  }

  // Phase 10: signature + stamp (from Company Profile, data: URIs only).
  const sy = Math.min(y + 8, 250);
  if (model.brandSignatureUrl?.startsWith("data:image")) { try { doc.addImage(model.brandSignatureUrl, "PNG", M, sy, 40, 14); } catch { /* ignore */ } }
  doc.setDrawColor(148, 163, 184); doc.line(M, sy + 16, M + 55, sy + 16);
  doc.setFontSize(7.5); text("Authorized Signature", M, sy + 20);
  if (model.brandStampUrl?.startsWith("data:image")) { try { doc.addImage(model.brandStampUrl, "PNG", W - M - 30, sy, 28, 28); } catch { /* ignore */ } }

  // Phase 10: footer with company footer text + page numbers on every page.
  const H = 297;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.line(M, H - 14, W - M, H - 14);
    doc.setFont(FONT, "normal"); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
    if (model.brandFooterText) doc.text(sanitize(model.brandFooterText), M, H - 9);
    doc.text(`Page ${p} / ${pages}`, W - M, H - 9, { align: "right" });
    doc.setTextColor(15, 23, 42);
  }

  const ab = doc.output("arraybuffer");
  return Buffer.from(ab);
}
