/**
 * Theme Provider
 *
 * Provides Material-UI theming with light/dark mode support
 * following Apple Human Interface Guidelines.
 */

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme, Theme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { useMediaQuery } from '@mui/material';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDarkMode: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Apple-inspired color palette
const lightPalette = {
  primary: {
    main: '#007AFF',
    light: '#5AC8FA',
    dark: '#0051D4',
    contrastText: '#FFFFFF',
  },
  secondary: {
    main: '#5856D6',
    light: '#787AFF',
    dark: '#3634A3',
    contrastText: '#FFFFFF',
  },
  error: {
    main: '#FF3B30',
    light: '#FF6961',
    dark: '#D70015',
  },
  warning: {
    main: '#FF9500',
    light: '#FFCC00',
    dark: '#C93400',
  },
  success: {
    main: '#34C759',
    light: '#4CD964',
    dark: '#248A3D',
  },
  info: {
    main: '#5AC8FA',
    light: '#70D7FF',
    dark: '#0071A4',
  },
  background: {
    default: '#F2F2F7',
    paper: '#FFFFFF',
  },
  text: {
    primary: '#000000',
    secondary: '#6E6E73',
    disabled: '#AEAEB2',
  },
  divider: 'rgba(60, 60, 67, 0.12)',
};

const darkPalette = {
  primary: {
    main: '#0A84FF',
    light: '#5AC8FA',
    dark: '#0051D4',
    contrastText: '#FFFFFF',
  },
  secondary: {
    main: '#5E5CE6',
    light: '#787AFF',
    dark: '#3634A3',
    contrastText: '#FFFFFF',
  },
  error: {
    main: '#FF453A',
    light: '#FF6961',
    dark: '#D70015',
  },
  warning: {
    main: '#FF9F0A',
    light: '#FFD60A',
    dark: '#C93400',
  },
  success: {
    main: '#32D74B',
    light: '#4CD964',
    dark: '#248A3D',
  },
  info: {
    main: '#64D2FF',
    light: '#70D7FF',
    dark: '#0071A4',
  },
  background: {
    default: '#000000',
    paper: '#1C1C1E',
  },
  text: {
    primary: '#FFFFFF',
    secondary: '#98989D',
    disabled: '#636366',
  },
  divider: 'rgba(84, 84, 88, 0.6)',
};

const createAppTheme = (isDark: boolean): Theme =>
  createTheme({
    palette: {
      mode: isDark ? 'dark' : 'light',
      ...(isDark ? darkPalette : lightPalette),
    },
    typography: {
      fontFamily: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"SF Pro Display"',
        '"SF Pro Text"',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),
      h1: {
        fontSize: '2.25rem',
        fontWeight: 700,
        letterSpacing: '-0.025em',
      },
      h2: {
        fontSize: '1.875rem',
        fontWeight: 600,
        letterSpacing: '-0.02em',
      },
      h3: {
        fontSize: '1.5rem',
        fontWeight: 600,
        letterSpacing: '-0.015em',
      },
      h4: {
        fontSize: '1.25rem',
        fontWeight: 600,
      },
      h5: {
        fontSize: '1.125rem',
        fontWeight: 600,
      },
      h6: {
        fontSize: '1rem',
        fontWeight: 600,
      },
      body1: {
        fontSize: '1rem',
        lineHeight: 1.5,
      },
      body2: {
        fontSize: '0.875rem',
        lineHeight: 1.5,
      },
      button: {
        textTransform: 'none',
        fontWeight: 600,
      },
    },
    shape: {
      borderRadius: 10,
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            padding: '10px 20px',
            fontWeight: 600,
          },
          contained: {
            boxShadow: 'none',
            '&:hover': {
              boxShadow: 'none',
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            boxShadow: isDark
              ? '0 2px 8px rgba(0, 0, 0, 0.3)'
              : '0 2px 8px rgba(0, 0, 0, 0.08)',
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: 10,
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 14,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 8,
            fontSize: '0.75rem',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          rounded: {
            borderRadius: 14,
          },
        },
      },
    },
  });

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('theme_mode');
    return (saved as ThemeMode) || 'system';
  });

  // Determine actual dark mode state
  const isDarkMode = useMemo(() => {
    if (mode === 'system') {
      return prefersDarkMode;
    }
    return mode === 'dark';
  }, [mode, prefersDarkMode]);

  // Save preference to localStorage
  useEffect(() => {
    localStorage.setItem('theme_mode', mode);
  }, [mode]);

  // Create theme
  const theme = useMemo(() => createAppTheme(isDarkMode), [isDarkMode]);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      isDarkMode,
    }),
    [mode, isDarkMode]
  );

  return (
    <ThemeContext.Provider value={value}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};
