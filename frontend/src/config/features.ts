/**
 * Feature flags (M3-T33). Default off. M7-T13 turns repApp on, M10-T08 turns agentApp on.
 * With a flag off, call reps / delivery agents stay on their current pages; with it on, they land on /rep or /agent.
 * Dev override: VITE_FEATURE_REP_APP=true, VITE_FEATURE_AGENT_APP=true. A tenant-level setting replaces this when the apps ship.
 */
export const features = {
  repApp: import.meta.env.VITE_FEATURE_REP_APP === 'true',
  agentApp: import.meta.env.VITE_FEATURE_AGENT_APP === 'true',
};

/** Where a role goes after login when the app for it is switched on; null = use the home route from /api/auth/me. */
export function roleAppRoute(role: string | undefined): string | null {
  if (role === 'sales_rep' && features.repApp) return '/rep';
  if (role === 'delivery_agent' && features.agentApp) return '/agent';
  return null;
}
