import { createContext, useContext, useLayoutEffect } from 'react';

/** Set by the shell. null outside the shell (tests, public pages): the hook then does nothing. */
export const V2PageContext = createContext<((on: boolean) => void) | null>(null);

/**
 * A restyled v2 page calls this once. The shell wraps every other (not yet restyled) page in `.legacy-light`,
 * so in dark mode old pages keep the light theme and stay readable inside the dark shell.
 */
export function useV2Page(): void {
  const setV2 = useContext(V2PageContext);
  useLayoutEffect(() => {
    setV2?.(true);
    return () => setV2?.(false);
  }, [setV2]);
}
