import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import styles from './Register.module.css';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();

  const getPasswordStrength = (pwd) => {
    let score = 0;
    if (pwd.length >= 6) score++;
    if (pwd.length >= 10) score++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[^a-zA-Z0-9]/.test(pwd)) score++;
    if (score <= 1) return { level: 0, label: 'Weak', color: '#ef4444' };
    if (score === 2) return { level: 1, label: 'Fair', color: '#f59e0b' };
    if (score === 3) return { level: 2, label: 'Good', color: '#3b82f6' };
    return { level: 3, label: 'Strong', color: '#10b981' };
  };

  const strength = getPasswordStrength(password);
  const passwordsMatch = confirm === password && confirm.length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    // Frontend validation
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!email.toLowerCase().endsWith('@gmail.com')) {
      setError('Please use a Gmail address (@gmail.com)');
      return;
    }
    
    setLoading(true);
    try {
      const result = await register(name, email, password);
      // Laravel returns message instead of auto-login
      if (result.message) {
        // Redirect to verification pending page
        navigate('/verification-pending', { state: { email } });
      } else {
        navigate('/designer');
      }
    } catch (err) {
      // Error message comes from api.js (extracted from Laravel validation)
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.logo}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke="#00c8f8" strokeWidth="1.5" fill="none"/>
              <circle cx="12" cy="12" r="3" fill="#00c8f8" opacity="0.8"/>
            </svg>
            <span>NetArch<span className={styles.logoAccent}>AI</span></span>
          </div>
          <h2>Create Account</h2>
          <p>Join NetArch AI and start designing your network</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <svg className={styles.fieldIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            <input
              type="text"
              placeholder="Full Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <svg className={styles.fieldIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="4" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M2 6l6 3 6-3" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <svg className={styles.fieldIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password (min 8)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className={styles.pwdToggle}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4Z" stroke="currentColor" strokeWidth="1.3"/>
                  <circle cx="8" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4Z" stroke="currentColor" strokeWidth="1.3"/>
                  <circle cx="8" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M3 3l10 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          </div>
          {password && (
            <div className={styles.strengthMeter}>
              <div className={styles.strengthBar}>
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className={styles.strengthSegment}
                    style={{
                      background: i <= strength.level ? strength.color : 'var(--border)',
                    }}
                  ></div>
                ))}
              </div>
              <span className={styles.strengthLabel} style={{ color: strength.color }}>
                {strength.label}
              </span>
            </div>
          )}
          <div className={styles.field}>
            <svg className={styles.fieldIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            {confirm && (
              <div className={styles.matchIndicator}>
                {passwordsMatch ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.5" stroke="#10b981" strokeWidth="1.3"/>
                    <path d="M4.5 7l2 2 3-3" stroke="#10b981" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.5" stroke="#ef4444" strokeWidth="1.3"/>
                    <path d="M5 5l4 4M9 5l-4 4" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                )}
                <span style={{ color: passwordsMatch ? '#10b981' : '#ef4444' }}>
                  {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                </span>
              </div>
            )}
          </div>
          {error && (
            <div className={styles.error}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M7 4v3.5M7 9v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <span>{error}</span>
            </div>
          )}
          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? (
              <>
                <svg className={styles.spinner} width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
                  <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Creating account...
              </>
            ) : (
              'Create Account →'
            )}
          </button>
        </form>
        <div className={styles.footer}>
          <span>Already have an account?</span>
          <Link to="/login">Sign in →</Link>
        </div>
      </div>
    </div>
  );
}