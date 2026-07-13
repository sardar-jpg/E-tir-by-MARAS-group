/**
 * firebaseStorageUrl.ts
 *
 * Builds the same permanent, non-expiring Firebase Storage download URL
 * format the client SDK's getDownloadURL() (and firebase-admin/storage's
 * own getDownloadURL() helper, which does an extra authenticated read to
 * look the token back up) produce — a token-based `?alt=media&token=...`
 * URL keyed off a `firebaseStorageDownloadTokens` metadata value set at
 * upload time. Unlike a signed URL, this never expires and is never
 * revoked by anything in this app (see BUG-12 in server.ts's /api/upload
 * route) — do not replace this with a signed-URL helper without treating
 * that as a deliberate behavior change.
 *
 * Building the URL locally (instead of calling firebase-admin/storage's
 * getDownloadURL, which re-fetches the metadata over the network) is safe
 * here because the caller already knows the token — it just set it as part
 * of the same upload.
 */
export function buildFirebaseDownloadUrl(
  bucketName: string,
  objectPath: string,
  downloadToken: string
): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
}
