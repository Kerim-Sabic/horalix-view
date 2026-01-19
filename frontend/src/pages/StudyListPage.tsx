/**
 * Study List Page
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  Visibility as ViewIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
  MoreVert as MoreIcon,
  Upload as UploadIcon,
} from '@mui/icons-material';

interface Study {
  id: string;
  studyInstanceUid: string;
  patientName: string;
  patientId: string;
  studyDate: string;
  studyDescription: string;
  modalities: string[];
  numSeries: number;
  numInstances: number;
  status: 'complete' | 'processing' | 'error';
}

// Mock data
const mockStudies: Study[] = [
  {
    id: '1',
    studyInstanceUid: '1.2.840.113619.2.55.3.123456789.1',
    patientName: 'John Doe',
    patientId: 'PAT001',
    studyDate: '2024-01-15',
    studyDescription: 'CT CHEST WITH CONTRAST',
    modalities: ['CT'],
    numSeries: 3,
    numInstances: 450,
    status: 'complete',
  },
  {
    id: '2',
    studyInstanceUid: '1.2.840.113619.2.55.3.123456789.2',
    patientName: 'Jane Smith',
    patientId: 'PAT002',
    studyDate: '2024-01-16',
    studyDescription: 'MRI BRAIN WITHOUT CONTRAST',
    modalities: ['MR'],
    numSeries: 5,
    numInstances: 280,
    status: 'complete',
  },
  {
    id: '3',
    studyInstanceUid: '1.2.840.113619.2.55.3.123456789.3',
    patientName: 'Robert Johnson',
    patientId: 'PAT003',
    studyDate: '2024-01-16',
    studyDescription: 'X-RAY CHEST PA/LAT',
    modalities: ['DX'],
    numSeries: 1,
    numInstances: 2,
    status: 'processing',
  },
];

const StudyListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedStudy, setSelectedStudy] = useState<Study | null>(null);

  const handleViewStudy = (study: Study) => {
    navigate(`/viewer/${study.studyInstanceUid}`);
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

  const getStatusColor = (status: Study['status']) => {
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

  const filteredStudies = mockStudies.filter(
    (study) =>
      study.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      study.patientId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      study.studyDescription.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Studies
        </Typography>
        <Button variant="contained" startIcon={<UploadIcon />}>
          Upload DICOM
        </Button>
      </Box>

      {/* Search and Filters */}
      <Card sx={{ mb: 3 }}>
        <Box sx={{ p: 2, display: 'flex', gap: 2 }}>
          <TextField
            placeholder="Search studies..."
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
              {filteredStudies
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map((study) => (
                  <TableRow
                    key={study.id}
                    hover
                    onClick={() => handleViewStudy(study)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {study.patientName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {study.patientId}
                      </Typography>
                    </TableCell>
                    <TableCell>{study.studyDescription}</TableCell>
                    <TableCell>{study.studyDate}</TableCell>
                    <TableCell>
                      {study.modalities.map((mod) => (
                        <Chip key={mod} label={mod} size="small" sx={{ mr: 0.5 }} />
                      ))}
                    </TableCell>
                    <TableCell align="center">{study.numSeries}</TableCell>
                    <TableCell align="center">{study.numInstances}</TableCell>
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
                ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={filteredStudies.length}
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
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleMenuClose}>
          <ListItemIcon>
            <ViewIcon fontSize="small" />
          </ListItemIcon>
          View Study
        </MenuItem>
        <MenuItem onClick={handleMenuClose}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          Export
        </MenuItem>
        <MenuItem onClick={handleMenuClose} sx={{ color: 'error.main' }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default StudyListPage;
