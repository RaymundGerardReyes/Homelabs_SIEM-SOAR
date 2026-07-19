import React from 'react';
import { theme } from '../theme';

type StatusType = keyof typeof theme.status;

export const StatusDot: React.FC<{ status: StatusType, pulse?: boolean }> = ({ status, pulse }) => {
  const colorClass = theme.status[status];
  
  return (
    <span className="relative flex h-3 w-3 items-center justify-center">
      {pulse && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${colorClass.replace('text-', 'bg-')}`}></span>
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${colorClass.replace('text-', 'bg-')}`}></span>
    </span>
  );
};
