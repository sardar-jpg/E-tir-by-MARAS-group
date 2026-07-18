import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Share2, Download, ZoomIn, ZoomOut } from 'lucide-react';
import { clampLightboxZoom, nextDoubleTapZoom, LIGHTBOX_MIN_ZOOM, LIGHTBOX_MAX_ZOOM } from '../lib/imageLightboxState';

/**
 * ImageLightbox — the ONE in-app full-screen image viewer shared by every
 * admin chat surface (Chat Center + the desktop chat drawer).
 *
 * fix/admin-mobile-chat-correctness: chat image attachments used to be
 * plain <a target="_blank"> anchors around the thumbnail, which in the
 * iOS WebView shell navigated the WebView itself to the raw Storage URL —
 * a dead-end web page instead of an in-app viewer. This component never
 * navigates: the image renders inside a fixed overlay with pinch/wheel
 * zoom + drag pan, an explicit close button, and optional share/download
 * actions that reuse the SAME already-safe URL (navigator.share when the
 * platform offers it; the download anchor is the one deliberate,
 * user-initiated exception to "no navigation").
 *
 * Zoom/pan implementation notes: WKWebView doesn't pinch-zoom page
 * content when the viewport is fixed, so gestures are handled manually
 * via Pointer Events — two active pointers = pinch (distance ratio scales
 * zoom around the current center), one pointer while zoomed = pan,
 * double-tap/double-click toggles 1x ↔ 2.5x, wheel zooms on desktop. All
 * pure zoom math lives in src/lib/imageLightboxState.ts (unit-tested).
 */
export interface ImageLightboxTarget {
  url: string;
  name: string;
}

interface ImageLightboxProps {
  target: ImageLightboxTarget | null;
  onClose: () => void;
  /** Localized action labels (the caller owns translation). */
  labels: { close: string; share: string; download: string };
}

export default function ImageLightbox({ target, onClose, labels }: ImageLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const lastTapRef = useRef(0);
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function';

  // Reset the view whenever a different image opens.
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    pointersRef.current.clear();
    pinchStartRef.current = null;
    panStartRef.current = null;
  }, [target?.url]);

  // Escape closes (desktop keyboard affordance).
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  const applyZoom = useCallback((next: number) => {
    setZoom((prev) => {
      const clamped = clampLightboxZoom(next);
      if (clamped <= LIGHTBOX_MIN_ZOOM) setOffset({ x: 0, y: 0 });
      return clamped === prev ? prev : clamped;
    });
  }, []);

  if (!target) return null;

  const pinchDistance = () => {
    const pts = Array.from(pointersRef.current.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      pinchStartRef.current = { distance: pinchDistance(), zoom };
      panStartRef.current = null;
    } else if (pointersRef.current.size === 1) {
      panStartRef.current = { x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y };
      // Double-tap / double-click zoom toggle.
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        applyZoom(nextDoubleTapZoom(zoom));
        panStartRef.current = null;
      }
      lastTapRef.current = now;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const start = pinchStartRef.current;
      const dist = pinchDistance();
      if (start.distance > 0 && dist > 0) applyZoom(start.zoom * (dist / start.distance));
    } else if (pointersRef.current.size === 1 && panStartRef.current && zoom > 1) {
      const start = panStartRef.current;
      setOffset({ x: start.offsetX + (e.clientX - start.x), y: start.offsetY + (e.clientY - start.y) });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchStartRef.current = null;
    if (pointersRef.current.size === 0) panStartRef.current = null;
  };

  const handleShare = async () => {
    try {
      await (navigator as any).share({ title: target.name, url: target.url });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={target.name}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2">
        <p className="text-xs font-semibold text-white/80 truncate min-w-0">{target.name}</p>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => applyZoom(zoom / 1.5)}
            aria-label="Zoom out"
            disabled={zoom <= LIGHTBOX_MIN_ZOOM}
            className="hidden sm:flex w-9 h-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 disabled:opacity-30"
          >
            <ZoomOut className="w-4.5 h-4.5" />
          </button>
          <button
            type="button"
            onClick={() => applyZoom(zoom * 1.5)}
            aria-label="Zoom in"
            disabled={zoom >= LIGHTBOX_MAX_ZOOM}
            className="hidden sm:flex w-9 h-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 disabled:opacity-30"
          >
            <ZoomIn className="w-4.5 h-4.5" />
          </button>
          {canShare && (
            <button
              type="button"
              onClick={handleShare}
              aria-label={labels.share}
              title={labels.share}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-white/80 hover:bg-white/10"
            >
              <Share2 className="w-4.5 h-4.5" />
            </button>
          )}
          <a
            href={target.url}
            download={target.name}
            target="_blank"
            rel="noreferrer"
            aria-label={labels.download}
            title={labels.download}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-white/80 hover:bg-white/10"
          >
            <Download className="w-4.5 h-4.5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            title={labels.close}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-white bg-white/10 hover:bg-white/20"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div
        className="flex-1 min-h-0 overflow-hidden flex items-center justify-center select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <img
          src={target.url}
          alt={target.name}
          draggable={false}
          className="max-w-full max-h-full object-contain"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transition: pointersRef.current.size > 0 ? 'none' : 'transform 120ms ease-out',
          }}
        />
      </div>
      <div className="pb-[max(env(safe-area-inset-bottom),0.5rem)]" />
    </div>
  );
}
