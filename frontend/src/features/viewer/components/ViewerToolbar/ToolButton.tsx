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
  const buttonColor = color ?? (isActive ? 'primary' : 'default');

  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          onClick={onClick}
          color={buttonColor}
          disabled={disabled}
          aria-label={label}
          size="medium"
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
};

export default ToolButton;
