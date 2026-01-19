/**
 * AI Models Page
 */

import React from 'react';
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
} from '@mui/material';
import {
  Psychology as AIIcon,
  PlayArrow as LoadIcon,
  Stop as UnloadIcon,
} from '@mui/icons-material';

interface AIModel {
  id: string;
  name: string;
  description: string;
  type: string;
  modalities: string[];
  isLoaded: boolean;
  memoryUsage: number;
  metrics: Record<string, number>;
}

const models: AIModel[] = [
  {
    id: 'nnunet',
    name: 'nnU-Net',
    description: 'Self-configuring deep learning for medical image segmentation',
    type: 'Segmentation',
    modalities: ['CT', 'MR', 'PT'],
    isLoaded: false,
    memoryUsage: 0,
    metrics: { dice: 0.92, hd95: 3.2 },
  },
  {
    id: 'medsam',
    name: 'MedSAM',
    description: 'Foundation model for universal medical image segmentation',
    type: 'Segmentation',
    modalities: ['CT', 'MR', 'US', 'XA', 'DX', 'MG'],
    isLoaded: false,
    memoryUsage: 0,
    metrics: { dice: 0.89 },
  },
  {
    id: 'yolov8',
    name: 'YOLOv8 Medical',
    description: 'Real-time object detection for medical imaging',
    type: 'Detection',
    modalities: ['DX', 'CR', 'CT', 'MR', 'US'],
    isLoaded: true,
    memoryUsage: 1200,
    metrics: { mAP: 0.85, fps: 45 },
  },
  {
    id: 'vit',
    name: 'Vision Transformer',
    description: 'ViT for medical image classification',
    type: 'Classification',
    modalities: ['DX', 'CR', 'CT', 'MR'],
    isLoaded: false,
    memoryUsage: 0,
    metrics: { auroc: 0.94, accuracy: 0.91 },
  },
  {
    id: 'unimie',
    name: 'UniMIE',
    description: 'Training-free diffusion model for image enhancement',
    type: 'Enhancement',
    modalities: ['CT', 'MR', 'DX', 'US'],
    isLoaded: false,
    memoryUsage: 0,
    metrics: { psnr: 32.5, ssim: 0.95 },
  },
  {
    id: 'gigapath',
    name: 'Prov-GigaPath',
    description: 'Whole-slide foundation model for pathology',
    type: 'Pathology',
    modalities: ['SM'],
    isLoaded: false,
    memoryUsage: 0,
    metrics: { auroc: 0.94 },
  },
];

const AIModelsPage: React.FC = () => {
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'Segmentation':
        return 'primary';
      case 'Detection':
        return 'secondary';
      case 'Classification':
        return 'success';
      case 'Enhancement':
        return 'warning';
      case 'Pathology':
        return 'info';
      default:
        return 'default';
    }
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
        AI Models
      </Typography>

      <Grid container spacing={3}>
        {models.map((model) => (
          <Grid item xs={12} sm={6} lg={4} key={model.id}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 2,
                      bgcolor: 'primary.main',
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
                      label={model.type}
                      size="small"
                      color={getTypeColor(model.type) as any}
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
                    {model.modalities.map((mod) => (
                      <Chip key={mod} label={mod} size="small" variant="outlined" />
                    ))}
                  </Box>
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Performance Metrics
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                    {Object.entries(model.metrics).map(([key, value]) => (
                      <Typography key={key} variant="body2">
                        <strong>{key}:</strong> {value}
                      </Typography>
                    ))}
                  </Box>
                </Box>

                {model.isLoaded && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Memory Usage: {model.memoryUsage} MB
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={(model.memoryUsage / 4000) * 100}
                      sx={{ mt: 0.5 }}
                    />
                  </Box>
                )}
              </CardContent>
              <CardActions>
                {model.isLoaded ? (
                  <Button
                    size="small"
                    color="error"
                    startIcon={<UnloadIcon />}
                  >
                    Unload
                  </Button>
                ) : (
                  <Button
                    size="small"
                    color="primary"
                    startIcon={<LoadIcon />}
                  >
                    Load Model
                  </Button>
                )}
                <Button size="small">Documentation</Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default AIModelsPage;
