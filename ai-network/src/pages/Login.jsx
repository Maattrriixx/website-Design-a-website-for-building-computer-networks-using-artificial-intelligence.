import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import styles from './Login.module.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const verificationStatus = searchParams.get('verification');
    if (verificationStatus === 'success') {
      setSuccessMessage('Email verified successfully! You can now log in.');
    } else if (verificationStatus === 'already') {
      setSuccessMessage('Email was already verified. Please log in.');
    } else if (verificationStatus === 'failed') {
      setError('Verification failed. The link may be invalid or expired.');
    }
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/designer');
    } catch (err) {
      setError(err.message);
      // Check if it's a verification error
      if (err.message.includes('verify') || err.message.includes('Verify')) {
        navigate('/verification-pending', { state: { email } });
      }
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
          <h2>Sign In</h2>
          <p>Access your intelligent network designer</p>
        </div>
        <form onSubmit={handleSubmit}>
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
              placeholder="Password"
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
          {successMessage && (
            <div className={styles.success}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>{successMessage}</span>
            </div>
          )}
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
                Signing in...
              </>
            ) : (
              'Sign In →'
            )}
          </button>
        </form>
        <div className={styles.forgotPassword}>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <div className={styles.footer}>
          <span>Don't have an account?</span>
          <Link to="/register">Create account →</Link>
        </div>
      </div>
    </div>
  );
}