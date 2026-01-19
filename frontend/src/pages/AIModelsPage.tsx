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
  LinearProgress,
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

  const fetchModels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.ai.getModels();
      setModels(response.models);
    } catch (err) {
      console.error('Failed to fetch AI models:', err);
      setError('Failed to load AI models. Please try again.');
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
    switch (type.toLowerCase()) {
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
          {models.map((model) => (
            <Grid item xs={12} sm={6} lg={4} key={model.model_id}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
                    <Box
                      sx={{
                        width: 48,
                        height: 48,
                        borderRadius: 2,
                        bgcolor: model.is_loaded ? 'success.main' : 'grey.400',
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
                      <Chip
                        label={model.model_type}
                        size="small"
                        color={getTypeColor(model.model_type)}
                      />
                    </Box>
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {model.description}
                  </Typography>

                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      Supported Modalities
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {model.supported_modalities.map((mod) => (
                        <Chip key={mod} label={mod} size="small" variant="outlined" />
                      ))}
                    </Box>
                  </Box>

                  {Object.keys(model.metrics).length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        Performance Metrics
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
                        {Object.entries(model.metrics).map(([key, value]) => (
                          <Typography key={key} variant="body2">
                            <strong>{key}:</strong> {typeof value === 'number' ? value.toFixed(2) : value}
                          </Typography>
                        ))}
                      </Box>
                    </Box>
                  )}

                  {model.is_loaded && model.memory_usage_mb > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Memory Usage: {model.memory_usage_mb} MB
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min((model.memory_usage_mb / 4000) * 100, 100)}
                        sx={{ mt: 0.5 }}
                        color={model.memory_usage_mb > 3000 ? 'error' : model.memory_usage_mb > 2000 ? 'warning' : 'primary'}
                      />
                    </Box>
                  )}
                </CardContent>
                <CardActions>
                  {model.is_loaded ? (
                    <Button
                      size="small"
                      color="error"
                      startIcon={
                        loadingModelId === model.model_id ? (
                          <CircularProgress size={16} color="inherit" />
                        ) : (
                          <UnloadIcon />
                        )
                      }
                      onClick={() => handleUnloadModel(model.model_id)}
                      disabled={loadingModelId !== null}
                    >
                      {loadingModelId === model.model_id ? 'Unloading...' : 'Unload'}
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      color="primary"
                      startIcon={
                        loadingModelId === model.model_id ? (
                          <CircularProgress size={16} color="inherit" />
                        ) : (
                          <LoadIcon />
                        )
                      }
                      onClick={() => handleLoadModel(model.model_id)}
                      disabled={loadingModelId !== null}
                    >
                      {loadingModelId === model.model_id ? 'Loading...' : 'Load Model'}
                    </Button>
                  )}
                  <Button size="small" disabled>
                    Documentation
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
};

export default AIModelsPage;
