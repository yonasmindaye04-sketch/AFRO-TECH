import { createContext } from 'react';

export interface ThemeCtx {
  dark: boolean;
  toggle: () => void;
}

export const ThemeCtx = createContext<ThemeCtx>({ dark: true, toggle: () => {} });
