import React from 'react';

const ProfilePage: React.FC = () => (
  <div className="page-container fadeIn">
    <div className="header"><h1>User Profile</h1><p className="subtitle">Data source: <code>GET /api/profile</code></p></div>
    <div className="glass-panel" style={{ padding: '2rem', marginTop: '1rem', textAlign: 'center' }}>
      <h3 style={{ color: '#94a3b8', fontFamily: 'monospace' }}>Future Implementation Marker</h3>
      <p style={{ color: '#64748b', fontSize: '14px', marginTop: '10px' }}>Placeholder for <strong>GET /api/profile</strong>.</p>
    </div>
  </div>
);

export default ProfilePage;
