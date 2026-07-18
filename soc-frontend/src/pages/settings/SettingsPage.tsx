import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../../hooks/useAuthApi';

// ─── Types ────────────────────────────────────────────────────────────────────
interface UserProfile {
  name: string;
  email: string;
  role: string;
  tier: string;
  timezone: string;
  defaultDashboard: string;
  notifications: { email: boolean; inApp: boolean; critical: boolean };
  apiKeys: ApiKey[];
}

interface ApiKey {
  id: string;
  name: string;
  maskedValue: string;
  createdAt: string;
  lastUsed: string | null;
}

const MOCK_PROFILE: UserProfile = {
  name: 'Principal Analyst',
  email: 'analyst@soc.internal',
  role: 'SOC Analyst',
  tier: 'Tier 3 / System Engineer',
  timezone: 'Asia/Manila',
  defaultDashboard: 'overview',
  notifications: { email: true, inApp: true, critical: true },
  apiKeys: [
    { id: 'k1', name: 'CI/CD Pipeline Key', maskedValue: 'sk-soc-****-****-****-abcd', createdAt: '2026-06-01', lastUsed: '2026-07-17T08:00:00Z' },
    { id: 'k2', name: 'SIEM Integration Key', maskedValue: 'sk-soc-****-****-****-ef12', createdAt: '2026-05-15', lastUsed: null },
  ],
};

const TIMEZONES = ['UTC', 'Asia/Manila', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin'];

// ─── Danger Zone TwoKey (self-contained) ─────────────────────────────────────
const DangerConfirmModal: React.FC<{ phrase: string; label: string; onConfirm: () => void; onCancel: () => void }> = ({ phrase, label, onConfirm, onCancel }) => {
  const [input, setInput] = useState('');
  const isMatch = input.trim() === phrase;
  return (
    <div className="modal-overlay glass-overlay fadeIn" role="dialog" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-content popIn" style={{ maxWidth: '460px', padding: '2rem' }}>
        <div className="modal-warning-header">
          <span className="warning-icon pulse-glow">⚠️</span>
          <h2>DANGER ZONE</h2>
        </div>
        <div className="modal-body">
          <p>{label}</p>
          <p>Type <code className="code-block">{phrase}</code> to confirm:</p>
          <input type="text" className={`danger-input glass-input ${input.length > 0 && !isMatch ? 'input-error' : ''}`}
            value={input} onChange={e => setInput(e.target.value)} autoFocus autoComplete="off" />
          {isMatch && <p style={{ color: '#4ade80', fontSize: '12px', marginTop: '4px' }}>✔ Confirmed</p>}
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="confirm-danger-btn" disabled={!isMatch} onClick={onConfirm}>Proceed</button>
        </div>
      </div>
    </div>
  );
};

type Section = 'profile' | 'notifications' | 'api-keys' | 'platform';

const SettingsPage: React.FC = () => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>('profile');
  const [dangerModal, setDangerModal] = useState<{ phrase: string; label: string; onConfirm: () => void } | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    apiClient.get<UserProfile>('/data/settings')
      .then(res => setProfile(res.data))
      .catch(() => setProfile(MOCK_PROFILE))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.patch('/data/settings', profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      alert('Settings save failed — backend not yet wired.');
    } finally {
      setSaving(false);
    }
  };

  const revokeAllSessions = () => {
    setDangerModal({
      phrase: 'REVOKE ALL SESSIONS',
      label: 'This will immediately sign out all active sessions including your current one.',
      onConfirm: async () => {
        setDangerModal(null);
        try { await apiClient.post('/data/auth/revoke-all-sessions'); }
        catch { alert('Revoke sessions — backend not yet wired.'); }
      },
    });
  };

  const revokeKey = (keyId: string, keyName: string) => {
    setDangerModal({
      phrase: keyName,
      label: `Revoking "${keyName}" will permanently invalidate it. Any integrations using it will fail.`,
      onConfirm: () => {
        setDangerModal(null);
        setProfile(prev => prev ? { ...prev, apiKeys: prev.apiKeys.filter(k => k.id !== keyId) } : prev);
      },
    });
  };

  if (loading || !profile) return (
    <div className="page-container fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {[1, 2, 3].map(i => <div key={i} className="glass-panel" style={{ height: '80px', animation: 'pulse 1.5s ease-in-out infinite' }} />)}
    </div>
  );

  const sections: { id: Section; label: string }[] = [
    { id: 'profile', label: '👤 Profile' },
    { id: 'notifications', label: '🔔 Notifications' },
    { id: 'api-keys', label: '🔑 API Keys' },
    { id: 'platform', label: '⚙ Platform' },
  ];

  return (
    <div className="page-container fadeIn" style={{ display: 'flex', gap: '1.5rem', height: '100%' }}>
      {/* Section Nav */}
      <div style={{ width: '200px', display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Settings</h1>
        {sections.map(s => (
          <div
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            style={{
              padding: '10px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
              background: activeSection === s.id ? 'rgba(56,189,248,0.1)' : 'transparent',
              color: activeSection === s.id ? '#38bdf8' : '#94a3b8',
              borderLeft: activeSection === s.id ? '2px solid #38bdf8' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            {s.label}
          </div>
        ))}
      </div>

      {/* Section Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Save feedback */}
        {saved && (
          <div style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid #4ade80', borderRadius: '6px', padding: '8px 16px', color: '#4ade80', fontSize: '13px' }}>
            ✔ Settings saved successfully
          </div>
        )}

        {activeSection === 'profile' && (
          <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ margin: 0, color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>User Profile</h3>
            {[
              { label: 'Full Name', key: 'name' as const },
              { label: 'Email', key: 'email' as const },
            ].map(({ label, key }) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#64748b' }}>{label}</label>
                <input
                  type={key === 'email' ? 'email' : 'text'}
                  value={(profile[key] as string)}
                  onChange={e => setProfile(prev => prev ? { ...prev, [key]: e.target.value } : prev)}
                  style={{ padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '6px' }}
                />
              </div>
            ))}
            <div>
              <label style={{ fontSize: '12px', color: '#64748b' }}>Role / Tier</label>
              <div style={{ padding: '8px 12px', color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>{profile.role} — {profile.tier}</div>
            </div>
            <button className="premium-btn" onClick={save} disabled={saving} style={{ alignSelf: 'flex-start' }}>
              {saving ? '⏳ Saving…' : '💾 Save Changes'}
            </button>
          </div>
        )}

        {activeSection === 'notifications' && (
          <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ margin: 0, color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Notification Preferences</h3>
            {[
              { key: 'email' as const, label: 'Email Notifications' },
              { key: 'inApp' as const, label: 'In-App Notifications' },
              { key: 'critical' as const, label: 'Critical Alert Paging' },
            ].map(({ key, label }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', fontSize: '14px', color: '#e2e8f0' }}>
                <input type="checkbox" checked={profile.notifications[key]}
                  onChange={e => setProfile(prev => prev ? { ...prev, notifications: { ...prev.notifications, [key]: e.target.checked } } : prev)} />
                {label}
              </label>
            ))}
            <button className="premium-btn" onClick={save} disabled={saving} style={{ alignSelf: 'flex-start', marginTop: '0.5rem' }}>
              {saving ? '⏳ Saving…' : '💾 Save Preferences'}
            </button>
          </div>
        )}

        {activeSection === 'api-keys' && (
          <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>API Keys</h3>
              <button className="premium-btn" onClick={() => alert('Create Key — backend integration pending')}>+ New Key</button>
            </div>
            {profile.apiKeys.map(key => (
              <div key={key.id} className="glass-panel" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{key.name}</div>
                  <code style={{ fontSize: '12px', color: '#64748b' }}>{key.maskedValue}</code>
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px' }}>
                    Created: {key.createdAt} · Last used: {key.lastUsed ? new Date(key.lastUsed).toLocaleString() : 'Never'}
                  </div>
                </div>
                <button onClick={() => revokeKey(key.id, key.name)}
                  style={{ padding: '5px 12px', border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}>
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}

        {activeSection === 'platform' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <h3 style={{ margin: 0, color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Platform Preferences</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#64748b' }}>Timezone</label>
                <select value={profile.timezone} onChange={e => setProfile(prev => prev ? { ...prev, timezone: e.target.value } : prev)}
                  style={{ padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '6px', width: 'max-content' }}>
                  {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <button className="premium-btn" onClick={save} disabled={saving} style={{ alignSelf: 'flex-start' }}>
                {saving ? '⏳ Saving…' : '💾 Save Platform Settings'}
              </button>
            </div>

            {/* Danger Zone */}
            <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h3 style={{ margin: 0, color: '#ef4444', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>⚠ Danger Zone</h3>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(239,68,68,0.05)', borderRadius: '6px' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#e2e8f0' }}>Revoke All Active Sessions</div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Signs out all devices including this session immediately.</div>
                </div>
                <button onClick={revokeAllSessions}
                  style={{ padding: '8px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, flexShrink: 0, marginLeft: '1rem' }}>
                  Revoke All
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {dangerModal && (
        <DangerConfirmModal
          phrase={dangerModal.phrase}
          label={dangerModal.label}
          onConfirm={dangerModal.onConfirm}
          onCancel={() => setDangerModal(null)}
        />
      )}
    </div>
  );
};

export default SettingsPage;
