import React, { useEffect, useState, useRef } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { isTokenExpired, getTokenRole, decodeJwtPayload } from '@/shared/hooks/useAuthApi';

interface ProtectedRouteProps {
  allowedRoles?: string[];
}

const SESSION_CHECK_INTERVAL_MS = 60_000; // Check token expiry every 60s

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const [authState, setAuthState] = useState<'pending' | 'authenticated' | 'unauthenticated' | 'unauthorized' | 'expiring'>('pending');
  const [expiryWarning, setExpiryWarning] = useState<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const evaluateToken = (): 'authenticated' | 'unauthenticated' | 'unauthorized' => {
    // 1. Intercept token from OAuth hash fragment — do this FIRST to avoid leakage
    const hash = window.location.hash;
    if (hash.startsWith('#access_token=')) {
      const urlToken = hash.replace('#access_token=', '');
      // Purge from browser history IMMEDIATELY before any re-render or redirect
      window.history.replaceState({}, document.title, window.location.pathname);
      localStorage.setItem('internal_access_token', urlToken);
    }

    const token = localStorage.getItem('internal_access_token');
    if (!token) return 'unauthenticated';

    // 2. Validate expiry by decoding JWT exp claim (no signature check — server-side only)
    if (isTokenExpired(token)) {
      localStorage.removeItem('internal_access_token');
      return 'unauthenticated';
    }

    // 3. RBAC: Check role claim against allowedRoles if specified
    if (allowedRoles && allowedRoles.length > 0) {
      const role = getTokenRole(token);
      if (!role || !allowedRoles.includes(role)) {
        return 'unauthorized';
      }
    }

    return 'authenticated';
  };

  const checkSessionExpiry = () => {
    const token = localStorage.getItem('internal_access_token');
    if (!token) {
      setAuthState('unauthenticated');
      return;
    }
    if (isTokenExpired(token)) {
      localStorage.removeItem('internal_access_token');
      setAuthState('unauthenticated');
      return;
    }
    // Warn analyst if token expires in less than 5 minutes
    const payload = decodeJwtPayload(token);
    if (payload && typeof payload.exp === 'number') {
      const secondsLeft = payload.exp - Date.now() / 1000;
      setExpiryWarning(secondsLeft < 300);
    }
  };

  useEffect(() => {
    setAuthState(evaluateToken());

    // Proactive session expiry check every 60s
    intervalRef.current = setInterval(checkSessionExpiry, SESSION_CHECK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (authState === 'pending') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', backgroundColor: '#111827', color: 'white', fontFamily: 'monospace',
        flexDirection: 'column', gap: '12px',
      }}>
        <div style={{ fontSize: '2rem', animation: 'pulse 1.5s infinite' }}>🔐</div>
        <p>Verifying Analyst Identity…</p>
      </div>
    );
  }

  if (authState === 'unauthenticated') return <Navigate to="/login" replace />;
  if (authState === 'unauthorized') return <Navigate to="/unauthorized" replace />;

  return (
    <>
      {expiryWarning && (
        <div role="alert" aria-live="polite" style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: 'rgba(234,179,8,0.15)', borderBottom: '1px solid rgba(234,179,8,0.5)',
          padding: '10px', textAlign: 'center', fontFamily: 'monospace', fontSize: '13px', color: '#fde047',
        }}>
          ⚠ Your session is expiring in less than 5 minutes.{' '}
          <a href="/api/auth/google/login" style={{ color: '#facc15', textDecoration: 'underline' }}>
            Re-authenticate now
          </a>
        </div>
      )}
      <Outlet />
    </>
  );
};

export default ProtectedRoute;
