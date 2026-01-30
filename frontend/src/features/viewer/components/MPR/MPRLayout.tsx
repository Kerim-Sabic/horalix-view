/**
 * MPR Layout Component
 *
 * Layout container for 2x2 grid with axial, coronal, sagittal views
 * and optional 3D volume rendering
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Box, IconButton, Tooltip, ToggleButton, ToggleButtonGroup } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import GridViewIcon from '@mui/icons-material/GridView';
import ViewStreamIcon from '@mui/icons-material/ViewStream';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import type { MPRPlane } from '../../types/mpr.types';
import { useMPRStore } from '../../hooks/useMPRStore';
import { MPRViewport } from './MPRViewport';

type LayoutMode = 'quad' | 'single';

interface MPRLayoutProps {
  seriesUid: string;
  getMPRImageUrl?: (plane: MPRPlane, sliceIndex: number) => string | null;
}

export const MPRLayout: React.FC<MPRLayoutProps> = ({
  seriesUid,
  getMPRImageUrl,
}) => {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('quad');
  const [expandedPlane, setExpandedPlane] = useState<MPRPlane>('axial');

  // Store state
  const volumeInfo = useMPRStore((state) => state.volumeInfo);
  const linked = useMPRStore((state) => state.linked);
  const activeView = useMPRStore((state) => state.activeView);
  const axialSlice = useMPRStore((state) => state.views.axial.sliceIndex);
  const coronalSlice = useMPRStore((state) => state.views.coronal.sliceIndex);
  const sagittalSlice = useMPRStore((state) => state.views.sagittal.sliceIndex);
  const toggleLinked = useMPRStore((state) => state.toggleLinked);
  const resetAllViews = useMPRStore((state) => state.resetAllViews);
  const setActiveView = useMPRStore((state) => state.setActiveView);

  // Get image URLs for each plane
  const getImageUrl = useCallback(
    (plane: MPRPlane) => {
      if (!getMPRImageUrl) return null;

      let sliceIndex: number;
      switch (plane) {
        case 'axial':
          sliceIndex = axialSlice;
          break;
        case 'coronal':
          sliceIndex = coronalSlice;
          break;
        case 'sagittal':
          sliceIndex = sagittalSlice;
          break;
      }

      return getMPRImageUrl(plane, sliceIndex);
    },
    [getMPRImageUrl, axialSlice, coronalSlice, sagittalSlice]
  );

  // Handle double-click to expand/collapse view
  const handleDoubleClick = useCallback(
    (plane: MPRPlane) => {
      if (layoutMode === 'quad') {
        setLayoutMode('single');
        setExpandedPlane(plane);
      } else {
        setLayoutMode('quad');
      }
    },
    [layoutMode]
  );

  // Update expanded plane when active view changes in single mode
  useEffect(() => {
    if (layoutMode === 'single' && activeView && activeView !== expandedPlane) {
      setExpandedPlane(activeView);
    }
  }, [activeView, layoutMode, expandedPlane]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to return to quad view
      if (e.key === 'Escape' && layoutMode === 'single') {
        setLayoutMode('quad');
        return;
      }

      // 1, 2, 3 to switch planes
      if (e.key === '1') {
        setActiveView('axial');
        if (layoutMode === 'single') setExpandedPlane('axial');
      } else if (e.key === '2') {
        setActiveView('coronal');
        if (layoutMode === 'single') setExpandedPlane('coronal');
      } else if (e.key === '3') {
        setActiveView('sagittal');
        if (layoutMode === 'single') setExpandedPlane('sagittal');
      }

      // L to toggle linked
      if (e.key === 'l' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        toggleLinked();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layoutMode, toggleLinked, setActiveView]);

  const renderViewport = (plane: MPRPlane) => (
    <Box
      sx={{ width: '100%', height: '100%' }}
      onDoubleClick={() => handleDoubleClick(plane)}
    >
      <MPRViewport
        plane={plane}
        imageUrl={getImageUrl(plane)}
      />
    </Box>
  );

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'grey.900',
      }}
    >
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1,
          py: 0.5,
          bgcolor: 'grey.800',
          borderBottom: 1,
          borderColor: 'grey.700',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ToggleButtonGroup
            size="small"
            value={layoutMode}
            exclusive
            onChange={(_, value) => value && setLayoutMode(value)}
          >
            <ToggleButton value="quad" title="Quad view">
              <GridViewIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="single" title="Single view">
              <ViewStreamIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>

          {layoutMode === 'single' && (
            <ToggleButtonGroup
              size="small"
              value={expandedPlane}
              exclusive
              onChange={(_, value) => value && setExpandedPlane(value)}
            >
              <ToggleButton value="axial" sx={{ color: '#00ff00' }}>A</ToggleButton>
              <ToggleButton value="coronal" sx={{ color: '#0000ff' }}>C</ToggleButton>
              <ToggleButton value="sagittal" sx={{ color: '#ff0000' }}>S</ToggleButton>
            </ToggleButtonGroup>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title={linked ? 'Unlink views' : 'Link views'}>
            <IconButton
              size="small"
              onClick={toggleLinked}
              sx={{ color: linked ? 'primary.main' : 'grey.500' }}
            >
              {linked ? <LinkIcon /> : <LinkOffIcon />}
            </IconButton>
          </Tooltip>

          <Tooltip title="Reset all views">
            <IconButton size="small" onClick={resetAllViews}>
              <RestartAltIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Viewports */}
      <Box sx={{ flex: 1, p: 0.5, overflow: 'hidden' }}>
        {layoutMode === 'quad' ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gridTemplateRows: '1fr 1fr',
              gap: 0.5,
              width: '100%',
              height: '100%',
            }}
          >
            {/* Top-left: Axial */}
            {renderViewport('axial')}

            {/* Top-right: Sagittal */}
            {renderViewport('sagittal')}

            {/* Bottom-left: Coronal */}
            {renderViewport('coronal')}

            {/* Bottom-right: 3D or info panel */}
            <Box
              sx={{
                bgcolor: 'grey.900',
                border: 2,
                borderColor: 'grey.800',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'grey.500',
                p: 2,
              }}
            >
              {volumeInfo ? (
                <Box sx={{ width: '100%' }}>
                  <Box sx={{ mb: 1 }}>
                    <strong style={{ color: '#fff', fontSize: 12 }}>Volume Overview</strong>
                  </Box>
                  <Box sx={{ fontSize: 11, fontFamily: 'monospace', color: 'grey.300' }}>
                    <div>Dimensions: {volumeInfo.dimensions[0]} x {volumeInfo.dimensions[1]} x {volumeInfo.dimensions[2]}</div>
                    <div>Spacing: {volumeInfo.spacing[0].toFixed(2)} x {volumeInfo.spacing[1].toFixed(2)} x {volumeInfo.spacing[2].toFixed(2)} mm</div>
                    <div>Modality: {volumeInfo.modality}</div>
                    <div>Series: {volumeInfo.seriesUid.slice(0, 12)}...</div>
                  </Box>
                </Box>
              ) : (
                <span>Volume info unavailable</span>
              )}
            </Box>
          </Box>
        ) : (
          // Single expanded view
          <Box sx={{ width: '100%', height: '100%' }}>
            {renderViewport(expandedPlane)}
          </Box>
        )}
      </Box>

      {/* Footer info */}
      <Box
        sx={{
          px: 1,
          py: 0.5,
          bgcolor: 'grey.800',
          borderTop: 1,
          borderColor: 'grey.700',
          display: 'flex',
          gap: 2,
          fontSize: 11,
          color: 'grey.400',
          fontFamily: 'monospace',
        }}
      >
        <span>Series: {seriesUid.slice(0, 20)}...</span>
        <span>|</span>
        <span style={{ color: '#00ff00' }}>A: {axialSlice + 1}</span>
        <span style={{ color: '#0000ff' }}>C: {coronalSlice + 1}</span>
        <span style={{ color: '#ff0000' }}>S: {sagittalSlice + 1}</span>
        <span>|</span>
        <span>Press 1/2/3 to switch views, L to toggle link</span>
      </Box>
    </Box>
  );
};

export default MPRLayout;
