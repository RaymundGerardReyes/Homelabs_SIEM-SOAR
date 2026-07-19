import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function UnauthorizedPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-300">
      <h1 className="text-5xl font-bold text-red-500 mb-4">403</h1>
      <p className="text-xl mb-8">Unauthorized access. You do not have the required permissions.</p>
      <button onClick={() => navigate('/')} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded">
        Return to Command Center
      </button>
    </div>
  );
}
