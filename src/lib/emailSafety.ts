/**
 * emailSafety.ts
 *
 * Small guard for the Gmail composer in AdminPanel.tsx (Google Workspace
 * tab): before an operational email is dispatched via the Gmail API, the
 * subject/body are checked for a raw Firebase/Google Cloud Storage
 * download URL. Those URLs carry a long-lived, non-revocable access token
 * (see documentAccess.ts) — pasting one into free-text email content would
 * hand whoever receives the email a permanent link to a private document,
 * bypassing the safe, revocable /api/share/:token/documents/:docId proxy
 * links the public tracking view uses instead.
 */

const RAW_STORAGE_URL_PATTERNS = [
  /firebasestorage\.googleapis\.com/i,
  /firebasestorage\.app/i,
  /storage\.googleapis\.com/i,
];

export function containsRawPrivateDocumentUrl(text: string): boolean {
  return RAW_STORAGE_URL_PATTERNS.some((pattern) => pattern.test(text || ""));
}
