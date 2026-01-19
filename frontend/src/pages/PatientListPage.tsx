/**
 * Patient List Page
 */

import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

const PatientListPage: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
        Patients
      </Typography>
      <Card>
        <CardContent>
          <Typography color="text.secondary">
            Patient list view - similar structure to StudyListPage
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default PatientListPage;
