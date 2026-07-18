/**
 * imageLightboxState.ts — pure zoom math for the shared in-app image
 * lightbox (src/components/ImageLightbox.tsx), extracted so the clamping
 * and double-tap rules are unit-testable without a DOM (this repo's
 * plain-Vitest convention).
 */
export const LIGHTBOX_MIN_ZOOM = 1;
export const LIGHTBOX_MAX_ZOOM = 6;
export const LIGHTBOX_DOUBLE_TAP_ZOOM = 2.5;

/** Zoom is always clamped to [1, 6]; non-finite input resolves to 1 (never NaN into a CSS transform). */
export function clampLightboxZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return LIGHTBOX_MIN_ZOOM;
  return Math.min(LIGHTBOX_MAX_ZOOM, Math.max(LIGHTBOX_MIN_ZOOM, zoom));
}

/** Double-tap toggles between fit (1x) and a comfortable reading zoom. */
export function nextDoubleTapZoom(currentZoom: number): number {
  return currentZoom > LIGHTBOX_MIN_ZOOM ? LIGHTBOX_MIN_ZOOM : LIGHTBOX_DOUBLE_TAP_ZOOM;
}
