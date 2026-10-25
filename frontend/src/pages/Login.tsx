import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icon';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const { login, reset } = useAuth();
  const nav = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setMessage('');
    setBusy(true);

    try {
      await login(email, password, remember);
      nav('/dashboard');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    setErr('');
    setMessage('');
    if (!email.trim()) {
      setErr('Enter your email address first.');
      return;
    }
    setBusy(true);
    try {
      await reset(email.trim());
      setMessage('Password reset email sent. Check your inbox.');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Unable to send reset email.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <section className="story">
        <div className="brand light">
          <span className="brandmark">
            <Icon name="plus" size={22} />
          </span>
          <b>ClinicQueue</b>
        </div>

        <span className="demo">SECURE CLINIC WORKSPACE</span>
        <h1>
          A clearer day,
          <br />
          from arrival to care.
        </h1>
        <p>
          One calm workspace for your front desk, care team and clinic
          operations.
        </p>

        <div className="journey">
          <small>THE CLINICQUEUE JOURNEY</small>
          {[
            ['01', 'Welcome & register', 'A thoughtful first point of contact.'],
            ['02', 'Coordinate the queue', 'Clarity on who is next and where.'],
            ['03', 'Document the care', 'History, consultation and prescription.'],
          ].map((x) => (
            <div className="journey-row" key={x[0]}>
              <span>{x[0]}</span>
              <div>
                <b>{x[1]}</b>
                <small>{x[2]}</small>
              </div>
            </div>
          ))}
        </div>

        <small>
          Purpose-built for small clinics.
          <br />
          Designed for people at every step.
        </small>
      </section>

      <section className="login-panel">
        <div className="login-top">
          Firebase-authenticated access
        </div>

        <form onSubmit={submit} className="login-form">
          <div>
            <h2>Welcome back</h2>
            <p>
              Sign in to your clinic workspace. Your account determines your
              role and access.
            </p>
          </div>

          <div className="notice">
            <Icon name="bell" size={18} />
            <div>
              <b>Connected authentication</b>
              <br />
              <span>Firebase Authentication is used for real sign-in.</span>
            </div>
          </div>

          {err && <div className="error" role="alert">{err}</div>}
          {message && <div className="success" role="status">{message}</div>}

          <label>
            Email address *
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              placeholder="alex@example.com"
            />
          </label>

          <label>
            Password *
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              placeholder="••••••••"
            />
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Remember me on this device
          </label>

          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'} <span>→</span>
          </button>

          <button
            type="button"
            className="link"
            onClick={sendReset}
            disabled={busy}
          >
            Forgot password?
          </button>

          <div className="access">
            <p>Role-based access (Click to auto-fill credentials):</p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  setEmail('receptionist@gmail.com');
                  setPassword('Receptionist@123');
                }}
                style={{
                  cursor: 'pointer',
                  padding: '7px 12px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  background: '#e0f2fe',
                  color: '#0369a1',
                  border: '1px solid #bae6fd',
                  transition: 'all 0.15s ease'
                }}
                title="Fill Receptionist credentials"
              >
                Receptionist
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail('doctor@gmail.com');
                  setPassword('Doctor@123');
                }}
                style={{
                  cursor: 'pointer',
                  padding: '7px 12px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  background: '#ccfbf1',
                  color: '#0f766e',
                  border: '1px solid #99f6e4',
                  transition: 'all 0.15s ease'
                }}
                title="Fill Doctor credentials"
              >
                Doctor
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail('admin@gmail.com');
                  setPassword('Admin@123');
                }}
                style={{
                  cursor: 'pointer',
                  padding: '7px 12px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  background: '#f3e8ff',
                  color: '#7e22ce',
                  border: '1px solid #e9d5ff',
                  transition: 'all 0.15s ease'
                }}
                title="Fill Admin credentials"
              >
                Admin
              </button>
            </div>
          </div>
        </form>

        <footer>
          ClinicQueue · Connected application
          <br />
          Firebase authentication + C++ API
        </footer>
      </section>
    </div>
  );
}
