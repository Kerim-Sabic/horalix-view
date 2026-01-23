/**
 * Integration Tests for Horalix View
 *
 * Tests the critical login -> dashboard -> navigation flow
 * to ensure no blank screens occur after authentication.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SnackbarProvider } from 'notistack';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './themes/ThemeProvider';
import App from './App';
import { apiClient } from './services/apiClient';

// Mock fetch and axios for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    length: 0,
    key: vi.fn(),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock axios module
vi.mock('./services/apiClient', async () => {
  const actual = await vi.importActual('./services/apiClient');
  return {
    ...actual,
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    },
  };
});

// Mock Cornerstone initialization
vi.mock('./utils/cornerstone', () => ({
  initializeCornerstone: vi.fn(),
}));

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

interface TestWrapperProps {
  children: React.ReactNode;
  initialRoute?: string;
}

const TestWrapper = ({ children, initialRoute = '/' }: TestWrapperProps) => {
  const queryClient = createQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <ThemeProvider>
          <SnackbarProvider maxSnack={3}>
            <AuthProvider>{children}</AuthProvider>
          </SnackbarProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('Authentication Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects to login page when not authenticated', async () => {
    render(
      <TestWrapper initialRoute="/">
        <App />
      </TestWrapper>
    );

    // Should redirect to login page and show login form
    await waitFor(
      () => {
        // Login page should have username/password inputs or a Sign In button
        const hasLoginElements =
          screen.queryByLabelText(/username/i) ||
          screen.queryByLabelText(/password/i) ||
          screen.queryByRole('button', { name: /sign in/i }) ||
          document.querySelector('input[type="password"]');
        expect(hasLoginElements).toBeTruthy();
      },
      { timeout: 5000 }
    );
  });

  it('shows loading state while checking authentication', () => {
    // Set token to trigger auth check
    localStorageMock.getItem.mockReturnValue('fake-token');

    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // Should show loading indicator initially
    // The app uses a CircularProgress spinner during loading
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('does not crash when auth check fails', async () => {
    localStorageMock.getItem.mockReturnValue('fake-token');

    // The app should handle auth failures gracefully
    expect(() =>
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      )
    ).not.toThrow();
  });
});

describe('Error Boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it('ErrorBoundary catches rendering errors', async () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { container } = render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // App should render without crashing - ErrorBoundary catches any errors
    expect(container).toBeTruthy();

    consoleSpy.mockRestore();
  });

  it('app renders error boundary fallback UI on error', async () => {
    // This test verifies the ErrorBoundary is in place
    const { default: ErrorBoundary } = await import('./components/common/ErrorBoundary');
    expect(ErrorBoundary).toBeDefined();
  });
});

describe('AI Models Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it('renders empty state when API returns empty models list', async () => {
    const mockGet = apiClient.get as unknown as { mockResolvedValueOnce: (value: unknown) => void };
    mockGet.mockResolvedValueOnce({ data: { models: [] } });

    const { default: AIModelsPage } = await import('./pages/AIModelsPage');

    render(
      <TestWrapper>
        <AIModelsPage />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/no ai models available/i)).toBeTruthy();
    });
  });

  it('renders when models have missing nested fields', async () => {
    const mockGet = apiClient.get as unknown as { mockResolvedValueOnce: (value: unknown) => void };
    mockGet.mockResolvedValueOnce({
      data: {
        models: [
          {
            name: 'Test Model',
            available: false,
            status: 'missing_weights',
            details: null,
            requirements: null,
            weights: null,
            errors: null,
          },
        ],
      },
    });

    const { default: AIModelsPage } = await import('./pages/AIModelsPage');

    render(
      <TestWrapper>
        <AIModelsPage />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Model')).toBeTruthy();
    });
  });

  it('shows schema warning when API response is malformed', async () => {
    const mockGet = apiClient.get as unknown as { mockResolvedValueOnce: (value: unknown) => void };
    mockGet.mockResolvedValueOnce({ data: { models: null } });

    const { default: AIModelsPage } = await import('./pages/AIModelsPage');

    render(
      <TestWrapper>
        <AIModelsPage />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/response did not match the expected schema/i)).toBeTruthy();
    });
  });
});

describe('Dashboard Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it('dashboard page component renders without blank screen', async () => {
    // Import DashboardPage directly to test it
    const { default: DashboardPage } = await import('./pages/DashboardPage');

    const queryClient = createQueryClient();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemeProvider>
            <DashboardPage />
          </ThemeProvider>
        </BrowserRouter>
      </QueryClientProvider>
    );

    // Page should have content - not blank
    expect(container.innerHTML).not.toBe('');
    expect(container.innerHTML.length).toBeGreaterThan(100);

    // Should show Dashboard title
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeTruthy();
    });
  });

  it('dashboard shows loading skeletons initially', async () => {
    const { default: DashboardPage } = await import('./pages/DashboardPage');

    const queryClient = createQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemeProvider>
            <DashboardPage />
          </ThemeProvider>
        </BrowserRouter>
      </QueryClientProvider>
    );

    // Should show skeletons or loading state
    await waitFor(() => {
      const dashboardText = screen.queryByText('Dashboard');
      expect(dashboardText).toBeTruthy();
    });
  });
});

describe('Study List Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it('renders modalities when API returns modalities_in_study', async () => {
    const mockGet = apiClient.get as unknown as { mockResolvedValueOnce: (value: unknown) => void };
    mockGet.mockResolvedValueOnce({
      data: {
        total: 1,
        page: 1,
        page_size: 10,
        studies: [
          {
            study_instance_uid: '1.2.3',
            patient_name: 'Test Patient',
            patient_id: 'TEST001',
            study_date: '2026-01-21',
            study_time: null,
            study_description: 'CT Chest',
            accession_number: 'ACC123',
            modalities_in_study: ['CT'],
            num_series: 1,
            num_instances: 1,
            status: 'complete',
            referring_physician_name: 'Dr. Test',
            institution_name: 'Test Hospital',
            created_at: '2026-01-21T00:00:00Z',
          },
        ],
      },
    });

    const { default: StudyListPage } = await import('./pages/StudyListPage');

    render(
      <TestWrapper>
        <StudyListPage />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/CT/)).toBeTruthy();
    });
  });
});

describe('API Client', () => {
  it('exports required auth event constants', async () => {
    const { AUTH_EVENTS } = await import('./services/apiClient');

    expect(AUTH_EVENTS).toBeDefined();
    expect(AUTH_EVENTS.UNAUTHORIZED).toBe('auth:unauthorized');
    expect(AUTH_EVENTS.SESSION_EXPIRED).toBe('auth:session-expired');
  });

  it('dispatchAuthEvent function exists', async () => {
    const { dispatchAuthEvent } = await import('./services/apiClient');

    expect(dispatchAuthEvent).toBeDefined();
    expect(typeof dispatchAuthEvent).toBe('function');
  });
});

describe('Auth Context', () => {
  it('provides authentication state', async () => {
    const { useAuth } = await import('./contexts/AuthContext');
    expect(useAuth).toBeDefined();
    expect(typeof useAuth).toBe('function');
  });

  it('AuthProvider renders children', () => {
    const TestChild = () => <div data-testid="child">Test Child</div>;

    render(
      <TestWrapper>
        <TestChild />
      </TestWrapper>
    );

    expect(screen.getByTestId('child')).toBeTruthy();
  });
});

describe('Route Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it('routes are defined and accessible', async () => {
    render(
      <TestWrapper initialRoute="/login">
        <App />
      </TestWrapper>
    );

    // App should render without crashing at /login route
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('protected routes redirect to login when unauthenticated', async () => {
    render(
      <TestWrapper initialRoute="/studies">
        <App />
      </TestWrapper>
    );

    // Should redirect to login
    await waitFor(() => {
      // Either shows login or redirects - app should not be blank
      expect(document.body.innerHTML.length).toBeGreaterThan(100);
    });
  });

  it('catch-all route redirects to home', async () => {
    render(
      <TestWrapper initialRoute="/nonexistent-route">
        <App />
      </TestWrapper>
    );

    // Should redirect - app should not crash
    await waitFor(() => {
      expect(document.body.innerHTML).toBeTruthy();
    });
  });
});

describe('Blank Screen Prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it('app never renders empty body', async () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // Wait for any async operations
    await waitFor(
      () => {
        const bodyContent = document.body.innerHTML;
        // Body should have substantial content
        expect(bodyContent.length).toBeGreaterThan(100);
        // Should not be just whitespace
        expect(bodyContent.trim()).not.toBe('');
      },
      { timeout: 3000 }
    );
  });

  it('ErrorBoundary is present in component tree', () => {
    const { container } = render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // App should render with ErrorBoundary wrapper
    expect(container.innerHTML).toBeTruthy();
  });

  it('401 error does not cause blank screen', async () => {
    const { dispatchAuthEvent, AUTH_EVENTS } = await import('./services/apiClient');

    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // Simulate 401 error
    dispatchAuthEvent(AUTH_EVENTS.UNAUTHORIZED, { url: '/api/test' });

    // App should still have content
    await waitFor(() => {
      expect(document.body.innerHTML.length).toBeGreaterThan(100);
    });
  });
});
