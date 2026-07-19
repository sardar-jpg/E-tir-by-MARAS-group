import { apiFetch } from "./api";

/**
 * Fetch an accounting PDF WITH the session's auth header (the PDF routes are
 * Bearer-gated, so a plain window.open would 401), then open it inline in a
 * new tab where the browser gives clean print + download. Returns false on
 * failure so callers can surface an error.
 */
export async function openAccountingPdf(path: string): Promise<boolean> {
  try {
    const res = await apiFetch(path);
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    // Revoke shortly after the tab has had a chance to load the blob.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return !!win;
  } catch {
    return false;
  }
}
