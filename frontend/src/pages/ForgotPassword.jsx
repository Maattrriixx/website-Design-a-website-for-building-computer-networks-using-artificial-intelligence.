import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as API from '../services/api';
import styles from './ForgotPassword.module.css';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const response = await API.AuthAPI.forgotPassword(email);
      setSuccess(true);
      setMessage('Password reset link has been sent to your email address.');
    } catch (err) {
      setError(err.message || 'Failed to send reset link. Please try again.');
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
          <h2>Forgot Password</h2>
          <p>Enter your email address to receive a password reset link</p>
        </div>

        {!success ? (
          <form onSubmit={handleSubmit}>
            <div className={styles.field}>
              <svg className={styles.fieldIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="4" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M2 6l6 3 6-3" stroke="currentColor" strokeWidth="1.3"/>
              </svg>
              <input
                type="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
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
                  Sending...
                </>
              ) : (
                'Send Reset Link →'
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
            <p className={styles.successMessage}>{message}</p>
            <p className={styles.subText}>Please check your email and click the reset link to set a new password.</p>
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
