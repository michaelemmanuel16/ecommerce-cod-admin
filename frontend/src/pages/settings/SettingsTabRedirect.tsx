import { Navigate, useLocation } from 'react-router-dom';
import type { SettingsTab } from './tabs';

/**
 * Sends an old URL to its Settings tab and keeps the query (section, oauth, message) as it was (F-1215, F-1237).
 * An explicit ?tab= on the old URL wins. `/connections` goes to Integrations until Connections ships (M9).
 */
export function SettingsTabRedirect({ tab }: { tab: SettingsTab }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  if (!params.has('tab')) params.set('tab', tab);
  return <Navigate to={`/settings?${params.toString()}`} replace />;
}
