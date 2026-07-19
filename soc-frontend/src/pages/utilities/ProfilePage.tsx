// @ts-nocheck
import React, { useEffect, useState } from 'react';
import apiClient from '../../shared/api/apiClient';

export default function ProfilePage() {
  const [user, setUser] = useState<{ email: string, role: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await apiClient.get('/auth/session');
        setUser(res.data.user);
      } catch {
        // Interceptor handles 401
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <h1 className="text-2xl font-bold text-white mb-6">Analyst Profile</h1>
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl max-w-lg">
        <div className="flex items-center space-x-4 mb-6">
          <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
            {user?.email?.[0]?.toUpperCase() || 'U'}
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">{user?.email || 'Unknown User'}</h2>
            <p className="text-sm text-slate-400 uppercase tracking-wider">Role: {user?.role || 'ANALYST'}</p>
          </div>
        </div>
        <div className="space-y-2 text-sm text-slate-300 border-t border-slate-800 pt-4">
          <p>Session Type: <span className="text-white">HttpOnly Secure Cookie</span></p>
        </div>
      </div>
    </div>
  );
}
