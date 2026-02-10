/**
 * Tool Button
 *
 * Reusable icon button for toolbar actions with tooltip and active state
 */

import React from 'react';
import { IconButton, Tooltip } from '@mui/material';

interface ToolButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  isActive?: boolean;
  disabled?: boolean;
  color?: 'primary' | 'secondary' | 'default' | 'inherit';
}

export const ToolButton: React.FC<ToolButtonProps> = ({
  label,
  icon,
  onClick,
  isActive = false,
  disabled = false,
  color,
}) => {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          onClick={onClick}
          color={color ?? 'default'}
          disabled={disabled}
          aria-label={label}
          size="medium"
          sx={{
            borderRadius: 1,
            bgcolor: isActive ? 'action.selected' : 'transparent',
            color: isActive ? 'primary.main' : 'text.secondary',
            transition: 'all 0.15s ease',
            '&:hover': {
              bgcolor: 'action.hover',
              color: 'text.primary',
            },
          }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
};

export default ToolButton;
