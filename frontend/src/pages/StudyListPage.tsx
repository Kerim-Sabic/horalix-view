/**
 * Study List Page
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Box,
  Card,
  Typography,
  TextField,
  InputAdornment,
  IconButton,
  Button,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Menu,
  MenuItem,
  ListItemIcon,
  Tooltip,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  Skeleton,
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  Visibility as ViewIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
  MoreVert as MoreIcon,
  Upload as UploadIcon,
  CloudUpload as CloudUploadIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { api, Study, UploadProgress } from '../services/api';

const StudyListPage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Data state
  const [studies, setStudies] = useState<Study[]>([]);
  const [totalStudies, setTotalStudies] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shapeError, setShapeError] = useState<string | null>(null);

  // Pagination state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Menu state
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedStudy, setSelectedStudy] = useState<Study | null>(null);

  // Upload state
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch studies
  const fetchStudies = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setShapeError(null);

      const response = await api.studies.list({
        patient_name: debouncedSearch || undefined,
        page: page + 1, // API uses 1-indexed pages
        page_size: rowsPerPage,
      });

      const safeStudies = Array.isArray(response.studies) ? response.studies : [];
      setStudies(safeStudies);
      setTotalStudies(typeof response.total === 'number' ? response.total : 0);
      if (!Array.isArray(response.studies)) {
        setShapeError('Studies response did not match the expected schema.');
      }
    } catch (err) {
      console.error('Failed to fetch studies:', err);
      setError('Failed to load studies. Please try again.');
      setShapeError(null);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, rowsPerPage]);

  useEffect(() => {
    fetchStudies();
  }, [fetchStudies]);

  const handleViewStudy = (study: Study) => {
    navigate(`/viewer/${study.study_instance_uid}`);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, study: Study) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setSelectedStudy(study);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedStudy(null);
  };

  const handleUploadClick = () => {
    setUploadDialogOpen(true);
    setUploadError(null);
    setUploadProgress([]);
    setSelectedFiles([]);
  };

  const getUploadErrorMessage = (err: unknown): string => {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 413) {
        return 'Upload exceeds the server size limit. Please split the study or contact IT.';
      }
      if (status === 400) {
        const detail = (err.response?.data as { detail?: string })?.detail;
        return detail || 'Invalid DICOM file detected.';
      }
      if (status === 424) {
        return 'Required dependencies are missing for this upload.';
      }
      if (err.code === 'ECONNABORTED') {
        return 'Upload timed out. Please retry on a stable connection.';
      }
      if (err.message === 'Network Error') {
        return 'Network interruption detected. Please retry.';
      }
    }
    return 'Failed to upload files. Please try again.';
  };

  const handleUpload = async (fileArray: File[]) => {
    if (fileArray.length === 0) return;

    try {
      setUploading(true);
      setUploadError(null);

      setUploadProgress(
        fileArray.map((f) => ({
          file_name: f.name,
          progress: 0,
          status: 'uploading' as const,
        }))
      );

      await api.studies.upload(fileArray, setUploadProgress);

      // Update progress to complete
      setUploadProgress((prev) =>
        prev.map((p) => ({ ...p, progress: 100, status: 'complete' as const }))
      );

      // Refresh studies list
      await fetchStudies();

      // Close dialog after short delay
      setTimeout(() => {
        setUploadDialogOpen(false);
        setUploadProgress([]);
        setSelectedFiles([]);
      }, 1500);
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadError(getUploadErrorMessage(err));
      setUploadProgress((prev) =>
        prev.map((p) => ({ ...p, status: 'error' as const }))
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRetryUpload = async () => {
    await handleUpload(selectedFiles);
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    setSelectedFiles(fileArray);
    await handleUpload(fileArray);
  };

  const handleDeleteStudy = async () => {
    if (!selectedStudy) return;

    try {
      setDeleting(true);
      await api.studies.delete(selectedStudy.study_instance_uid);
      await fetchStudies();
      setDeleteDialogOpen(false);
      handleMenuClose();
    } catch (err) {
      console.error('Failed to delete study:', err);
      setError('Failed to delete study. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportStudy = async () => {
    if (!selectedStudy) return;

    try {
      const blob = await api.studies.export(selectedStudy.study_instance_uid, 'dicom');
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedStudy.study_instance_uid}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      handleMenuClose();
    } catch (err) {
      console.error('Failed to export study:', err);
      setError('Failed to export study. Please try again.');
    }
  };

  const getStatusColor = (status: Study['status']): 'success' | 'warning' | 'error' | 'default' => {
    switch (status) {
      case 'complete':
        return 'success';
      case 'processing':
        return 'warning';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Studies
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={fetchStudies} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button variant="contained" startIcon={<UploadIcon />} onClick={handleUploadClick}>
            Upload DICOM
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {shapeError && (
        <Alert severity="warning" sx={{ mb: 3 }} onClose={() => setShapeError(null)}>
          {shapeError}
        </Alert>
      )}

      {/* Search and Filters */}
      <Card sx={{ mb: 3 }}>
        <Box sx={{ p: 2, display: 'flex', gap: 2 }}>
          <TextField
            placeholder="Search by patient name, ID, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            size="small"
            sx={{ flex: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
          <Button variant="outlined" startIcon={<FilterIcon />}>
            Filters
          </Button>
        </Box>
      </Card>

      {/* Studies Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Patient</TableCell>
                <TableCell>Study Description</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Modality</TableCell>
                <TableCell align="center">Series</TableCell>
                <TableCell align="center">Images</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                // Loading skeleton
                Array.from({ length: rowsPerPage }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Skeleton variant="text" width={120} />
                      <Skeleton variant="text" width={80} />
                    </TableCell>
                    <TableCell><Skeleton variant="text" width={200} /></TableCell>
                    <TableCell><Skeleton variant="text" width={80} /></TableCell>
                    <TableCell><Skeleton variant="text" width={40} /></TableCell>
                    <TableCell align="center"><Skeleton variant="text" width={30} /></TableCell>
                    <TableCell align="center"><Skeleton variant="text" width={30} /></TableCell>
                    <TableCell><Skeleton variant="text" width={60} /></TableCell>
                    <TableCell align="right"><Skeleton variant="circular" width={32} height={32} /></TableCell>
                  </TableRow>
                ))
              ) : studies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ textAlign: 'center', py: 4 }}>
                    <Typography color="text.secondary">
                      {debouncedSearch
                        ? 'No studies found matching your search.'
                        : 'No studies found. Upload DICOM files to get started.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                studies.map((study) => (
                  <TableRow
                    key={study.study_instance_uid}
                    hover
                    onClick={() => handleViewStudy(study)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {study.patient_name || 'Unknown'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {study.patient_id || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>{study.study_description || '-'}</TableCell>
                    <TableCell>{study.study_date || '-'}</TableCell>
                    <TableCell>
                      {(Array.isArray(study.modalities) ? study.modalities : []).map((mod) => (
                        <Chip key={mod} label={mod} size="small" sx={{ mr: 0.5 }} />
                      ))}
                    </TableCell>
                    <TableCell align="center">{study.num_series}</TableCell>
                    <TableCell align="center">{study.num_instances}</TableCell>
                    <TableCell>
                      <Chip
                        label={study.status}
                        size="small"
                        color={getStatusColor(study.status)}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="View">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewStudy(study);
                          }}
                        >
                          <ViewIcon />
                        </IconButton>
                      </Tooltip>
                      <IconButton
                        size="small"
                        onClick={(e) => handleMenuOpen(e, study)}
                      >
                        <MoreIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={totalStudies}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
        />
      </Card>

      {/* Context Menu */}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
        <MenuItem
          onClick={() => {
            if (selectedStudy) handleViewStudy(selectedStudy);
            handleMenuClose();
          }}
        >
          <ListItemIcon>
            <ViewIcon fontSize="small" />
          </ListItemIcon>
          View Study
        </MenuItem>
        <MenuItem onClick={handleExportStudy}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          Export
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDeleteDialogOpen(true);
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onClose={() => !uploading && setUploadDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Upload DICOM Files</DialogTitle>
        <DialogContent>
          {uploadError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {uploadError}
            </Alert>
          )}

          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept=".dcm,.DCM,.dicom,.DICOM,application/dicom"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          {uploadProgress.length === 0 ? (
            <Box
              sx={{
                border: '2px dashed',
                borderColor: 'divider',
                borderRadius: 2,
                p: 4,
                textAlign: 'center',
                cursor: 'pointer',
                '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
              <Typography variant="body1" gutterBottom>
                Click to select DICOM files
              </Typography>
              <Typography variant="body2" color="text.secondary">
                or drag and drop files here
              </Typography>
            </Box>
          ) : (
            <Box sx={{ mt: 2 }}>
              {uploadProgress.map((file, index) => (
                <Box key={index} sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" noWrap sx={{ maxWidth: '70%' }}>
                      {file.file_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {file.progress}%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={file.progress}
                    color={file.status === 'error' ? 'error' : file.status === 'complete' ? 'success' : 'primary'}
                  />
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setUploadDialogOpen(false);
              setUploadProgress([]);
              setUploadError(null);
              setSelectedFiles([]);
            }}
            disabled={uploading}
          >
            Cancel
          </Button>
          {uploadError && selectedFiles.length > 0 && (
            <Button
              variant="outlined"
              onClick={handleRetryUpload}
              disabled={uploading}
            >
              Retry Upload
            </Button>
          )}
          <Button
            variant="contained"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            startIcon={uploading ? <CircularProgress size={16} /> : <UploadIcon />}
          >
            {uploading ? 'Uploading...' : 'Select Files'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => !deleting && setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Study</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this study? This action cannot be undone.
          </Typography>
          {selectedStudy && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="body2">
                <strong>Patient:</strong> {selectedStudy.patient_name || 'Unknown'}
              </Typography>
              <Typography variant="body2">
                <strong>Study:</strong> {selectedStudy.study_description || '-'}
              </Typography>
              <Typography variant="body2">
                <strong>Date:</strong> {selectedStudy.study_date || '-'}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteStudy}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} /> : <DeleteIcon />}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default StudyListPage;
