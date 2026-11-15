import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LanguageCtx } from './languageCtx';
import {
  type LanguageCode,
  type TranslationKey,
  normalizeLanguage,
  translateKey,
} from '../utils/i18n';

const STORAGE_KEY = 'afrotech-lang';

export function LanguageProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lang, setLangState] = useState<LanguageCode>(() => {
    try {
      return normalizeLanguage(localStorage.getItem(STORAGE_KEY));
    } catch {
      return 'en';
    }
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore storage errors in restricted contexts
    }
  }, [lang]);

  const setLang = useCallback((next: LanguageCode) => {
    setLangState(normalizeLanguage(next));
  }, []);

  const t = useCallback(
    (key: TranslationKey, fallback?: string) => translateKey(lang, key, fallback),
    [lang],
  );

  return (
    <LanguageCtx.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageCtx.Provider>
  );
}
