/**
 * Authentication Service
 *
 * Handles authentication API calls.
 */

import { apiClient } from './apiClient';

export interface User {
  id: string;
  username: string;
  email: string;
  full_name: string | null;
  roles: string[];
  is_active: boolean;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface UserResponse {
  user_id: string;
  username: string;
  email: string;
  full_name: string | null;
  roles: string[];
  is_active: boolean;
  is_verified: boolean;
  last_login: string | null;
}

export const authService = {
  /**
   * Login with username and password.
   * Returns only the token response - call getCurrentUser() to get user info.
   */
  async login(credentials: LoginCredentials): Promise<TokenResponse> {
    const formData = new FormData();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);

    const response = await apiClient.post<TokenResponse>('/auth/token', formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data;
  },

  /**
   * Get current user information.
   * Requires a valid token in localStorage.
   */
  async getCurrentUser(): Promise<User> {
    const response = await apiClient.get<UserResponse>('/auth/me');
    // Map UserResponse to User interface
    return {
      id: response.data.user_id,
      username: response.data.username,
      email: response.data.email,
      full_name: response.data.full_name,
      roles: response.data.roles,
      is_active: response.data.is_active,
    };
  },

  /**
   * Logout current user.
   */
  async logout(): Promise<void> {
    await apiClient.post('/auth/logout');
  },

  /**
   * Change password.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiClient.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },
};
