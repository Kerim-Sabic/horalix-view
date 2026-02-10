/**
 * Login Page
 */

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  InputAdornment,
  IconButton,
  CircularProgress,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useAuth } from '@/contexts/AuthContext';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, error, clearError, isLoading } = useAuth();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  interface LocationState {
    from?: { pathname: string };
  }
  const from = (location.state as LocationState)?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      await login({ username, password });
      navigate(from, { replace: true });
    } catch (err) {
      // Error is handled by AuthContext
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isDark
          ? 'radial-gradient(circle at 20% 20%, rgba(79,156,255,0.18), transparent 45%), radial-gradient(circle at 80% 10%, rgba(49,195,178,0.14), transparent 40%), #0b0f14'
          : 'radial-gradient(circle at 20% 20%, rgba(31,111,235,0.12), transparent 45%), radial-gradient(circle at 80% 10%, rgba(15,118,110,0.12), transparent 40%), #f5f7fb',
        p: 3,
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 960,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' },
          gap: 3,
          alignItems: 'stretch',
        }}
      >
        <Box
          sx={{
            display: { xs: 'none', md: 'flex' },
            flexDirection: 'column',
            justifyContent: 'center',
            p: 4,
            borderRadius: 3,
            border: `1px solid ${alpha(theme.palette.primary.main, isDark ? 0.3 : 0.2)}`,
            background: isDark
              ? 'linear-gradient(135deg, rgba(79,156,255,0.16), rgba(15,23,42,0.8))'
              : 'linear-gradient(135deg, rgba(31,111,235,0.12), rgba(255,255,255,0.9))',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: 2.5,
                background: isDark
                  ? 'linear-gradient(135deg, #4f9cff 0%, #31c3b2 100%)'
                  : 'linear-gradient(135deg, #1f6feb 0%, #0f766e 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 700,
                fontSize: '1.5rem',
              }}
            >
              H
            </Box>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                Horalix View
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Clinical DICOM Workspace
              </Typography>
            </Box>
          </Box>
          <Typography variant="body1" sx={{ mb: 1.5 }}>
            Read, compare, and report with AI‑assisted measurements and clinical‑grade overlays.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Secure viewer optimized for cardiology teams and high‑volume workflows.
          </Typography>
        </Box>

        <Card sx={{ width: '100%' }}>
          <CardContent sx={{ p: 4 }}>
            <Box sx={{ textAlign: 'center', mb: 3 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                Sign in to your workspace
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Use your clinical credentials to continue.
              </Typography>
            </Box>

            {error && (
              <Alert severity="error" sx={{ mb: 3 }}>
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                margin="normal"
                required
                autoComplete="username"
                autoFocus
              />
              <TextField
                fullWidth
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                margin="normal"
                required
                autoComplete="current-password"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={isLoading || !username || !password}
                sx={{ mt: 3 }}
              >
                {isLoading ? <CircularProgress size={24} /> : 'Sign In'}
              </Button>
            </form>

            <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Demo credentials
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                admin / admin123
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};

export default LoginPage;
