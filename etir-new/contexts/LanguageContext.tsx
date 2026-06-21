import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { I18nManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Language, LANGUAGES, t as translate, TranslationPath } from '@/services/i18nService';

const STORAGE_KEY = 'etir_language';

interface LanguageContextType {
  language: Language;
  isRTL: boolean;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: TranslationPath) => string;
  languages: typeof LANGUAGES;
}

export const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved === 'en' || saved === 'ar' || saved === 'tr') {
        setLanguageState(saved);
        const lang = LANGUAGES.find(l => l.code === saved);
        if (lang && Platform.OS !== 'web') {
          I18nManager.forceRTL(lang.rtl);
        }
      }
    }).catch(() => {});
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    const langInfo = LANGUAGES.find(l => l.code === lang);
    setLanguageState(lang);
    await AsyncStorage.setItem(STORAGE_KEY, lang);
    // Apply RTL on native — requires app restart for full effect
    if (Platform.OS !== 'web' && langInfo) {
      I18nManager.forceRTL(langInfo.rtl);
    }
  }, []);

  const tFn = useCallback((key: TranslationPath) => translate(key, language), [language]);

  const isRTL = LANGUAGES.find(l => l.code === language)?.rtl ?? false;

  return (
    <LanguageContext.Provider value={{ language, isRTL, setLanguage, t: tFn, languages: LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
}
