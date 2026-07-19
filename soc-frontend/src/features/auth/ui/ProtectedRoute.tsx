import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import apiClient from '../../../shared/api/apiClient';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const [isVerifying, setIsVerifying] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const verifySession = async () => {
      try {
        const res = await apiClient.get('/auth/session');
        setUserRole(res.data.user.role);
        setIsValid(true);
      } catch {
        setIsValid(false);
      } finally {
        setIsVerifying(false);
      }
    };
    verifySession();
  }, []);

  if (isVerifying) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">Verifying session...</div>;

  if (!isValid) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (allowedRoles && userRole && !allowedRoles.includes(userRole)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
}
