/**
 * Admin Page
 */

import React from 'react';
import { Box, Typography, Card, CardContent, Grid, LinearProgress } from '@mui/material';

const AdminPage: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
        Administration
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                System Status
              </Typography>
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2">CPU Usage</Typography>
                <LinearProgress variant="determinate" value={25} sx={{ mt: 0.5 }} />
              </Box>
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2">Memory Usage</Typography>
                <LinearProgress variant="determinate" value={42} sx={{ mt: 0.5 }} />
              </Box>
              <Box>
                <Typography variant="body2">Disk Usage</Typography>
                <LinearProgress variant="determinate" value={35} sx={{ mt: 0.5 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                User Management
              </Typography>
              <Typography color="text.secondary">
                User management interface would be here.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default AdminPage;
