/**
 * Simple i18n engine for e-tir Gateway
 * Supports English, Arabic, Turkish with nested key access
 */
import en from '@/locales/en';
import ar from '@/locales/ar';
import tr from '@/locales/tr';

export type Language = 'en' | 'ar' | 'tr';

export const LANGUAGES: { code: Language; label: string; nativeLabel: string; rtl: boolean }[] = [
  { code: 'en', label: 'English', nativeLabel: 'English', rtl: false },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true },
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe', rtl: false },
];

const translations: Record<Language, typeof en> = { en, ar: ar as typeof en, tr: tr as typeof en };

type PathsOf<T, Prefix extends string = ''> = {
  [K in keyof T]: T[K] extends Record<string, unknown>
    ? PathsOf<T[K], `${Prefix}${K & string}.`>
    : `${Prefix}${K & string}`;
}[keyof T];

export type TranslationPath = PathsOf<typeof en>;

/**
 * Get a translation value by dot-notation key
 * e.g. t('nav.dashboard', 'en') → 'Dashboard'
 */
export function t(key: TranslationPath, lang: Language = 'en'): string {
  const parts = key.split('.');
  let current: unknown = translations[lang] ?? translations.en;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as object)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      // Fallback to English
      let fallback: unknown = translations.en;
      for (const p of parts) {
        if (fallback && typeof fallback === 'object' && p in (fallback as object)) {
          fallback = (fallback as Record<string, unknown>)[p];
        } else return key;
      }
      return typeof fallback === 'string' ? fallback : key;
    }
  }
  return typeof current === 'string' ? current : key;
}
