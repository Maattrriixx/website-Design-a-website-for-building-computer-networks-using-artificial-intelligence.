import styles from './StatusBar.module.css';

export default function StatusBar({ status, deviceCount, roomCount, connCount }) {
  const getDotClass = () => {
    if (status.type === 'err') return styles.err;
    if (status.type === 'proc') return styles.proc;
    return '';
  };

  return (
    <div className={styles.statusBar}>
      <div className={styles.msg}>
        <div className={`${styles.dot} ${getDotClass()}`}></div>
        <span>{status.msg}</span>
      </div>
      <div className={styles.counters}>
        <span className={styles.count}><span>{deviceCount}</span> devices</span>
        <div className={styles.divider}></div>
        <span className={styles.count}><span>{roomCount}</span> rooms</span>
        <div className={styles.divider}></div>
        <span className={styles.count}>{connCount} connections</span>
      </div>
    </div>
  );
}