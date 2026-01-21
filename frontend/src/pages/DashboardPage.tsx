/**
 * Dashboard Page
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  ListItemButton,
  Chip,
  Skeleton,
  Alert,
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
  HourglassEmpty as QueuedIcon,
} from '@mui/icons-material';
import { api, Study, AIJob, DashboardStats } from '../services/api';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  loading?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, icon, color, loading }) => (
  <Card>
    <CardContent>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {title}
          </Typography>
          {loading ? (
            <Skeleton variant="text" width={80} height={40} />
          ) : (
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              {value}
            </Typography>
          )}
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
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentStudies, setRecentStudies] = useState<Study[]>([]);
  const [recentJobs, setRecentJobs] = useState<AIJob[]>([]);

  // Safe default stats to prevent undefined errors
  const defaultStats: DashboardStats = {
    total_studies: 0,
    total_patients: 0,
    total_series: 0,
    total_instances: 0,
    ai_jobs_today: 0,
    ai_jobs_running: 0,
    storage_used_bytes: 0,
    storage_total_bytes: 1, // Avoid division by zero
  };

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch all dashboard data in parallel
        const [statsResult, studiesResult, jobsResult] = await Promise.allSettled([
          api.dashboard.getStats(),
          api.dashboard.getRecentStudies(5),
          api.dashboard.getRecentJobs(5),
        ]);

        // Process stats - validate and set with fallback to defaults
        if (statsResult.status === 'fulfilled' && statsResult.value && typeof statsResult.value === 'object') {
          setStats(statsResult.value);
        } else {
          // Log the rejection reason if available
          if (statsResult.status === 'rejected') {
            console.warn('Failed to fetch dashboard stats:', statsResult.reason);
          }
          setStats(defaultStats);
        }

        // Process studies - ALWAYS ensure we set an array, never undefined
        if (studiesResult.status === 'fulfilled' && Array.isArray(studiesResult.value)) {
          setRecentStudies(studiesResult.value);
        } else {
          if (studiesResult.status === 'rejected') {
            console.warn('Failed to fetch recent studies:', studiesResult.reason);
          }
          setRecentStudies([]); // Always fallback to empty array
        }

        // Process jobs - ALWAYS ensure we set an array, never undefined
        if (jobsResult.status === 'fulfilled' && Array.isArray(jobsResult.value)) {
          setRecentJobs(jobsResult.value);
        } else {
          if (jobsResult.status === 'rejected') {
            console.warn('Failed to fetch recent jobs:', jobsResult.reason);
          }
          setRecentJobs([]); // Always fallback to empty array
        }
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
        setError('Failed to load dashboard data. Please try again.');
        // Ensure we have safe defaults even on error
        setStats(defaultStats);
        setRecentStudies([]);
        setRecentJobs([]);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'complete':
        return <SuccessIcon color="success" fontSize="small" />;
      case 'running':
      case 'processing':
        return <PendingIcon color="warning" fontSize="small" />;
      case 'failed':
      case 'error':
        return <ErrorIcon color="error" fontSize="small" />;
      case 'pending':
        return <QueuedIcon color="disabled" fontSize="small" />;
      default:
        return <PendingIcon color="disabled" fontSize="small" />;
    }
  };

  const getStatusColor = (status: string): 'success' | 'warning' | 'error' | 'default' => {
    switch (status) {
      case 'completed':
      case 'complete':
        return 'success';
      case 'running':
      case 'processing':
        return 'warning';
      case 'failed':
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Safe accessors - guaranteed to never be undefined even if state is corrupted
  const safeStudies = Array.isArray(recentStudies) ? recentStudies : [];
  const safeJobs = Array.isArray(recentJobs) ? recentJobs : [];
  const safeStats = stats ?? defaultStats;

  const storagePercentage = safeStats.storage_total_bytes > 0
    ? Math.round((safeStats.storage_used_bytes / safeStats.storage_total_bytes) * 100)
    : 0;

  return (
    <Box data-testid="dashboard-page">
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
        Dashboard
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Stats Grid */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Studies"
            value={loading ? '-' : safeStats.total_studies.toLocaleString()}
            icon={<StudiesIcon />}
            color="#007AFF"
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Patients"
            value={loading ? '-' : safeStats.total_patients.toLocaleString()}
            icon={<PatientsIcon />}
            color="#34C759"
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="AI Jobs Today"
            value={loading ? '-' : safeStats.ai_jobs_today}
            subtitle={loading ? undefined : `${safeStats.ai_jobs_running} running`}
            icon={<AIIcon />}
            color="#5856D6"
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Storage Used"
            value={loading ? '-' : `${storagePercentage}%`}
            subtitle={
              loading
                ? undefined
                : `${formatBytes(safeStats.storage_used_bytes)} / ${formatBytes(safeStats.storage_total_bytes)}`
            }
            icon={<StorageIcon />}
            color="#FF9500"
            loading={loading}
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
            {loading ? (
              <Skeleton variant="rectangular" height={8} sx={{ borderRadius: 4 }} />
            ) : (
              <LinearProgress
                variant="determinate"
                value={storagePercentage}
                sx={{ height: 8, borderRadius: 4 }}
                color={storagePercentage > 90 ? 'error' : storagePercentage > 70 ? 'warning' : 'primary'}
              />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {loading
              ? 'Loading...'
              : `${formatBytes(safeStats.storage_used_bytes)} used of ${formatBytes(safeStats.storage_total_bytes)} total storage`}
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
              {loading ? (
                <Box>
                  {[1, 2, 3].map((i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', py: 1 }}>
                      <Skeleton variant="circular" width={24} height={24} sx={{ mr: 2 }} />
                      <Box sx={{ flex: 1 }}>
                        <Skeleton variant="text" width="60%" />
                        <Skeleton variant="text" width="80%" />
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : safeStudies.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 2 }}>
                  No studies found. Upload DICOM files to get started.
                </Typography>
              ) : (
                <List disablePadding data-testid="recent-studies-list">
                  {safeStudies.map((study) => (
                    <ListItem key={study.study_instance_uid} disablePadding>
                      <ListItemButton onClick={() => navigate(`/viewer/${study.study_instance_uid}`)}>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          {getStatusIcon(study.status)}
                        </ListItemIcon>
                        <ListItemText
                          primary={study.patient_name || 'Unknown Patient'}
                          secondary={`${study.study_description || 'No description'} - ${study.study_date || 'No date'}`}
                        />
                        <Chip
                          label={study.status}
                          size="small"
                          color={getStatusColor(study.status)}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              )}
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
              {loading ? (
                <Box>
                  {[1, 2, 3].map((i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', py: 1 }}>
                      <Skeleton variant="circular" width={24} height={24} sx={{ mr: 2 }} />
                      <Box sx={{ flex: 1 }}>
                        <Skeleton variant="text" width="60%" />
                        <Skeleton variant="text" width="40%" />
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : safeJobs.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 2 }}>
                  No AI jobs found. Start an AI analysis from the viewer.
                </Typography>
              ) : (
                <List disablePadding data-testid="recent-jobs-list">
                  {safeJobs.map((job) => (
                    <ListItem key={job.job_id} sx={{ px: 0 }}>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        {getStatusIcon(job.status)}
                      </ListItemIcon>
                      <ListItemText
                        primary={`${job.model_type} - ${job.task_type}`}
                        secondary={new Date(job.created_at).toLocaleString()}
                      />
                      <Chip label={job.status} size="small" color={getStatusColor(job.status)} />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default DashboardPage;
