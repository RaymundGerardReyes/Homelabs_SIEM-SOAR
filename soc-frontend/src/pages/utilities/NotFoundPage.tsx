import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-300 ml-64">
      <h1 className="text-5xl font-bold text-slate-500 mb-4">404</h1>
      <p className="text-xl mb-8 text-slate-400">This sector of the SOC does not exist.</p>
      <button onClick={() => navigate('/')} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded transition-colors">
        Return to Command Center
      </button>
    </div>
  );
}
