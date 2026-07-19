import React from 'react';

export const EmptyState: React.FC<{ message: string, icon?: React.ReactNode }> = ({ message, icon }) => (
  <div className="flex flex-col items-center justify-center p-8 border border-slate-700/50 bg-slate-800/20 rounded-lg text-slate-400">
    {icon || (
      <svg className="w-10 h-10 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
      </svg>
    )}
    <p>{message}</p>
  </div>
);
