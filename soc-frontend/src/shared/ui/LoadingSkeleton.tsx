import React from 'react';

export const LoadingSkeleton: React.FC<{ lines?: number, className?: string }> = ({ lines = 3, className = '' }) => (
  <div className={`animate-pulse space-y-4 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <div key={i} className="h-4 bg-slate-700/50 rounded w-3/4"></div>
    ))}
  </div>
);
