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
      // Skip auto-logout for login/register endpoints - let them handle their own errors
      const isAuthEndpoint = originalRequest.url?.includes('/api/auth/login') ||
                             originalRequest.url?.includes('/api/auth/register');

      if (isAuthEndpoint) {
        // Let login/register pages handle 401 errors with their own UI
        return Promise.reject(error);
      }

      // Check for outdated token format error
      const errorCode = error.response?.data?.code;
      if (errorCode === 'TOKEN_FORMAT_OUTDATED') {
        useAuthStore.getState().logout(false);
        toast.error('Your session is outdated. Please log in again.');
        window.location.href = '/login';
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      try {
        const refreshToken = useAuthStore.getState().refreshToken;
        if (!refreshToken) {
          useAuthStore.getState().logout(false);
          window.location.href = '/login';
          return Promise.reject(error);
        }

        const response = await axios.post(`${API_URL}/api/auth/refresh`, {
          refreshToken,
        });

        const { accessToken } = response.data;
        useAuthStore.getState().setAccessToken(accessToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }

        return apiClient(originalRequest);
      } catch (refreshError: any) {
        // Check if refresh token is also outdated
        if (refreshError.response?.data?.code === 'TOKEN_FORMAT_OUTDATED') {
          useAuthStore.getState().logout(false);
          toast.error('Your session is outdated. Please log in again.');
          window.location.href = '/login';
          return Promise.reject(refreshError);
        }

        useAuthStore.getState().logout(false);
        toast.error('Session expired. Please login again.');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    // Show error toast for non-401 errors
    if (error.response?.status !== 401) {
      const errorMessage =
        (error.response?.data as any)?.message ||
        error.message ||
        'An error occurred';
      toast.error(errorMessage);
    }

    return Promise.reject(error);
  }
);

export default apiClient;
