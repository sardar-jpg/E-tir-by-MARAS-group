/**
 * chatImageOptimize.ts — dependency-free, document-safe browser-side image
 * optimization for chat attachments (feature/admin-chat-mobile-ux-pass).
 *
 * A phone photo is typically 3–8 MB; uploading it as base64 JSON inflates
 * it ~33% further, which is most of why image sending FELT slow. This
 * module conservatively shrinks what can safely shrink and touches
 * nothing else:
 *
 *   JPEG / WebP   downscale only when the long edge exceeds 1600 px
 *                 (never enlarge); re-encode as JPEG at quality 0.82 when
 *                 downscaled or when the original is over 300 KB.
 *   PNG           NEVER converted to JPEG (screenshots of documents and
 *                 transparency both survive); only downscaled — still as
 *                 PNG — when the long edge exceeds 1600 px.
 *   ≤ 300 KB      passes through unchanged (unless oversized in pixels).
 *   HEIC/HEIF     explicitly UNSUPPORTED (the server allowlist rejects it
 *                 and no conversion dependency is added in this pass) —
 *                 reported as a distinct result so the UI shows a clear
 *                 message instead of failing silently. iOS often hands the
 *                 web file input a converted JPEG already; this branch
 *                 only triggers when a real HEIC file arrives.
 *   anything else passes through untouched — the server's validateUpload
 *                 allowlist remains the real gate.
 *
 * Any decode/encode failure falls back to the ORIGINAL file — optimization
 * is an optimization, never a gatekeeper. EXIF orientation is corrected by
 * decoding with createImageBitmap({ imageOrientation: 'from-image' });
 * decoding happens off the main thread in modern engines, and the bitmap
 * is closed afterwards to release memory. If a re-encode somehow comes out
 * LARGER than the original, the original wins.
 *
 * The DECISION logic is a pure function (planImageOptimization) so the
 * thresholds are unit-testable without a DOM; only optimizeChatImage
 * touches browser APIs.
 */

export const CHAT_IMAGE_MAX_LONG_EDGE_PX = 1600;
export const CHAT_IMAGE_JPEG_QUALITY = 0.82;
export const CHAT_IMAGE_PASSTHROUGH_BYTES = 300 * 1024;

const OPTIMIZABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isLikelyHeic(file: Pick<File, "type" | "name">): boolean {
  const type = (file.type || "").toLowerCase();
  if (type === "image/heic" || type === "image/heif" || type === "image/heic-sequence" || type === "image/heif-sequence") return true;
  const name = (file.name || "").toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

export type ImageOptimizationPlan =
  | { action: "unsupported_heic" }
  | { action: "passthrough"; reason: "not_optimizable_type" | "already_small" }
  | {
      action: "reencode";
      targetWidth: number;
      targetHeight: number;
      outputType: "image/jpeg" | "image/png";
      quality: number | undefined;
      reason: "oversized_dimensions" | "oversized_bytes";
    };

/** Scale (never enlarge) so the long edge is at most CHAT_IMAGE_MAX_LONG_EDGE_PX. */
export function scaleToMaxLongEdge(width: number, height: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= CHAT_IMAGE_MAX_LONG_EDGE_PX) return { width, height };
  const factor = CHAT_IMAGE_MAX_LONG_EDGE_PX / longEdge;
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}

export function planImageOptimization(input: {
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  width: number;
  height: number;
}): ImageOptimizationPlan {
  if (isLikelyHeic({ type: input.mimeType, name: input.fileName })) return { action: "unsupported_heic" };
  const type = (input.mimeType || "").toLowerCase();
  if (!OPTIMIZABLE_TYPES.has(type)) return { action: "passthrough", reason: "not_optimizable_type" };

  const oversizedDims = Math.max(input.width, input.height) > CHAT_IMAGE_MAX_LONG_EDGE_PX;
  const scaled = scaleToMaxLongEdge(input.width, input.height);

  if (type === "image/png") {
    // Document-safe: PNG stays PNG (transparency + crisp text preserved);
    // only pixel-oversized PNGs are downscaled.
    if (oversizedDims) {
      return { action: "reencode", targetWidth: scaled.width, targetHeight: scaled.height, outputType: "image/png", quality: undefined, reason: "oversized_dimensions" };
    }
    return { action: "passthrough", reason: "already_small" };
  }

  // JPEG / WebP → JPEG output.
  if (oversizedDims) {
    return { action: "reencode", targetWidth: scaled.width, targetHeight: scaled.height, outputType: "image/jpeg", quality: CHAT_IMAGE_JPEG_QUALITY, reason: "oversized_dimensions" };
  }
  if (input.sizeBytes > CHAT_IMAGE_PASSTHROUGH_BYTES) {
    return { action: "reencode", targetWidth: input.width, targetHeight: input.height, outputType: "image/jpeg", quality: CHAT_IMAGE_JPEG_QUALITY, reason: "oversized_bytes" };
  }
  return { action: "passthrough", reason: "already_small" };
}

export type ChatImageOptimizeResult =
  | { kind: "ok"; blob: Blob; fileName: string; mimeType: string; optimized: boolean }
  | { kind: "unsupported_heic" };

function renameForType(fileName: string, outputType: string): string {
  if (outputType !== "image/jpeg") return fileName;
  const base = fileName.replace(/\.(jpe?g|png|webp)$/i, "");
  return `${base}.jpg`;
}

/**
 * Browser entry point. Never throws: every failure path resolves to the
 * original file (kind "ok", optimized false) except a genuine HEIC/HEIF,
 * which resolves to "unsupported_heic" for the caller's clear message.
 */
export async function optimizeChatImage(file: File): Promise<ChatImageOptimizeResult> {
  if (isLikelyHeic(file)) return { kind: "unsupported_heic" };
  const original: ChatImageOptimizeResult = { kind: "ok", blob: file, fileName: file.name, mimeType: file.type, optimized: false };
  if (!OPTIMIZABLE_TYPES.has((file.type || "").toLowerCase())) return original;

  let bitmap: ImageBitmap | null = null;
  try {
    // 'from-image' applies the EXIF orientation during decode, so a
    // sideways iPhone photo comes out upright.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const plan = planImageOptimization({
      mimeType: file.type,
      fileName: file.name,
      sizeBytes: file.size,
      width: bitmap.width,
      height: bitmap.height,
    });
    if (plan.action !== "reencode") return original;

    const canvas = document.createElement("canvas");
    canvas.width = plan.targetWidth;
    canvas.height = plan.targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(bitmap, 0, 0, plan.targetWidth, plan.targetHeight);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, plan.outputType, plan.quality)
    );
    canvas.width = 0;
    canvas.height = 0;
    if (!blob || blob.size === 0) return original;
    // An "optimization" that grew the file is not one — original wins.
    if (blob.size >= file.size) return original;
    return { kind: "ok", blob, fileName: renameForType(file.name, plan.outputType), mimeType: plan.outputType, optimized: true };
  } catch {
    return original;
  } finally {
    bitmap?.close?.();
  }
}
