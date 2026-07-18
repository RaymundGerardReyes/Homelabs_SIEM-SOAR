import React from 'react';
import { useNavigate } from 'react-router-dom';

const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="page-container fadeIn" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="glow-text" style={{ fontSize: '4rem', fontWeight: 'bold', color: '#ef4444', marginBottom: '1rem' }}>404</div>
      <h2 style={{ marginBottom: '1rem' }}>Page Not Found</h2>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>The routing destination does not exist or has been moved.</p>
      <button className="premium-btn" onClick={() => navigate('/dashboard')}>
        Return to Command Center
      </button>
    </div>
  );
};

export default NotFoundPage;
