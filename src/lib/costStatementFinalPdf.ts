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

const sanitize = (v: unknown): string =>
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

  const text = (v: unknown, x: number, yy: number, opts?: any) => doc.text(sanitize(v), x, yy, opts);

  // Header band (MARAS brand orange).
  doc.setFillColor(234, 88, 12);
  doc.rect(0, 0, W, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  text(model.title, M, 12);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  text(model.internalNotice, M, 19);

  // FINAL badge.
  doc.setFillColor(22, 101, 52);
  doc.roundedRect(W - M - 62, 5, 62, 16, 2, 2, "F");
  doc.setFont("helvetica", "bold");
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
    doc.setFont("helvetica", "bold");
    text(`${meta[i][0]}:`, x, ry);
    doc.setFont("helvetica", "normal");
    text(meta[i][1], x + 38, ry);
  }
  y += Math.ceil(meta.length / 2) * 6 + 6;

  // Cost items table.
  doc.setFont("helvetica", "bold");
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
  doc.setFont("helvetica", "normal");
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
    ["Customer Agreed", model.agreedAmount === null ? "—" : `${money(model.agreedAmount)} ${model.agreedCurrency || ""}`],
    ["Customer Received", `${money(model.customerReceived)} ${model.agreedCurrency || ""}`],
    ["Customer Receivable", `${money(model.customerReceivable)} ${model.agreedCurrency || ""}`],
  ];
  if (model.customerCredit > 0) totals.push(["Customer Credit", `${money(model.customerCredit)} ${model.agreedCurrency || ""}`]);
  totals.push(["Gross Profit", model.grossProfit === null ? "N/A" : `${money(model.grossProfit)} ${model.currency}`]);
  doc.setFontSize(9);
  for (const [label, val] of totals) {
    doc.setFont("helvetica", "bold");
    text(`${label}:`, W - M - 70, y);
    doc.setFont("helvetica", "normal");
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
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    text("Notes", M, y);
    y += 5;
    doc.setFont("helvetica", "normal");
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
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  text("Approval Record", M, y);
  y += 6;
  doc.setFontSize(9);
  for (const a of model.approvals) {
    doc.setFont("helvetica", "bold");
    text(`${a.label}:`, M, y);
    doc.setFont("helvetica", "normal");
    text(a.name, M + 45, y);
    text(a.approvedAt ? `${a.status} — ${a.approvedAt}` : a.status, W - M - 2, y, { align: "right" });
    y += 6;
  }

  const ab = doc.output("arraybuffer");
  return Buffer.from(ab);
}
