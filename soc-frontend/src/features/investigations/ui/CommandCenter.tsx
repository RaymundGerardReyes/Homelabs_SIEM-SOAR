import React from 'react';
import { useSystemMetrics } from '@/shared/hooks/useSystemMetrics';
import { Alert } from '@/types';

interface CommandCenterProps {
  alerts: Alert[];
  viewInvestigation: (alert: Alert) => void;
  alertsLoading: boolean;
  alertsError: string | null;
  onRetryAlerts: () => void;
}

const KpiSkeleton: React.FC = () => (
  <div className="kpi-card glass-panel interactive-card" style={{ opacity: 0.5 }}>
    <div style={{ height: '12px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', marginBottom: '8px', width: '60%' }} />
    <div style={{ height: '24px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', width: '80%' }} />
  </div>
);

const AlertSkeleton: React.FC<{ index: number }> = ({ index }) => (
  <div
    className="alert-list-item interactive-card"
    style={{ opacity: 0.4 - index * 0.05, animation: 'pulse 1.8s infinite', animationDelay: `${index * 0.15}s` }}
  >
    <div style={{ width: '40px', height: '24px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }} />
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ height: '12px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', width: '55%' }} />
      <div style={{ height: '10px', background: 'rgba(255,255,255,0.07)', borderRadius: '4px', width: '35%' }} />
    </div>
    <div style={{ width: '96px', height: '28px', background: 'rgba(255,255,255,0.07)', borderRadius: '6px' }} />
  </div>
);

const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);

const CommandCenter: React.FC<CommandCenterProps> = ({
  alerts,
  viewInvestigation,
  alertsLoading,
  alertsError,
  onRetryAlerts,
}) => {
  const { metrics, loading: metricsLoading, error: metricsError, retry: retryMetrics } = useSystemMetrics(30000);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';

  return (
    <div className="dashboard-home fadeIn">
      <div className="header">
        <h1>{greeting}, Analyst</h1>
        <p className="subtitle">
          {metricsError
            ? <span style={{ color: '#f87171' }}>⚠ {metricsError}{' '}
                <button onClick={retryMetrics} style={{ color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
              </span>
            : 'System metrics and active investigations are operating nominally.'}
        </p>
      </div>

      <div className="visualization glass-panel">
        <div className="node-circle glowing-orb">
          {metricsLoading
            ? <span className="node-label" style={{ fontSize: '14px' }}>Loading…</span>
            : <>
                <span className="node-count text-gradient-primary">
                  {metrics ? fmt(metrics.alertsScanned) : '—'}
                </span>
                <span className="node-label">ALERTS SCANNED</span>
              </>
          }
        </div>
      </div>

      <div className="kpi-container">
        {metricsLoading ? (
          <><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></>
        ) : (
          <>
            <div className="kpi-card glass-panel interactive-card hover-lift">
              <div className="kpi-label">Events Ingestion</div>
              <div className="kpi-value text-gradient-info">
                {metrics ? metrics.eventsIngestGB24h : '—'} <span className="kpi-unit">GB/24H</span>
              </div>
            </div>
            <div className="kpi-card glass-panel interactive-card hover-lift">
              <div className="kpi-label">Data Ingestion</div>
              <div className="kpi-value text-gradient-info">
                {metrics ? metrics.dataIngestTB24h : '—'} <span className="kpi-unit">TB/24H</span>
              </div>
            </div>
            <div className="kpi-card glass-panel interactive-card hover-lift">
              <div className="kpi-label">Total Open Incidents</div>
              <div className="kpi-value text-gradient-danger">
                {metrics ? fmt(metrics.openIncidents) : '—'}
              </div>
            </div>
            <div className="kpi-card glass-panel interactive-card hover-lift">
              <div className="kpi-label">Prevented Events</div>
              <div className="kpi-value text-gradient-success">
                {metrics ? fmt(metrics.preventedEvents) : '—'}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="alerts-section glass-panel">
        <h3 className="section-title">
          Active High-Priority Alerts <span className="pulse-dot" />
        </h3>

        {alertsError && (
          <div
            role="alert"
            style={{
              display: 'flex', alignItems: 'center', gap: '1rem',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', padding: '1rem', marginBottom: '1rem',
              fontFamily: 'monospace', fontSize: '13px',
            }}
          >
            <span style={{ fontSize: '1.25rem' }}>⚠</span>
            <span style={{ color: '#f87171', flex: 1 }}>{alertsError}</span>
            <button
              onClick={onRetryAlerts}
              style={{
                background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                color: '#f87171', borderRadius: '6px', padding: '6px 14px',
                cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', fontWeight: 700,
              }}
            >
              ↻ Retry
            </button>
          </div>
        )}

        <div className="alert-grid">
          {alertsLoading && (
            <>{[0, 1, 2].map(i => <AlertSkeleton key={i} index={i} />)}</>
          )}

          {!alertsLoading && !alertsError && alerts.length === 0 && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '2rem', fontFamily: 'monospace' }}>
              No active alerts — system is quiet.
            </div>
          )}

          {!alertsLoading && alerts.map((alert, index) => (
            <div
              key={alert.id}
              className="alert-list-item interactive-card slideInRight"
              style={{ animationDelay: `${index * 0.1}s` }}
              onClick={() => viewInvestigation(alert)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') viewInvestigation(alert); }}
              aria-label={`Investigate alert: ${alert.type}, severity ${alert.severity}`}
            >
              <div className={`severity-indicator severity-${alert.severity}`}>S{alert.severity}</div>
              <div className="alert-details">
                <span className="alert-type">{alert.type.replace(/_/g, ' ')}</span>
                <span className="alert-id">{alert.id}</span>
              </div>
              <button className="investigate-btn premium-btn-small hover-lift">Investigate</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CommandCenter;
