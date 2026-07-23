import type { Language } from "../types";

/** Arabic is the only RTL language this app supports; everything else is LTR. */
export function resolveDocumentDirection(lang: Language): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

/**
 * Syncs the document root's `lang`/`dir` attributes with the active UI
 * language. Component-level `dir={isRtl ? "rtl" : "ltr"}` wrappers already
 * mirror layout, but the root element also needs this for accessibility
 * (screen readers) and browser-native behavior (form controls, native
 * context menus, find-in-page) that only look at `<html>`.
 */
export function applyDocumentLanguage(
  lang: Language,
  target: { lang: string; dir: string } = document.documentElement
): void {
  target.lang = lang;
  target.dir = resolveDocumentDirection(lang);
}
