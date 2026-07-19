/**
 * accountingTemplateConfig.ts — CONTROLLED, safe template customization for
 * accounting documents. NOT a free-form designer: every option is bounded
 * (enum presets, a safe font list, clamped sizes, boolean toggles, short
 * text fields). One config per document type; the PDF renderer honors the
 * resolved options. Versioning reuses the company-profile pattern; existing
 * issued documents are unaffected (they render from their own snapshots).
 */
export type TemplateDocType = "invoice" | "receipt" | "statement" | "voucher" | "cost_statement";
export const TEMPLATE_DOC_TYPES: readonly TemplateDocType[] = ["invoice", "receipt", "statement", "voucher", "cost_statement"];

/** jsPDF built-in fonts only — guaranteed stable for printing. */
export type SafeFont = "helvetica" | "times" | "courier";
export const SAFE_FONTS: readonly SafeFont[] = ["helvetica", "times", "courier"];

export type PresetId = "standard" | "compact" | "modern";
export const PRESETS: readonly PresetId[] = ["standard", "compact", "modern"];
export type LogoPosition = "left" | "center" | "right";
export const LOGO_POSITIONS: readonly LogoPosition[] = ["left", "center", "right"];
export type LogoSize = "small" | "medium" | "large";
export const LOGO_SIZES: readonly LogoSize[] = ["small", "medium", "large"];
export type DocLanguage = "en" | "ar" | "tr";

/** Preset → accent color (RGB) + default sizes. Bounded, print-safe. */
export const PRESET_ACCENT: Record<PresetId, [number, number, number]> = {
  standard: [234, 88, 12],   // MARAS orange
  compact: [15, 23, 42],     // slate
  modern: [37, 99, 235],     // blue
};

export interface TemplateConfig {
  docType: TemplateDocType;
  presetId: PresetId;
  fontFamily: SafeFont;
  headingSize: number;      // clamped 12..20
  bodySize: number;         // clamped 7..12
  logoPosition: LogoPosition;
  logoSize: LogoSize;
  showBank: boolean;
  showSignature: boolean;
  showStamp: boolean;
  showPageNumbers: boolean;
  showNotes: boolean;
  headerText?: string;
  footerText?: string;
  standardNotes?: string;
  paymentTerms?: string;
  defaultLanguage: DocLanguage;
  version?: number;
  updatedAt?: string;
  updatedBy?: string;
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : dflt);
const bool = (v: unknown, dflt: boolean): boolean => (typeof v === "boolean" ? v : dflt);
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** The safe defaults per document type (customer docs show bank; internal don't). */
export function defaultTemplateConfig(docType: TemplateDocType): TemplateConfig {
  const customerFacing = docType === "invoice" || docType === "receipt" || docType === "statement";
  return {
    docType,
    presetId: "standard",
    fontFamily: "helvetica",
    headingSize: 15,
    bodySize: 9,
    logoPosition: "left",
    logoSize: "medium",
    showBank: docType === "invoice",
    showSignature: docType === "invoice" || docType === "voucher" || docType === "cost_statement",
    showStamp: docType === "invoice" || docType === "cost_statement",
    showPageNumbers: true,
    showNotes: true,
    defaultLanguage: "en",
    ...(customerFacing ? {} : {}),
  };
}

/** Validate + normalize a submitted config against the bounded option sets. */
export function validateTemplateConfig(docType: TemplateDocType, input: unknown): TemplateConfig {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = defaultTemplateConfig(docType);
  return {
    docType,
    presetId: oneOf(b.presetId, PRESETS, d.presetId),
    fontFamily: oneOf(b.fontFamily, SAFE_FONTS, d.fontFamily),
    headingSize: clamp(b.headingSize, 12, 20, d.headingSize),
    bodySize: clamp(b.bodySize, 7, 12, d.bodySize),
    logoPosition: oneOf(b.logoPosition, LOGO_POSITIONS, d.logoPosition),
    logoSize: oneOf(b.logoSize, LOGO_SIZES, d.logoSize),
    showBank: bool(b.showBank, d.showBank),
    showSignature: bool(b.showSignature, d.showSignature),
    showStamp: bool(b.showStamp, d.showStamp),
    showPageNumbers: bool(b.showPageNumbers, d.showPageNumbers),
    showNotes: bool(b.showNotes, d.showNotes),
    headerText: str(b.headerText, 200),
    footerText: str(b.footerText, 300),
    standardNotes: str(b.standardNotes, 600),
    paymentTerms: str(b.paymentTerms, 300),
    defaultLanguage: oneOf(b.defaultLanguage, ["en", "ar", "tr"] as const, d.defaultLanguage),
  };
}

/** Resolved render options the PDF renderer consumes (bounded → pixels/mm). */
export interface TemplateRenderOptions {
  fontFamily: SafeFont;
  headingSize: number;
  bodySize: number;
  accent: [number, number, number];
  logoPosition: LogoPosition;
  logoSizeMm: number;
}
export function resolveTemplateRender(config: TemplateConfig): TemplateRenderOptions {
  return {
    fontFamily: config.fontFamily,
    headingSize: config.headingSize,
    bodySize: config.bodySize,
    accent: PRESET_ACCENT[config.presetId],
    logoPosition: config.logoPosition,
    logoSizeMm: config.logoSize === "small" ? 14 : config.logoSize === "large" ? 26 : 20,
  };
}
