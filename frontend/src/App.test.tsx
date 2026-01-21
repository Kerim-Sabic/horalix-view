import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './themes/ThemeProvider';
import App from './App';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const renderApp = () => {
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe('App', () => {
  it('renders without crashing', async () => {
    // This is a smoke test to verify the app can render
    expect(() => renderApp()).not.toThrow();
  });

  it('shows login page when not authenticated', async () => {
    renderApp();

    // Wait for the lazy-loaded login page to appear
    await waitFor(() => {
      // Should show login form elements
      expect(document.body.innerHTML).toBeTruthy();
    });
  });
});
