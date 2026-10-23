import { useCallback, useEffect, useState } from 'react';
import { applyTheme, initialTheme, saveTheme, type Theme } from '../utils/theme';

/** The moon button's state. First visit follows the system; a toggle is saved. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => applyTheme(theme), [theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    saveTheme(next);
  }, [theme]);

  return [theme, toggle];
}
