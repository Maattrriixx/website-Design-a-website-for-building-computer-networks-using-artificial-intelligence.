import styles from './LoadingOverlay.module.css';

export default function LoadingOverlay({ title, sub }) {
  return (
    <div className={styles.overlay}>
      <div className={styles.box}>
        <div className={styles.ring}>
          <div className={styles.inner}></div>
        </div>
        <div className={styles.title}>{title}</div>
        <div className={styles.sub}>{sub}</div>
        <div className={styles.progress}>
          <div className={styles.bar}></div>
        </div>
      </div>
    </div>
  );
}