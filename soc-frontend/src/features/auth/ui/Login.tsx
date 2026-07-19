import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import apiClient from '../../../shared/api/apiClient';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const checkSession = async () => {
      try {
        await apiClient.get('/auth/session');
        const params = new URLSearchParams(location.search);
        navigate(params.get('redirect') || '/');
      } catch {
        // Not authenticated, stay on login page
      }
    };
    checkSession();
  }, [navigate, location]);

  return (
    <div className="login-screen">
      <div className="login-card glass-panel">
        <div className="login-logo">
          <span className="logo-icon pulse-glow">◆</span>
          <h1>Agentic SOC Platform</h1>
        </div>
        <p className="login-subtitle">Advanced Multi-Tenant SIEM & SOAR</p>

        <button
          className="login-btn premium-btn"
          onClick={() => {
            const redirectUrl = new URLSearchParams(window.location.search).get('redirect') || '/';
            window.location.href = `/api/auth/google/login?redirect=${encodeURIComponent(redirectUrl)}`;
          }}
        >
          <span className="btn-icon">G</span>
          Sign in with Corporate Google
        </button>

        <div className="login-footer">
          <p>Restricted Access. Authorized Personnel Only.</p>
        </div>
      </div>

      {/* Decorative background elements */}
      <div className="bg-glow-orb orb-1"></div>
      <div className="bg-glow-orb orb-2"></div>
    </div>
  );
}
