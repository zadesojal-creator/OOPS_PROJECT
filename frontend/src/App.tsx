import { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Patients from './pages/Patients';
import Queue from './pages/Queue';
import ConsultationPage from './pages/Consultation';
import Settings from './pages/Settings';
import Appointments from './pages/Appointments';

function Authenticated() {
  const { user, profile, loading, authError, reloadProfile, logout } = useAuth();

  if (loading) return <div className="loading">Loading workspace…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) {
    return (
      <div className="access-error">
        <h1>Workspace access unavailable</h1>
        <p role="alert">{authError || 'Your account has no clinic role.'}</p>
        <div className="actions">
          <button
            className="btn secondary"
            onClick={() => void reloadProfile().catch(() => undefined)}
          >
            Retry
          </button>
          <button className="btn primary" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }
  return <Layout />;
}

function RoleRequired({
  roles,
  children,
}: {
  roles: UserRole[];
  children: ReactNode;
}) {
  const { profile } = useAuth();
  if (!profile || !roles.includes(profile.role)) {
    return <div className="empty">Your role cannot access this area.</div>;
  }
  return children;
}

type UserRole = 'ADMIN' | 'DOCTOR' | 'RECEPTIONIST' | 'PATIENT';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Authenticated />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route
          path="/patients"
          element={
            <RoleRequired roles={['ADMIN', 'DOCTOR', 'RECEPTIONIST']}>
              <Patients />
            </RoleRequired>
          }
        />
        <Route
          path="/queue"
          element={
            <RoleRequired roles={['ADMIN', 'DOCTOR', 'RECEPTIONIST']}>
              <Queue />
            </RoleRequired>
          }
        />
        <Route
          path="/consultations/:queueId"
          element={
            <RoleRequired roles={['DOCTOR']}>
              <ConsultationPage />
            </RoleRequired>
          }
        />
        <Route
          path="/appointments"
          element={
            <RoleRequired roles={['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT']}>
              <Appointments />
            </RoleRequired>
          }
        />
        <Route
          path="/settings"
          element={
            <RoleRequired roles={['ADMIN']}>
              <Settings />
            </RoleRequired>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
