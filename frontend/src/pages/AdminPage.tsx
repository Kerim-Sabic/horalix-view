/**
 * Admin Page
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  LinearProgress,
  Alert,
  Stack,
  IconButton,
  Tooltip,
  Chip,
  Switch,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  ListItemText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api, AdminSystemStatus, AdminStorageInfo, AdminUser } from '../services/api';

const AdminPage: React.FC = () => {
  const [systemStatus, setSystemStatus] = useState<AdminSystemStatus | null>(null);
  const [storageInfo, setStorageInfo] = useState<AdminStorageInfo | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const fetchAdminData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [status, storage, usersResponse] = await Promise.all([
        api.admin.getSystemStatus(),
        api.admin.getStorageInfo(),
        api.admin.getUsers(),
      ]);
      setSystemStatus(status);
      setStorageInfo(storage);
      setUsers(usersResponse);
    } catch (err) {
      console.error('Failed to load admin data:', err);
      setError('Failed to load admin data. Ensure you have admin access.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  const formatBytes = useCallback((value: number) => {
    if (!Number.isFinite(value)) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }, []);

  const uptimeLabel = useMemo(() => {
    if (!systemStatus) return '-';
    const totalSeconds = Math.floor(systemStatus.uptime_seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }, [systemStatus]);

  const handleToggleUser = async (userId: string, isActive: boolean) => {
    try {
      setUpdatingUserId(userId);
      await api.admin.updateUserStatus(userId, isActive);
      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId ? { ...user, is_active: isActive } : user
        )
      );
    } catch (err) {
      console.error('Failed to update user status:', err);
      setError('Failed to update user status.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleRolesChange = async (userId: string, roles: string[]) => {
    try {
      setUpdatingUserId(userId);
      await api.admin.updateUserRoles(userId, roles);
      setUsers((prev) =>
        prev.map((user) => (user.id === userId ? { ...user, roles } : user))
      );
    } catch (err) {
      console.error('Failed to update roles:', err);
      setError('Failed to update user roles.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const roleOptions = ['admin', 'radiologist', 'technologist', 'referring_physician', 'researcher'];

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Administration
        </Typography>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={fetchAdminData} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                System Status
              </Typography>
              {systemStatus ? (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Status: {systemStatus.status} | Uptime: {uptimeLabel}
                  </Typography>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2">CPU Usage</Typography>
                    <LinearProgress
                      variant="determinate"
                      value={systemStatus.cpu_usage_percent}
                      sx={{ mt: 0.5 }}
                    />
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2">Memory Usage</Typography>
                    <LinearProgress
                      variant="determinate"
                      value={systemStatus.memory_usage_percent}
                      sx={{ mt: 0.5 }}
                    />
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2">Disk Usage</Typography>
                    <LinearProgress
                      variant="determinate"
                      value={systemStatus.disk_usage_percent}
                      sx={{ mt: 0.5 }}
                    />
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Chip label={`Active users: ${systemStatus.active_users}`} size="small" />
                    <Chip label={`Pending AI jobs: ${systemStatus.pending_jobs}`} size="small" />
                  </Stack>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {loading ? 'Loading system status...' : 'No system status available.'}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Storage Overview
              </Typography>
              {storageInfo ? (
                <Stack spacing={1}>
                  <Typography variant="body2">
                    Used: {formatBytes(storageInfo.used_bytes)} / {formatBytes(storageInfo.total_bytes)}
                  </Typography>
                  <Typography variant="body2">
                    Studies: {storageInfo.study_count} | Series: {storageInfo.series_count} | Instances: {storageInfo.instance_count}
                  </Typography>
                  <Typography variant="body2">
                    Free: {formatBytes(storageInfo.free_bytes)}
                  </Typography>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {loading ? 'Loading storage...' : 'No storage data available.'}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                User Management
              </Typography>
              {users.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {loading ? 'Loading users...' : 'No users found.'}
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>User</TableCell>
                      <TableCell>Roles</TableCell>
                      <TableCell align="center">Active</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id} hover>
                        <TableCell>
                          <Typography variant="body2">{user.username}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {user.email}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <FormControl size="small" sx={{ minWidth: 220 }}>
                            <InputLabel>Roles</InputLabel>
                            <Select
                              multiple
                              value={user.roles}
                              label="Roles"
                              renderValue={(selected) => (selected as string[]).join(', ')}
                              onChange={(event) =>
                                handleRolesChange(user.id, event.target.value as string[])
                              }
                              disabled={updatingUserId === user.id}
                            >
                              {roleOptions.map((role) => (
                                <MenuItem key={role} value={role}>
                                  <Checkbox checked={user.roles.includes(role)} />
                                  <ListItemText primary={role} />
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell align="center">
                          <Switch
                            checked={user.is_active}
                            onChange={(event) =>
                              handleToggleUser(user.id, event.target.checked)
                            }
                            disabled={updatingUserId === user.id}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default AdminPage;
