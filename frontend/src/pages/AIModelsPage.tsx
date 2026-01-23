/**
 * AI Models Page
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Alert,
  Skeleton,
  CircularProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Psychology as AIIcon,
  PlayArrow as LoadIcon,
  Stop as UnloadIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { api, AIModel } from '../services/api';

const AIModelsPage: React.FC = () => {
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [shapeError, setShapeError] = useState<string | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setShapeError(null);
      setServerMessage(null);

      const response = await api.ai.getModels();
      setModels(response.models ?? []);
      setShapeError(response.shape_error ?? null);
      setServerMessage(response.message ?? null);
    } catch (err) {
      console.error('Failed to fetch AI models:', err);
      setError('Failed to load AI models. Please try again.');
      setShapeError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleLoadModel = async (modelId: string) => {
    try {
      setLoadingModelId(modelId);
      await api.ai.loadModel(modelId);
      // Refresh models to get updated status
      await fetchModels();
    } catch (err) {
      console.error('Failed to load model:', err);
      setError(`Failed to load model: ${modelId}`);
    } finally {
      setLoadingModelId(null);
    }
  };

  const handleUnloadModel = async (modelId: string) => {
    try {
      setLoadingModelId(modelId);
      await api.ai.unloadModel(modelId);
      // Refresh models to get updated status
      await fetchModels();
    } catch (err) {
      console.error('Failed to unload model:', err);
      setError(`Failed to unload model: ${modelId}`);
    } finally {
      setLoadingModelId(null);
    }
  };

  const getTypeColor = (type: string): 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'default' => {
    const normalized = typeof type === 'string' ? type.toLowerCase() : '';
    switch (normalized) {
      case 'segmentation':
        return 'primary';
      case 'detection':
        return 'secondary';
      case 'classification':
        return 'success';
      case 'enhancement':
        return 'warning';
      case 'pathology':
        return 'info';
      default:
        return 'default';
    }
  };

  if (loading && models.length === 0) {
    return (
      <Box>
        <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
          AI Models
        </Typography>
        <Grid container spacing={3}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Grid item xs={12} sm={6} lg={4} key={i}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
                    <Skeleton variant="rounded" width={48} height={48} sx={{ mr: 2 }} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton variant="text" width="60%" />
                      <Skeleton variant="text" width="40%" />
                    </Box>
                  </Box>
                  <Skeleton variant="text" />
                  <Skeleton variant="text" />
                  <Box sx={{ mt: 2 }}>
                    <Skeleton variant="text" width="30%" />
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                      <Skeleton variant="rounded" width={40} height={24} />
                      <Skeleton variant="rounded" width={40} height={24} />
                      <Skeleton variant="rounded" width={40} height={24} />
                    </Box>
                  </Box>
                </CardContent>
                <CardActions>
                  <Skeleton variant="rounded" width={100} height={32} />
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          AI Models
        </Typography>
        <Tooltip title="Refresh">
          <IconButton onClick={fetchModels} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {shapeError && (
        <Alert severity="warning" sx={{ mb: 3 }} onClose={() => setShapeError(null)}>
          AI models response did not match the expected schema. Showing a safe empty state.
        </Alert>
      )}

      {serverMessage && !shapeError && (
        <Alert severity="info" sx={{ mb: 3 }} onClose={() => setServerMessage(null)}>
          {serverMessage}
        </Alert>
      )}

      {models.length === 0 ? (
        <Card>
          <CardContent>
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              No AI models available. Configure models in the backend settings.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {models.map((model) => {
            const details = model.details ?? {
              model_type: 'unknown',
              version: '',
              description: '',
              supported_modalities: [],
              performance_metrics: {},
            };
            const metrics = details.performance_metrics ?? {};
            const supportedModalities = Array.isArray(details.supported_modalities)
              ? details.supported_modalities
              : [];
            const isLoaded = model.status === 'loaded';
            const canLoad = model.status === 'available';
            const statusLabel = isLoaded
              ? 'Loaded'
              : model.status === 'available'
                ? 'Available'
                : model.status === 'missing_weights'
                  ? 'Missing weights'
                  : model.status === 'disabled'
                    ? 'Disabled'
                    : 'Unknown';
            const statusColor = isLoaded
              ? 'success'
              : model.status === 'available'
                ? 'info'
                : model.status === 'missing_weights'
                  ? 'warning'
                  : 'default';

            return (
              <Grid item xs={12} sm={6} lg={4} key={model.name}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
                    <Box
                      sx={{
                        width: 48,
                        height: 48,
                        borderRadius: 2,
                        bgcolor: isLoaded ? 'success.main' : canLoad ? 'info.main' : 'grey.400',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mr: 2,
                      }}
                    >
                      <AIIcon sx={{ color: 'white' }} />
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h6">{model.name}</Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        <Chip
                          label={details.model_type || 'Unknown'}
                          size="small"
                          color={getTypeColor(details.model_type)}
                        />
                        <Chip
                          label={statusLabel}
                          size="small"
                          color={statusColor}
                          variant="outlined"
                        />
                      </Box>
                    </Box>
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {details.description || 'No description available.'}
                  </Typography>

                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      Supported Modalities
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {(supportedModalities ?? []).length > 0 ? (
                        supportedModalities.map((mod) => (
                          <Chip key={mod} label={mod} size="small" variant="outlined" />
                        ))
                      ) : (
                        <Chip label="None listed" size="small" variant="outlined" />
                      )}
                    </Box>
                  </Box>

                  {Object.keys(metrics ?? {}).length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        Performance Metrics
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
                        {Object.entries(metrics ?? {}).map(([key, value]) => (
                          <Typography key={key} variant="body2">
                            <strong>{key}:</strong> {typeof value === 'number' ? value.toFixed(2) : value}
                          </Typography>
                        ))}
                      </Box>
                    </Box>
                  )}

                  {model.errors.length > 0 && (
                    <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                      {model.errors[0]}
                    </Typography>
                  )}
                </CardContent>
                <CardActions>
                  {isLoaded ? (
                    <Button
                      size="small"
                      color="error"
                      startIcon={
                        loadingModelId === model.name ? (
                          <CircularProgress size={16} color="inherit" />
                        ) : (
                          <UnloadIcon />
                        )
                      }
                      onClick={() => handleUnloadModel(model.name)}
                      disabled={loadingModelId !== null}
                    >
                      {loadingModelId === model.name ? 'Unloading...' : 'Unload'}
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      color="primary"
                      startIcon={
                        loadingModelId === model.name ? (
                          <CircularProgress size={16} color="inherit" />
                        ) : (
                          <LoadIcon />
                        )
                      }
                      onClick={() => handleLoadModel(model.name)}
                      disabled={loadingModelId !== null || !canLoad}
                    >
                      {loadingModelId === model.name ? 'Loading...' : 'Load Model'}
                    </Button>
                  )}
                  <Button size="small" disabled>
                    Documentation
                  </Button>
                </CardActions>
              </Card>
            </Grid>
            );
          })}
        </Grid>
      )}
    </Box>
  );
};

export default AIModelsPage;
