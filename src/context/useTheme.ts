import { useContext } from 'react';
import { ThemeCtx } from './ctx';

export const useTheme = () => useContext(ThemeCtx);
