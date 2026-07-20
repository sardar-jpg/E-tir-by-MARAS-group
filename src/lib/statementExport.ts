/**
 * Pure CSV serialization for an account statement (customer AR or vendor AP).
 * Presentation only — the figures are exactly those the server returned; this
 * helper never computes or alters a balance. Opens cleanly in Excel/Sheets.
 */
export interface StatementCsvRow {
  date: string;
  type: string;
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementCsvInput {
  title: string;
  entity: string;
  currency: string;
  from?: string;
  to?: string;
  openingBalance: number;
  rows: StatementCsvRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

const num = (n: number): string => (Number.isFinite(n) ? n : 0).toFixed(2);

/** RFC-4180-safe CSV cell: quote when it contains a comma, quote or newline. */
export function csvCell(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function line(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

/** Serialize a full statement (header block + ledger rows + totals) to CSV text. */
export function statementToCsv(input: StatementCsvInput): string {
  const lines: string[] = [];
  lines.push(line([input.title]));
  lines.push(line([input.entity]));
  lines.push(line(["Currency", input.currency]));
  if (input.from || input.to) lines.push(line(["Period", `${input.from || "—"} → ${input.to || "—"}`]));
  lines.push("");
  lines.push(line(["Date", "Type", "Reference", "Description", "Debit", "Credit", "Balance"]));
  lines.push(line(["", "", "", "Opening balance", "", "", num(input.openingBalance)]));
  for (const r of input.rows) {
    lines.push(line([r.date, r.type, r.ref, r.description, r.debit ? num(r.debit) : "", r.credit ? num(r.credit) : "", num(r.balance)]));
  }
  lines.push(line(["", "", "", "Totals", num(input.totalDebit), num(input.totalCredit), ""]));
  lines.push(line(["", "", "", `Closing balance (${input.currency})`, "", "", num(input.closingBalance)]));
  return lines.join("\r\n");
}
