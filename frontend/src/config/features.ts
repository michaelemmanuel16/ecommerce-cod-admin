/**
 * Feature flags (M3-T33). Default off. M7-T13 turns repApp on, M10-T08 turns agentApp on.
 * With a flag off, call reps / delivery agents stay on their current pages; with it on, they land on /rep or /agent.
 * Dev override: VITE_FEATURE_REP_APP=true, VITE_FEATURE_AGENT_APP=true. A tenant-level setting replaces this when the apps ship.
 *
 * saasSignup (M3-T37, F-123): VITE_SAAS_SIGNUP_ENABLED=true shows /register, /pricing, the billing callback and the
 * login "Sign up" link. A build-time flag, so it must match the backend's SAAS_SIGNUP_ENABLED (which makes the API answer 404).
 */
export const features = {
  repApp: import.meta.env.VITE_FEATURE_REP_APP === 'true',
  agentApp: import.meta.env.VITE_FEATURE_AGENT_APP === 'true',
  saasSignup: import.meta.env.VITE_SAAS_SIGNUP_ENABLED === 'true',
};

/** Where a role goes after login when the app for it is switched on; null = use the home route from /api/auth/me. */
export function roleAppRoute(role: string | undefined): string | null {
  if (role === 'sales_rep' && features.repApp) return '/rep';
  if (role === 'delivery_agent' && features.agentApp) return '/agent';
  return null;
}
