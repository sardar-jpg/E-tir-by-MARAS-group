import type { ReactNode } from "react";

/**
 * Responsive KPI row: two columns on phones, three on tablets, all six in
 * one row on wide desktop. Equal-height cards (each KpiCard is h-full).
 */
export default function KpiGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {children}
    </div>
  );
}
