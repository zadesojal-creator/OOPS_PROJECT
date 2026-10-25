import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Icon } from './Icon';
import { Modal, Badge } from './Ui';

export function Layout() {
  const { profile, logout } = useAuth();
  const nav = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [healthStatus, setHealthStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [financialsOpen, setFinancialsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          if (mounted) setHealthStatus('online');
        } else {
          if (mounted) setHealthStatus('offline');
        }
      } catch {
        if (mounted) setHealthStatus('offline');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  interface NavItem {
    to: string;
    label: string;
    icon: string;
    isAction: boolean;
    onClick?: () => void;
  }

  const adminNavItems: NavItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: 'grid', isAction: false },
    { to: '/settings', label: 'Staff & Users', icon: 'users', isAction: false },
    { to: '/queue', label: 'Master Queue', icon: 'queue', isAction: false },
    { to: '/appointments', label: 'Appointments', icon: 'calendar', isAction: false },
    { to: '#financials', label: 'Financials', icon: 'credit-card', isAction: true, onClick: () => setFinancialsOpen(true) },
    { to: '#analytics', label: 'Analytics', icon: 'bar-chart', isAction: true, onClick: () => setAnalyticsOpen(true) },
    { to: '/settings', label: 'System Settings', icon: 'settings', isAction: false },
  ];

  const standardNavItems: NavItem[] = profile?.role === 'PATIENT'
    ? [
        { to: '/dashboard', label: 'Patient Portal', icon: 'grid', isAction: false },
        { to: '/appointments', label: 'My Appointments', icon: 'calendar', isAction: false },
      ]
    : [
        { to: '/dashboard', label: 'Dashboard', icon: 'grid', isAction: false },
        { to: '/patients', label: 'Patients', icon: 'users', isAction: false },
        { to: '/queue', label: 'Queue', icon: 'queue', isAction: false },
        { to: '/appointments', label: 'Appointments', icon: 'calendar', isAction: false },
      ];

  const items = profile?.role === 'ADMIN' ? adminNavItems : standardNavItems;

  const roleBadgeClass = {
    ADMIN: 'badge-purple',
    DOCTOR: 'badge-teal',
    RECEPTIONIST: 'badge-info',
    PATIENT: 'badge-success',
  }[profile?.role || 'ADMIN'] || 'badge-neutral';

  return (
    <div className={`app ${mobileMenuOpen ? 'mobile-nav-open' : ''}`}>
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <div className="brand">
          <span
            className="brandmark"
            onClick={() => collapsed && setCollapsed(false)}
            style={{ cursor: collapsed ? 'pointer' : 'default' }}
            title={collapsed ? "Click to expand sidebar" : "ClinicQueue"}
          >
            <Icon name="plus" size={22} />
          </span>
          <div className="brand-text">
            <b>ClinicQueue</b>
            <span className="brand-sub">HEALTHCARE OS</span>
          </div>
          <button
            type="button"
            className="sidebar-collapse-toggle desktop-only"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={14} />
          </button>
        </div>

        {/* Admin Profile Block */}
        <div className="user-profile-badge">
          <div className="user-avatar-sm">
            {(profile?.name || 'A').slice(0, 1).toUpperCase()}
          </div>
          <div className="user-info-sm">
            <span className="user-name-sm">{profile?.name || 'Administrator'}</span>
            <span className={`badge-pill ${roleBadgeClass}`}>
              {profile?.role === 'ADMIN' ? 'ADMIN' : (profile?.role || 'WORKSPACE')}
            </span>
          </div>
        </div>

        <nav>
          {items.map((item, idx) => {
            if (item.isAction) {
              return (
                <button
                  key={`${item.label}-${idx}`}
                  type="button"
                  title={item.label}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    if (item.onClick) item.onClick();
                  }}
                  className="nav nav-action-btn"
                  style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              );
            }
            return (
              <NavLink
                key={`${item.to}-${item.label}-${idx}`}
                to={item.to}
                title={item.label}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) => (isActive ? 'nav active' : 'nav')}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <button
            className="logout"
            title="Sign out"
            onClick={async () => {
              await logout();
              nav('/login');
            }}
          >
            <Icon name="logout" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="btn-icon mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle navigation menu"
            >
              <Icon name="menu" size={20} />
            </button>
            <div>
              {profile?.role === 'ADMIN' ? (
                <div className="topbar-breadcrumbs" aria-label="Breadcrumb">
                  <span className="breadcrumb-root">System</span>
                  <span className="breadcrumb-separator">&gt;</span>
                  <span className="breadcrumb-current">{profile?.name || 'Administrator'}</span>
                </div>
              ) : (
                <>
                  <div className="eyebrow">CLINICQUEUE ENTERPRISE</div>
                  <div className="top-title">{profile?.name || 'Clinic Team'}</div>
                </>
              )}
            </div>
          </div>

          <div className="top-actions">
            <div className={`live-status-pill status-${healthStatus}`}>
              <span className={`status-dot-pulse ${healthStatus}`} />
              <span>
                {healthStatus === 'online'
                  ? 'Live Engine Connected'
                  : healthStatus === 'offline'
                  ? 'Reconnecting...'
                  : 'Checking Engine...'}
              </span>
            </div>
            <div className="avatar" title={profile?.email || ''}>
              {(profile?.name || 'A').slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>

        <section className="content">
          <Outlet />
        </section>
      </main>

      {/* Financials Enterprise Modal */}
      <Modal
        isOpen={financialsOpen}
        onClose={() => setFinancialsOpen(false)}
        title="Healthcare OS — Financials & Revenue"
        maxWidth="680px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <p style={{ margin: 0, color: 'var(--slate-600)', fontSize: '13.5px' }}>
            Comprehensive billing summary, daily consultation collections, and physician revenue distribution.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
            <div style={{ background: 'var(--teal-50)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--teal-200)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--teal-800)', textTransform: 'uppercase' }}>Today's Revenue</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--teal-900)', marginTop: '4px' }}>$2,840.00</div>
              <div style={{ fontSize: '11px', color: 'var(--teal-700)', marginTop: '2px' }}>24 consultations billed</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--slate-500)', textTransform: 'uppercase' }}>Pending Claims</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--slate-800)', marginTop: '4px' }}>$350.00</div>
              <div style={{ fontSize: '11px', color: 'var(--slate-500)', marginTop: '2px' }}>3 insurance claims</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--slate-500)', textTransform: 'uppercase' }}>Avg Ticket</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--slate-800)', marginTop: '4px' }}>$118.30</div>
              <div style={{ fontSize: '11px', color: 'var(--slate-500)', marginTop: '2px' }}>Per patient visit</div>
            </div>
          </div>

          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px', background: '#ffffff' }}>
            <div style={{ fontWeight: 700, fontSize: '13.5px', marginBottom: '10px', color: 'var(--slate-900)' }}>Departmental Collections</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--slate-100)', paddingBottom: '6px' }}>
                <span>Cardiology & Vascular Care</span>
                <b>$1,250.00 (10 visits)</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--slate-100)', paddingBottom: '6px' }}>
                <span>General Medicine & Triage</span>
                <b>$940.00 (18 visits)</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Pediatrics & Preventive Care</span>
                <b>$650.00 (8 visits)</b>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button className="btn outline" onClick={() => setFinancialsOpen(false)}>Close</button>
            <button className="btn teal" onClick={() => setFinancialsOpen(false)}>Export Ledger (CSV)</button>
          </div>
        </div>
      </Modal>

      {/* Analytics Enterprise Modal */}
      <Modal
        isOpen={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        title="Healthcare OS — Operational Analytics"
        maxWidth="680px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <p style={{ margin: 0, color: 'var(--slate-600)', fontSize: '13.5px' }}>
            Live clinical intelligence, queue velocity benchmarks, and physician resource utilization.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--slate-500)', textTransform: 'uppercase' }}>Avg Wait Time</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--emerald-600)', marginTop: '4px' }}>12.4 min</div>
              <div style={{ fontSize: '11px', color: 'var(--slate-500)', marginTop: '2px' }}>Target: &lt; 15 min</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--slate-500)', textTransform: 'uppercase' }}>Throughput</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--teal-700)', marginTop: '4px' }}>5.2 / hr</div>
              <div style={{ fontSize: '11px', color: 'var(--slate-500)', marginTop: '2px' }}>Consultations finished</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--slate-500)', textTransform: 'uppercase' }}>Physician Utilization</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--slate-800)', marginTop: '4px' }}>88.5%</div>
              <div style={{ fontSize: '11px', color: 'var(--slate-500)', marginTop: '2px' }}>Active consultation ratio</div>
            </div>
          </div>

          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px', background: '#ffffff' }}>
            <div style={{ fontWeight: 700, fontSize: '13.5px', marginBottom: '8px', color: 'var(--slate-900)' }}>Triage Priority Mix</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Badge tone="emergency">Emergency: 6%</Badge>
              <Badge tone="warning">Senior Priority: 24%</Badge>
              <Badge tone="normal">Normal FIFO: 70%</Badge>
            </div>
            <p style={{ margin: '10px 0 0 0', color: 'var(--slate-500)', fontSize: '12.5px' }}>
              Peak patient influx observed between 10:00 AM and 12:30 PM. Scheduling and intake algorithms are functioning normally.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button className="btn outline" onClick={() => setAnalyticsOpen(false)}>Close</button>
            <button className="btn teal" onClick={() => setAnalyticsOpen(false)}>Download Full Report (PDF)</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
