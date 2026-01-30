/**
 * Window Level Menu
 *
 * Dropdown menu for selecting window/level presets based on modality
 */

import React from 'react';
import { Menu, MenuItem, Divider } from '@mui/material';
import { getWindowLevelPresets, type WindowLevelPreset } from '../../constants';

interface WindowLevelMenuProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  modality: string | null;
  onSelectPreset: (preset: WindowLevelPreset) => void;
  onResetToDefault: () => void;
}

export const WindowLevelMenu: React.FC<WindowLevelMenuProps> = ({
  anchorEl,
  open,
  onClose,
  modality,
  onSelectPreset,
  onResetToDefault,
}) => {
  const presets = modality
    ? getWindowLevelPresets(modality)
    : [{ name: 'Default', center: 128, width: 256 }];

  const handlePresetClick = (preset: WindowLevelPreset) => {
    onSelectPreset(preset);
    onClose();
  };

  const handleResetClick = () => {
    onResetToDefault();
    onClose();
  };

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
    >
      {presets.map((preset) => (
        <MenuItem
          key={preset.name}
          onClick={() => handlePresetClick(preset)}
        >
          {preset.name} (W {preset.width} / L {preset.center})
        </MenuItem>
      ))}
      <Divider />
      <MenuItem onClick={handleResetClick}>
        Reset to Series Default
      </MenuItem>
    </Menu>
  );
};

export default WindowLevelMenu;
