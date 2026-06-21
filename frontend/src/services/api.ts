import axios, { AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';

// Use relative URLs in production (when served by Nginx), absolute URLs in development
const API_URL = import.meta.env.VITE_API_URL === 'relative'
  ? '' // Empty string for relative URLs - Nginx will proxy /api to backend
  : import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Request cache (5 second TTL)
const requestCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds

// Generate cache key from request config
function getCacheKey(config: InternalAxiosRequestConfig): string {
  return `${config.method}:${config.url}:${JSON.stringify(config.params || {})}`;
}

// Check if request should be cached (only GET requests)
function shouldCache(config: InternalAxiosRequestConfig): boolean {
  return config.method?.toLowerCase() === 'get';
}

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
function handleSessionExpired(message = 'Your session has expired. Please log in again.'): void {
  if (sessionExpiredHandled) return;
  useAuthStore.getState().logout(false);
  if (!isPublicPage()) {
    sessionExpiredHandled = true;
    toast.error(message, { id: 'session-expired' });
    window.location.href = '/login';
  }
}

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// Request interceptor to add JWT token and handle caching
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    console.log('[API Interceptor] Request:', config.method?.toUpperCase(), config.url);
    const token = useAuthStore.getState().accessToken;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log(`[API Interceptor] Token attached to request (${token.substring(0, 10)}...)`);
    } else {
      console.warn('[API Interceptor] No token found in store or headers object missing. Token status:', !!token);
    }

    // Check cache for GET requests
    if (shouldCache(config)) {
      const cacheKey = getCacheKey(config);
      const cached = requestCache.get(cacheKey);

      // Return cached data if still fresh
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('[API Interceptor] Cache hit for:', config.url);
        // Return Promise that resolves immediately with cached data
        return Promise.reject({
          config,
          response: { data: cached.data, status: 200, statusText: 'OK (Cached)' },
          isAxiosError: false,
          toJSON: () => ({}),
          name: 'CacheHit',
          message: 'Cached response'
        });
      }
    }

    console.log('[API Interceptor] Proceeding with request:', config.method?.toUpperCase(), config.url);
    return config;
  },
  (error: AxiosError) => {
    console.error('[API Interceptor] Request error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor to handle caching, 401, and refresh token
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    console.log('[API Interceptor] Response:', response.config.method?.toUpperCase(), response.config.url, 'Status:', response.status);
    // Cache successful GET responses
    if (response.config.method?.toLowerCase() === 'get') {
      const cacheKey = getCacheKey(response.config);
      requestCache.set(cacheKey, {
        data: response.data,
        timestamp: Date.now()
      });
    }
    return response;
  },
  async (error: any) => {
    console.log('[API Interceptor] Response error:', error);
    console.log('[API Interceptor] Error details:', {
      message: error.message,
      code: error.code,
      name: error.name,
      response: error.response,
      request: error.request ? 'Request object exists' : 'No request object'
    });

    // Handle cache hits
    if (error.name === 'CacheHit') {
      return Promise.resolve(error.response);
    }

    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (error.response?.status === 401 && !originalRequest._retry) {
      // Skip auto-logout for auth endpoints that handle their own errors
      const isAuthEndpoint = originalRequest.url?.includes('/api/auth/login') ||
        originalRequest.url?.includes('/api/auth/register') ||
        originalRequest.url?.includes('/api/auth/logout') ||
        originalRequest.url?.includes('/api/auth/forgot-password') ||
        originalRequest.url?.includes('/api/auth/reset-password');

      if (isAuthEndpoint) {
        // Let login/register pages handle 401 errors with their own UI
        return Promise.reject(error);
      }

      // Check for outdated token format error
      const errorCode = error.response?.data?.code;
      if (errorCode === 'TOKEN_FORMAT_OUTDATED') {
        handleSessionExpired('Your session is outdated. Please log in again.');
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      try {
        const refreshToken = useAuthStore.getState().refreshToken;
        if (!refreshToken) {
          handleSessionExpired();
          return Promise.reject(error);
        }

        const response = await axios.post(`${API_URL}/api/auth/refresh`, {
          refreshToken,
        });

        const { accessToken } = response.data;
        useAuthStore.getState().setAccessToken(accessToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          console.log('[API Interceptor] Token attached to retry request. Header length:', originalRequest.headers.Authorization.length);
        }

        console.log('[API Interceptor] Refresh successful, retrying original request:', originalRequest.method?.toUpperCase(), originalRequest.url);
        return apiClient(originalRequest);
      } catch (refreshError: any) {
        console.error('[API Interceptor] Token refresh failed:', refreshError.response?.status, refreshError.message);
        const refreshStatus = refreshError.response?.status;
        const refreshCode = refreshError.response?.data?.code;

        // Refresh succeeded in reaching the server but rejected the token (401):
        // session is genuinely expired. Redirect to login.
        if (refreshStatus === 401) {
          const msg = refreshCode === 'TOKEN_FORMAT_OUTDATED'
            ? 'Your session is outdated. Please log in again.'
            : 'Your session has expired. Please log in again.';
          handleSessionExpired(msg);
          return Promise.reject(refreshError);
        }

        // Real server outage (5xx) or network failure — don't log the user out;
        // they can retry once the backend is back. Dedupe via fixed id.
        if (!refreshError.response || (refreshStatus >= 500 && refreshStatus <= 599)) {
          toast.error('Server connection lost. Retrying...', { id: 'server-connection-lost' });
          return Promise.reject(refreshError);
        }

        // Anything else (400, 403, ...): treat as session expiry to be safe.
        handleSessionExpired();
        return Promise.reject(refreshError);
      }
    }

    // Show error toast for non-401 errors
    if (error.response?.status !== 401) {
      const errorMessage =
        (error.response?.data as any)?.message ||
        // express-validator 400s carry the specific rule message here (e.g. a
        // bad Allowed Domains entry) — prefer it over the opaque axios message.
        (error.response?.data as any)?.details?.[0]?.msg ||
        error.message ||
        'An error occurred';
      toast.error(errorMessage);
    }

    return Promise.reject(error);
  }
);

export default apiClient;
