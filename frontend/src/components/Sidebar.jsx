import { useEffect, useRef, useState } from 'react';
import styles from './Sidebar.module.css';
import { getAllIconUrls, loadIcons } from '../utils/iconLoader';

const DEVICE_COLORS = {
  nvr:         '#22c55e',
  endpoint:    '#34e79d',
  camera:      '#f59e0b',
  switch:      '#ff6b35',
  router:      '#00c8f8',
  firewall:    '#ef4444',
  server:      '#10b981',
  ups:         '#a78bfa',
  core_switch: '#fb923c',
  proxy:       '#eab308',
  modem:       '#06b6d4',
  dns:         '#818cf8',
  dhcp:        '#f472b6',
};

export default function Sidebar({ 
  onUpload, 
  onAnalyze, 
  onGenerate, 
  onReset, 
  phase, 
  projectName,
  projectType,
  measureOfDraw,
  projectTypeOptions,
  measureOptions,
  onProjectNameChange,
  onProjectTypeChange,
  onMeasureOfDrawChange,
  selectedDevice,
  rooms,
  floorPlan,
  onDeleteDevice,
  vlanNames,
}) {
  const fileInputRef = useRef(null);
  const [iconsLoaded, setIconsLoaded] = useState(false);
  const [iconUrls, setIconUrls] = useState({});

  const handleFileChange = (e) => {
    if (e.target.files[0]) onUpload(e.target.files[0]);
  };

  useEffect(() => {
    loadIcons().then(() => {
      const urls = getAllIconUrls();
      setIconUrls(urls);
      setIconsLoaded(true);
    }).catch(() => {});
  }, []);

  const handleDragStart = (e, type) => {
    e.dataTransfer.setData('netarch/type', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.section}>
        <div className={styles.sectionLabel}>FLOOR PLAN</div>
        <div className={styles.uploadZone} onClick={() => fileInputRef.current.click()}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect x="4" y="4" width="24" height="24" rx="3" stroke="#2a3f63" strokeWidth="1.5" strokeDasharray="4 3"/>
            <path d="M16 20V12M12 16l4-4 4 4" stroke="#00c8f8" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <div className={styles.uploadText}>Drop floor plan<br /><span>or click to upload</span></div>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" hidden />
        </div>
        {floorPlan && (
          <div className={styles.fileChip}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2h6l2 2v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2Z" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8 1v3H5" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            <span className={styles.fileName}>floor_plan.png</span>
          </div>
        )}
      </div>

      {floorPlan && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>PROJECT</div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>NAME</div>
            <input
              className={styles.input}
              value={projectName}
              onChange={(e) => onProjectNameChange?.(e.target.value)}
              placeholder="Project name"
            />
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>TYPE</div>
            <select
              className={styles.select}
              value={projectType || ''}
              onChange={(e) => onProjectTypeChange?.(e.target.value)}
            >
              <option value="" disabled>Select type</option>
              {(Array.isArray(projectTypeOptions) ? projectTypeOptions : ['university', 'bank', 'residential', 'commercial']).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>SCALE</div>
            <select
              className={styles.select}
              value={measureOfDraw || ''}
              onChange={(e) => onMeasureOfDrawChange?.(e.target.value)}
            >
              <option value="" disabled>Select scale</option>
              {(Array.isArray(measureOptions) ? measureOptions : ['1/50', '1/100', '1/200']).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionLabel}>ACTIONS</div>
        <button className={styles.sbBtn} onClick={onAnalyze} disabled={phase === 'empty' || !projectName?.trim() || !projectType || !measureOfDraw}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7 5v2l1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Analyze Rooms
        </button>
        <button className={`${styles.sbBtn} ${styles.orange}`} onClick={onGenerate} disabled={phase !== 'analyzed' && phase !== 'network'}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7h3l2-3 2 6 2-3h1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Generate Network
        </button>
        <button className={`${styles.sbBtn} ${styles.ghost}`} onClick={onReset}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7a5 5 0 0 1 9.9-1M12 7a5 5 0 0 1-9.9 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M12 3v3h-3M2 11V8h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Reset
        </button>
      </div>

      {selectedDevice && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>DEVICE INFO</div>
          <div className={styles.infoCard}>
            <div className={styles.infoHeader}>
              <div className={styles.infoIcon} style={{ borderColor: DEVICE_COLORS[selectedDevice.type] }}>
                {selectedDevice.type[0].toUpperCase()}
              </div>
              <div className={styles.infoTitle}>
                <div className={styles.infoName}>{selectedDevice.type}</div>
              </div>
            </div>
            <div className={styles.infoGrid}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Location:</span>
                <span className={styles.infoValue}>
                  {selectedDevice.room
                    ? (rooms.find(r => r.id === selectedDevice.room)?.name || 'Room')
                    : 'Infrastructure'}
                </span>
              </div>
              {selectedDevice.vlan_id != null && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>VLAN:</span>
                  <span className={styles.infoValue}>
                    {selectedDevice.vlan_id}
                    {vlanNames?.[Number(selectedDevice.vlan_id)]
                      ? ` — ${vlanNames[Number(selectedDevice.vlan_id)]}`
                      : ''}
                  </span>
                </div>
              )}
              {selectedDevice.ports != null && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Ports:</span>
                  <span className={styles.infoValue}>{selectedDevice.ports}</span>
                </div>
              )}
            </div>
            {onDeleteDevice && (
              <button className={`${styles.infoBtn} ${styles.deleteBtn}`} onClick={onDeleteDevice}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 3h8M4 3V2h4v1M5 5v4M7 5v4M3 3l1 7h4l1-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Delete Device
              </button>
            )}
          </div>
        </div>
      )}

      {phase !== 'empty' && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>DEVICES <span className={styles.hint}>drag to canvas</span></div>
          <div className={styles.paletteGrid}>
            {[
              'nvr', 'endpoint', 'camera', 'switch', 'router', 'firewall', 'server', 'ups',
              'core_switch', 'proxy', 'modem', 'dns', 'dhcp',
            ].map(type => (
              <div
                key={type}
                className={styles.palItem}
                draggable
                onDragStart={(e) => handleDragStart(e, type)}
              >
                {iconsLoaded && iconUrls[type] ? (
                  <img
                    src={iconUrls[type]}
                    alt={type}
                    className={styles.palIconImg}
                  />
                ) : (
                  <div className={styles.loadingIcon}>Loading...</div>
                )}
                <span>{type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 'network' && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>CONNECTION LEGEND</div>
          <div className={styles.legend}>
            <div className={styles.legendItem}>
              <div className={styles.legendLine} style={{ background: '#34e79d', height: 3 }}></div>
              <span>Backbone</span>
            </div>
            <div className={styles.legendItem}>
              <div className={styles.legendLine} style={{ background: '#ff6b35', height: 2.5 }}></div>
              <span>Uplink</span>
            </div>
            <div className={styles.legendItem}>
              <div className={styles.legendLine} style={{ background: '#00c8f8', height: 2 }}></div>
              <span>Access</span>
            </div>
            <div className={styles.legendItem}>
              <div className={styles.legendLine} style={{ background: '#8b5cf6', height: 1.5, borderStyle: 'dashed' }}></div>
              <span>Wireless</span>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
