import { useLocation } from 'react-router-dom';
import styles from './VerificationPending.module.css';

export default function VerificationPending() {
  const location = useLocation();
  const email = location.state?.email || 'your email';

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.iconWrap}>
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="8" y="16" width="48" height="32" rx="4" stroke="#00c8f8" strokeWidth="2"/>
            <path d="M8 20l24 16 24-16" stroke="#00c8f8" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="52" cy="12" r="8" fill="#10b981"/>
            <path d="M49 12l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <h2 className={styles.title}>Verification Email Sent</h2>
        
        <p className={styles.message}>
          A verification email has been sent to <strong>{email}</strong>. Please click the verification link in the email to continue.
        </p>
      </div>
    </div>
  );
}
