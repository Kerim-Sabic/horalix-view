/**
 * Settings Page
 */

import React from 'react';
import { Box, Typography, Card, CardContent, Switch, FormControlLabel, Divider } from '@mui/material';
import { useTheme } from '@/themes/ThemeProvider';

const SettingsPage: React.FC = () => {
  const { mode, setMode, isDarkMode } = useTheme();

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
        Settings
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Appearance
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={isDarkMode}
                onChange={() => setMode(isDarkMode ? 'light' : 'dark')}
              />
            }
            label="Dark Mode"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Viewer Settings
          </Typography>
          <Typography color="text.secondary">
            Additional settings would be configured here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SettingsPage;
