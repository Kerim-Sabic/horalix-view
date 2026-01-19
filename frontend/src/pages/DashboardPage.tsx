/**
 * Dashboard Page
 */

import React from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
} from '@mui/material';
import {
  FolderOpen as StudiesIcon,
  People as PatientsIcon,
  Psychology as AIIcon,
  Storage as StorageIcon,
  Schedule as RecentIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Pending as PendingIcon,
} from '@mui/icons-material';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, icon, color }) => (
  <Card>
    <CardContent>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {title}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {value}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 2,
            bgcolor: `${color}20`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: color,
          }}
        >
          {icon}
        </Box>
      </Box>
    </CardContent>
  </Card>
);

const DashboardPage: React.FC = () => {
  // Mock data - in production, this would come from API
  const stats = {
    totalStudies: 1250,
    totalPatients: 892,
    aiJobsToday: 47,
    storageUsed: 35,
  };

  const recentStudies = [
    { id: '1', patient: 'John Doe', description: 'CT CHEST WITH CONTRAST', date: '2024-01-15', status: 'complete' },
    { id: '2', patient: 'Jane Smith', description: 'MRI BRAIN WITHOUT CONTRAST', date: '2024-01-16', status: 'complete' },
    { id: '3', patient: 'Robert Johnson', description: 'X-RAY CHEST PA/LAT', date: '2024-01-16', status: 'processing' },
  ];

  const aiJobs = [
    { id: '1', model: 'nnU-Net', study: 'CT CHEST', status: 'completed', time: '2 min ago' },
    { id: '2', model: 'YOLOv8', study: 'X-RAY CHEST', status: 'running', time: 'now' },
    { id: '3', model: 'MedSAM', study: 'MRI BRAIN', status: 'pending', time: 'queued' },
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'complete':
        return <SuccessIcon color="success" fontSize="small" />;
      case 'running':
      case 'processing':
        return <PendingIcon color="warning" fontSize="small" />;
      case 'failed':
        return <ErrorIcon color="error" fontSize="small" />;
      default:
        return <PendingIcon color="disabled" fontSize="small" />;
    }
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
        Dashboard
      </Typography>

      {/* Stats Grid */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Studies"
            value={stats.totalStudies.toLocaleString()}
            subtitle="+12 this week"
            icon={<StudiesIcon />}
            color="#007AFF"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Patients"
            value={stats.totalPatients.toLocaleString()}
            subtitle="+5 this week"
            icon={<PatientsIcon />}
            color="#34C759"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="AI Jobs Today"
            value={stats.aiJobsToday}
            subtitle="3 running"
            icon={<AIIcon />}
            color="#5856D6"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Storage Used"
            value={`${stats.storageUsed}%`}
            subtitle="350 GB / 1 TB"
            icon={<StorageIcon />}
            color="#FF9500"
          />
        </Grid>
      </Grid>

      {/* Storage Progress */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Storage Usage
          </Typography>
          <Box sx={{ mb: 1 }}>
            <LinearProgress
              variant="determinate"
              value={stats.storageUsed}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary">
            350 GB used of 1 TB total storage
          </Typography>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <RecentIcon sx={{ mr: 1 }} />
                <Typography variant="h6">Recent Studies</Typography>
              </Box>
              <List disablePadding>
                {recentStudies.map((study) => (
                  <ListItem key={study.id} sx={{ px: 0 }}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      {getStatusIcon(study.status)}
                    </ListItemIcon>
                    <ListItemText
                      primary={study.patient}
                      secondary={`${study.description} - ${study.date}`}
                    />
                    <Chip
                      label={study.status}
                      size="small"
                      color={study.status === 'complete' ? 'success' : 'warning'}
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <AIIcon sx={{ mr: 1 }} />
                <Typography variant="h6">AI Processing Queue</Typography>
              </Box>
              <List disablePadding>
                {aiJobs.map((job) => (
                  <ListItem key={job.id} sx={{ px: 0 }}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      {getStatusIcon(job.status)}
                    </ListItemIcon>
                    <ListItemText
                      primary={`${job.model} - ${job.study}`}
                      secondary={job.time}
                    />
                    <Chip
                      label={job.status}
                      size="small"
                      color={
                        job.status === 'completed'
                          ? 'success'
                          : job.status === 'running'
                          ? 'warning'
                          : 'default'
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default DashboardPage;
