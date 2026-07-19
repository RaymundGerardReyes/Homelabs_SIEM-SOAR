import React from 'react';
import { theme } from '../theme';

type BadgeSeverity = keyof typeof theme.severity;

export const Badge: React.FC<{ children: React.ReactNode, severity?: BadgeSeverity, className?: string }> = ({ 
  children, 
  severity = 'S4',
  className = '' 
}) => {
  const colorClass = theme.severity[severity];
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${colorClass} ${className}`}>
      {children}
    </span>
  );
};
