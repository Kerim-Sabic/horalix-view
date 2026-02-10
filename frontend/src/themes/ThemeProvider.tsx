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

// Clinical-focused palette (light + dark)
const lightPalette = {
  primary: {
    main: '#1f6feb',
    light: '#4c8dff',
    dark: '#0b4fd6',
    contrastText: '#FFFFFF',
  },
  secondary: {
    main: '#0f766e',
    light: '#2dd4bf',
    dark: '#115e59',
    contrastText: '#FFFFFF',
  },
  error: {
    main: '#dc2626',
    light: '#ef4444',
    dark: '#b91c1c',
  },
  warning: {
    main: '#d97706',
    light: '#f59e0b',
    dark: '#b45309',
  },
  success: {
    main: '#16a34a',
    light: '#22c55e',
    dark: '#15803d',
  },
  info: {
    main: '#0ea5e9',
    light: '#38bdf8',
    dark: '#0284c7',
  },
  background: {
    default: '#f5f7fb',
    paper: '#ffffff',
  },
  text: {
    primary: '#0b1220',
    secondary: '#5b667a',
    disabled: '#94a3b8',
  },
  divider: 'rgba(15, 23, 42, 0.12)',
};

const darkPalette = {
  primary: {
    main: '#4f9cff',
    light: '#74b7ff',
    dark: '#1f6feb',
    contrastText: '#0b1220',
  },
  secondary: {
    main: '#31c3b2',
    light: '#5eead4',
    dark: '#0f766e',
    contrastText: '#0b1220',
  },
  error: {
    main: '#ef4444',
    light: '#f87171',
    dark: '#dc2626',
  },
  warning: {
    main: '#f59e0b',
    light: '#fbbf24',
    dark: '#d97706',
  },
  success: {
    main: '#22c55e',
    light: '#4ade80',
    dark: '#16a34a',
  },
  info: {
    main: '#38bdf8',
    light: '#7dd3fc',
    dark: '#0ea5e9',
  },
  background: {
    default: '#0b0f14',
    paper: '#131a23',
  },
  text: {
    primary: '#e6edf5',
    secondary: '#94a3b8',
    disabled: '#64748b',
  },
  divider: 'rgba(148, 163, 184, 0.18)',
};

const createAppTheme = (isDark: boolean): Theme =>
  createTheme({
    palette: {
      mode: isDark ? 'dark' : 'light',
      ...(isDark ? darkPalette : lightPalette),
    },
    typography: {
      fontFamily: [
        '"Manrope"',
        '"IBM Plex Sans"',
        '"SF Pro Text"',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),
      fontWeightRegular: 500,
      fontWeightMedium: 600,
      fontWeightBold: 700,
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
      caption: {
        fontSize: '0.75rem',
        letterSpacing: '0.01em',
      },
      button: {
        textTransform: 'none',
        fontWeight: 600,
      },
    },
    shape: {
      borderRadius: 12,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: isDark ? darkPalette.background.default : lightPalette.background.default,
            backgroundImage: isDark
              ? 'radial-gradient(circle at 20% 20%, rgba(79,156,255,0.08), transparent 40%), radial-gradient(circle at 80% 10%, rgba(49,195,178,0.08), transparent 35%)'
              : 'radial-gradient(circle at 20% 20%, rgba(31,111,235,0.08), transparent 45%), radial-gradient(circle at 80% 10%, rgba(15,118,110,0.08), transparent 40%)',
            backgroundAttachment: 'fixed',
          },
          '::selection': {
            backgroundColor: isDark ? 'rgba(79,156,255,0.35)' : 'rgba(31,111,235,0.2)',
          },
          '*::-webkit-scrollbar': {
            width: '10px',
            height: '10px',
          },
          '*::-webkit-scrollbar-track': {
            background: isDark ? '#0b0f14' : '#eef2f7',
          },
          '*::-webkit-scrollbar-thumb': {
            background: isDark ? '#273040' : '#cbd5e1',
            borderRadius: '10px',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            padding: '8px 16px',
            fontWeight: 600,
            letterSpacing: '0.01em',
          },
          contained: {
            boxShadow: isDark
              ? '0 8px 20px rgba(15, 23, 42, 0.35)'
              : '0 8px 16px rgba(15, 23, 42, 0.12)',
            '&:hover': {
              boxShadow: isDark
                ? '0 10px 24px rgba(15, 23, 42, 0.45)'
                : '0 10px 20px rgba(15, 23, 42, 0.18)',
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            border: `1px solid ${isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.08)'}`,
            boxShadow: isDark
              ? '0 14px 30px rgba(6, 10, 18, 0.45)'
              : '0 16px 30px rgba(15, 23, 42, 0.08)',
          },
        },
      },
      MuiPaper: {
        defaultProps: {
          elevation: 0,
        },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: 10,
              backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)',
            },
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          input: {
            fontSize: '0.95rem',
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
            fontWeight: 600,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 8,
            fontSize: '0.7rem',
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            borderBottom: `1px solid ${isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.12)'}`,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundImage: 'none',
            borderRight: `1px solid ${isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.12)'}`,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            '&.Mui-selected': {
              backgroundColor: isDark ? 'rgba(79,156,255,0.18)' : 'rgba(31,111,235,0.12)',
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            fontWeight: 700,
            textTransform: 'uppercase',
            fontSize: '0.7rem',
            letterSpacing: '0.06em',
            color: isDark ? '#94a3b8' : '#64748b',
            borderColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.12)',
          },
          root: {
            borderColor: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.08)',
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            transition: 'background-color 0.15s ease',
            '&:hover': {
              backgroundColor: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(15,23,42,0.04)',
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 12,
            border: `1px solid ${isDark ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.08)'}`,
            backdropFilter: 'blur(8px)',
          },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: {
            borderColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.12)',
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
