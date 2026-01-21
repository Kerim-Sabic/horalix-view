/**
 * Authentication Context
 *
 * Provides authentication state and methods throughout the application.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { authService, User, LoginCredentials } from '@/services/authService';
import { AUTH_EVENTS } from '@/services/apiClient';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Handle unauthorized events from API client
  useEffect(() => {
    const handleUnauthorized = () => {
      // Clear user state
      setUser(null);
      localStorage.removeItem('access_token');

      // Only redirect if not already on login page
      if (location.pathname !== '/login') {
        navigate('/login', { replace: true });
      }
    };

    // Listen for auth events
    window.addEventListener(AUTH_EVENTS.UNAUTHORIZED, handleUnauthorized);
    window.addEventListener(AUTH_EVENTS.SESSION_EXPIRED, handleUnauthorized);

    return () => {
      window.removeEventListener(AUTH_EVENTS.UNAUTHORIZED, handleUnauthorized);
      window.removeEventListener(AUTH_EVENTS.SESSION_EXPIRED, handleUnauthorized);
    };
  }, [navigate, location.pathname]);

  // Check for existing session on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('access_token');
        if (token) {
          const userData = await authService.getCurrentUser();
          setUser(userData);
        }
      } catch (err) {
        // Token invalid or expired - clear state but don't show error
        // (user just needs to log in again)
        localStorage.removeItem('access_token');
        setUser(null);
        console.warn('Session check failed, user needs to re-authenticate');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Get access token from backend
      const tokenResponse = await authService.login(credentials);
      localStorage.setItem('access_token', tokenResponse.access_token);

      // Step 2: Fetch user info with the new token
      const userData = await authService.getCurrentUser();
      setUser(userData);
    } catch (err: unknown) {
      // Clean up token on any error
      localStorage.removeItem('access_token');
      const axiosError = err as { response?: { data?: { detail?: string } } };
      const message = axiosError.response?.data?.detail || 'Login failed';
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (err) {
      // Ignore logout errors
    } finally {
      localStorage.removeItem('access_token');
      setUser(null);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isLoading,
      error,
      login,
      logout,
      clearError,
    }),
    [user, isLoading, error, login, logout, clearError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
