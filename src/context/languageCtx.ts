import { createContext, useContext } from 'react';
import { type LanguageCode, type TranslationKey, translateKey } from '../utils/i18n';

export interface LanguageContextValue {
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
  t: (key: TranslationKey, fallback?: string) => string;
}

export const LanguageCtx = createContext<LanguageContextValue>({
  lang: 'en',
  setLang: () => {},
  t: (key, fallback) => translateKey('en', key, fallback),
});

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageCtx);
}
