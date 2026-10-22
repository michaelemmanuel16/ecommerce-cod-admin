import { useEffect, useState } from 'react';
import { locationsService } from '../services/locations.service';

/** Towns of the chosen state, for the admin forms. [] until a state is chosen or when the call fails. */
export function useTowns(state: string): { towns: string[]; loading: boolean } {
  const [result, setResult] = useState<{ state: string; towns: string[] }>({ state: '', towns: [] });

  useEffect(() => {
    if (!state) return;
    let live = true;
    locationsService
      .getTowns(state)
      .then((towns) => live && setResult({ state, towns }))
      .catch(() => live && setResult({ state, towns: [] }));
    return () => {
      live = false;
    };
  }, [state]);

  if (!state) return { towns: [], loading: false };
  return { towns: result.state === state ? result.towns : [], loading: result.state !== state };
}
