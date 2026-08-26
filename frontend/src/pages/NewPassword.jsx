import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import * as API from '../services/api';
import styles from './NewPassword.module.css';

export default function NewPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const token = searchParams.get('token');
  const email = searchParams.get('email');

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
  const passwordsMatch = confirmPassword === password && confirmPassword.length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token || !email) {
      setError('Invalid reset link. Please request a new password reset.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      await API.AuthAPI.resetPassword(token, email, password);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.message || 'Failed to reset password. Please try again.');
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
          <h2>Set New Password</h2>
          <p>Enter your new password</p>
        </div>

        {!success ? (
          <form onSubmit={handleSubmit}>
            <div className={styles.field}>
              <svg className={styles.fieldIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.3"/>
              </svg>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="New Password (min 8 characters)"
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
                placeholder="Confirm New Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              {confirmPassword && (
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
                  Resetting Password...
                </>
              ) : (
                'Reset Password →'
              )}
            </button>
          </form>
        ) : (
          <div className={styles.successContainer}>
            <div className={styles.successIcon}>
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="28" fill="rgba(16, 185, 129, 0.1)" stroke="#10b981" strokeWidth="2"/>
                <path d="M20 32l8 8 16-16" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className={styles.successMessage}>Password has been reset successfully!</p>
            <p className={styles.subText}>Redirecting to login page...</p>
          </div>
        )}

        <div className={styles.footer}>
          <span>Remember your password?</span>
          <Link to="/login">Sign in →</Link>
        </div>
      </div>
    </div>
  );
}
