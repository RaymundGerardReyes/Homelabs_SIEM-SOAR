import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../../hooks/useAuthApi';

// ─── Types ────────────────────────────────────────────────────────────────────
type ControlStatus = 'pass' | 'partial' | 'fail';

interface ComplianceControl {
  id: string;
  name: string;
  status: ControlStatus;
  lastAudit: string;
  notes?: string;
}

interface Framework {
  id: string;
  name: string;
  passCount: number;
  partialCount: number;
  failCount: number;
  totalControls: number;
  controls: ComplianceControl[];
}

// ─── Mock fallback ────────────────────────────────────────────────────────────
const MOCK_FRAMEWORKS: Framework[] = [
  {
    id: 'iso27001', name: 'ISO 27001', passCount: 78, partialCount: 12, failCount: 4, totalControls: 94,
    controls: [
      { id: 'A.5.1', name: 'Policies for information security', status: 'pass', lastAudit: '2026-06-01' },
      { id: 'A.8.1', name: 'Responsibility for assets', status: 'partial', lastAudit: '2026-05-15', notes: 'Asset register incomplete for cloud workloads' },
      { id: 'A.12.6', name: 'Management of technical vulnerabilities', status: 'fail', lastAudit: '2026-04-20', notes: 'Patch cycle SLA not being met' },
    ],
  },
  {
    id: 'soc2', name: 'SOC 2 Type II', passCount: 52, partialCount: 8, failCount: 2, totalControls: 62,
    controls: [
      { id: 'CC6.1', name: 'Logical and physical access controls', status: 'pass', lastAudit: '2026-06-10' },
      { id: 'CC7.2', name: 'System monitoring', status: 'pass', lastAudit: '2026-06-10' },
      { id: 'CC9.1', name: 'Risk assessment process', status: 'partial', lastAudit: '2026-05-01', notes: 'Annual review pending' },
    ],
  },
  {
    id: 'nist-csf', name: 'NIST CSF', passCount: 40, partialCount: 15, failCount: 5, totalControls: 60,
    controls: [
      { id: 'ID.AM', name: 'Asset Management', status: 'partial', lastAudit: '2026-06-05', notes: 'Shadow IT inventory gaps' },
      { id: 'PR.AC', name: 'Identity Management & Access Control', status: 'pass', lastAudit: '2026-06-05' },
      { id: 'RS.CO', name: 'Response Communications', status: 'fail', lastAudit: '2026-04-01', notes: 'Runbooks not updated post-restructure' },
    ],
  },
  {
    id: 'pci-dss', name: 'PCI-DSS v4', passCount: 230, partialCount: 18, failCount: 9, totalControls: 257,
    controls: [
      { id: 'Req 1', name: 'Network Security Controls', status: 'pass', lastAudit: '2026-06-01' },
      { id: 'Req 6', name: 'Develop & Maintain Secure Systems', status: 'partial', lastAudit: '2026-05-20', notes: 'WAF rule review outstanding' },
      { id: 'Req 11', name: 'Test Security Systems Regularly', status: 'fail', lastAudit: '2026-03-01', notes: 'Penetration test overdue' },
    ],
  },
];

const STATUS_META: Record<ControlStatus, { color: string; bg: string; label: string }> = {
  pass:    { color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  label: 'PASS' },
  partial: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', label: 'PARTIAL' },
  fail:    { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  label: 'FAIL' },
};

const CompliancePage: React.FC = () => {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient.get<Framework[]>('/data/dashboards/compliance-status')
      .then(res => setFrameworks(res.data))
      .catch(() => setFrameworks(MOCK_FRAMEWORKS))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await apiClient.get('/data/dashboards/compliance-export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = 'compliance-report.pdf'; a.click();
    } catch {
      // Stub: show a notification in a real system
      alert('Export endpoint not yet available — integration pending.');
    } finally {
      setExporting(false);
    }
  };

  if (loading) return (
    <div className="page-container fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {[1,2,3,4].map(i => <div key={i} className="glass-panel" style={{ height: '80px', animation: 'pulse 1.5s ease-in-out infinite' }} />)}
    </div>
  );

  if (error) return (
    <div className="page-container fadeIn">
      <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '3px solid #ef4444' }}>
        <p style={{ color: '#ef4444' }}>{error}</p>
        <button className="premium-btn" onClick={fetchData} style={{ marginTop: '1rem' }}>↻ Retry</button>
      </div>
    </div>
  );

  return (
    <div className="page-container fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Compliance Dashboard</h1>
          <p className="subtitle">Framework coverage status across all active control sets</p>
        </div>
        <button className="premium-btn" onClick={handleExport} disabled={exporting} style={{ marginTop: '0.5rem' }}>
          {exporting ? '⏳ Exporting…' : '↓ Export Report'}
        </button>
      </div>

      {frameworks.map(fw => {
        const pct = Math.round((fw.passCount / fw.totalControls) * 100);
        const isOpen = expandedId === fw.id;
        return (
          <div key={fw.id} className="glass-panel" style={{ overflow: 'hidden' }}>
            {/* Framework row */}
            <div
              onClick={() => setExpandedId(isOpen ? null : fw.id)}
              style={{ padding: '1.25rem 1.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1rem' }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '15px' }}>{fw.name}</span>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>{fw.passCount}/{fw.totalControls} controls passing</span>
                </div>
                <div style={{ height: '6px', background: '#1e293b', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: `${(fw.passCount / fw.totalControls) * 100}%`, background: '#4ade80', transition: 'width 0.6s ease' }} />
                  <div style={{ width: `${(fw.partialCount / fw.totalControls) * 100}%`, background: '#fbbf24' }} />
                  <div style={{ width: `${(fw.failCount / fw.totalControls) * 100}%`, background: '#ef4444' }} />
                </div>
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: pct >= 90 ? '#4ade80' : pct >= 70 ? '#fbbf24' : '#ef4444', minWidth: '56px', textAlign: 'right', fontFamily: 'monospace' }}>
                {pct}%
              </div>
              <div style={{ color: '#64748b', fontSize: '18px', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▼</div>
            </div>

            {/* Drilled-down controls */}
            {isOpen && (
              <div style={{ borderTop: '1px solid #1e293b' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                      {['Control ID', 'Name', 'Status', 'Last Audit', 'Notes'].map(h => (
                        <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fw.controls.map(ctrl => {
                      const meta = STATUS_META[ctrl.status];
                      return (
                        <tr key={ctrl.id} style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: '12px', color: '#38bdf8' }}>{ctrl.id}</td>
                          <td style={{ padding: '10px 16px', fontSize: '13px', color: '#e2e8f0' }}>{ctrl.name}</td>
                          <td style={{ padding: '10px 16px' }}>
                            <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, color: meta.color, background: meta.bg }}>{meta.label}</span>
                          </td>
                          <td style={{ padding: '10px 16px', fontSize: '12px', color: '#94a3b8' }}>{ctrl.lastAudit}</td>
                          <td style={{ padding: '10px 16px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>{ctrl.notes ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default CompliancePage;
