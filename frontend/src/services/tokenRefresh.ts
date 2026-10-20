import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';

// Use relative URLs in production (when served by Nginx), absolute URLs in development
export const API_URL = import.meta.env.VITE_API_URL === 'relative'
  ? '' // Empty string for relative URLs - Nginx will proxy /api to backend
  : import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Pages that should never trigger a 401 redirect to /login.
// Includes public checkout pages embedded in iframes on external sites —
// redirecting there would be blocked by X-Frame-Options.
function isPublicPage(): boolean {
  const path = window.location.pathname;
  return ['/login', '/register', '/forgot-password', '/reset-password'].includes(path)
    || path.startsWith('/form/');
}

// Once session expiry is detected, suppress further auth-error toasts until
// the redirect to /login completes. Prevents parallel dashboard requests from
// stacking duplicate toasts on the page being navigated away from.
//
// Only latched when we actually redirect: on public pages the redirect is
// skipped (X-Frame-Options-safe for embedded checkouts), so leaving the flag
// false there means a later SPA navigation into the admin can still surface
// the next expiry. The full-page reload triggered by the redirect resets the
// flag for the post-login session.
let sessionExpiredHandled = false;
export function handleSessionExpired(message = 'Your session has expired. Please log in again.'): void {
  if (sessionExpiredHandled) return;
  useAuthStore.getState().logout(false);
  if (!isPublicPage()) {
    sessionExpiredHandled = true;
    toast.error(message, { id: 'session-expired' });
    window.location.href = '/login';
  }
}

// One refresh call at a time, shared by the axios interceptor and the socket.
// Parallel 401s (a dashboard fires ~10 requests) all await the same promise,
// so the server sees one /refresh call instead of a burst that trips authLimiter.
let inFlight: Promise<string> | null = null;

/** Gets a new access token with the stored refresh token and saves it in the store. */
export function refreshAccessToken(): Promise<string> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const refreshToken = useAuthStore.getState().refreshToken;
    if (!refreshToken) {
      throw Object.assign(new Error('No refresh token'), { response: { status: 401 } });
    }
    // Plain axios, not apiClient: the interceptor must not see this call
    const response = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
    const { accessToken } = response.data;
    useAuthStore.getState().setAccessToken(accessToken);
    return accessToken as string;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
