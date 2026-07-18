import React from 'react';

const Login: React.FC = () => {
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
          onClick={() => { window.location.href = '/api/auth/google/login'; }}
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
};

export default Login;
