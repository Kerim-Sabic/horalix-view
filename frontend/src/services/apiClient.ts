/**
 * API Client Configuration
 *
 * Axios instance configured for the Horalix View API.
 */

import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const BASE_URL = '/api/v1';

// Custom event for unauthorized access - allows React components to handle gracefully
export const AUTH_EVENTS = {
  UNAUTHORIZED: 'auth:unauthorized',
  SESSION_EXPIRED: 'auth:session-expired',
} as const;

/**
 * Dispatch an authentication event.
 * This allows the AuthContext to listen and handle auth state changes
 * without causing hard page reloads.
 */
export const dispatchAuthEvent = (eventType: string, detail?: Record<string, unknown>): void => {
  window.dispatchEvent(new CustomEvent(eventType, { detail }));
};

// Create axios instance
export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Track if we're already handling a 401 to prevent loops
let isHandling401 = false;

// Request interceptor - add auth token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors gracefully
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status;
    const requestUrl = error.config?.url || '';

    // Handle 401 Unauthorized
    if (status === 401 && !isHandling401) {
      isHandling401 = true;

      // Don't handle 401 on login/auth endpoints - let them propagate normally
      if (!requestUrl.includes('/auth/token') && !requestUrl.includes('/auth/login')) {
        // Clear token
        localStorage.removeItem('access_token');

        // Dispatch event for AuthContext to handle
        dispatchAuthEvent(AUTH_EVENTS.UNAUTHORIZED, {
          url: requestUrl,
          timestamp: new Date().toISOString(),
        });

        // Log for debugging
        console.warn('Session expired or unauthorized. Redirecting to login.');
      }

      // Reset flag after a short delay to allow handling
      setTimeout(() => {
        isHandling401 = false;
      }, 1000);
    }

    // Handle 403 Forbidden
    if (status === 403) {
      console.warn('Access forbidden:', requestUrl);
    }

    // Handle 404 Not Found - log but don't crash
    if (status === 404) {
      console.warn('Resource not found:', requestUrl);
    }

    // Handle 500+ Server Errors
    if (status && status >= 500) {
      console.error('Server error:', status, requestUrl);
    }

    // Handle network errors
    if (error.message === 'Network Error') {
      console.error('Network error - check your connection');
    }

    return Promise.reject(error);
  }
);

export default apiClient;
