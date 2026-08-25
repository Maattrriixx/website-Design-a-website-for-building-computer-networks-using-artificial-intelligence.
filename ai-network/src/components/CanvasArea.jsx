import styles from './CanvasArea.module.css';

export default function CanvasArea({
  canvasRef,
  zoom,
  setZoom,
  canvasW,
  canvasH,
  phase,
  onCanvasMouseDown,
  onCanvasMouseMove,
  onCanvasMouseUp,
  onCanvasDrop,
  onCanvasDblClick,
  hoveredDevice,
  viewportRef,
  // Room drill-down
  roomViewMode,
  onBackToMain,
  selectedRoomName,
  leftOverlay,
  rightOverlay,
  children,
  rooms,
  vlanNames,
}) {
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(prev => Math.min(3, Math.max(0.4, prev * delta)));
  };

  const handleZoomIn  = () => setZoom(prev => Math.min(3, prev + 0.1));
  const handleZoomOut = () => setZoom(prev => Math.max(0.4, prev - 0.1));
  const handleFit     = () => setZoom(1);

  return (
    <div className={styles.canvasArea}>
      {/* ── Topbar ── */}
      <div className={styles.topbar}>
        <div className={styles.topbarLeft}>
          {roomViewMode ? (
            <div className={styles.breadcrumb}>
              <button className={styles.backBtn} onClick={onBackToMain}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Floor Plan
              </button>
              <span className={styles.breadcrumbSep}>›</span>
              <span className={styles.breadcrumbCurrent}>
                {selectedRoomName || 'Room View'}
              </span>
            </div>
          ) : (
            <span className={styles.path}>Overview</span>
          )}
        </div>

        <div className={styles.topbarRight}>
          <button className={styles.toolBtn} onClick={handleZoomIn}>+</button>
          <span className={styles.zoomVal}>{Math.round(zoom * 100)}%</span>
          <button className={styles.toolBtn} onClick={handleZoomOut}>−</button>
          <div className={styles.divider}></div>
          <button className={styles.toolBtn} onClick={handleFit}>⊡</button>
        </div>
      </div>

      {/* ── Viewport ── */}
      <div
        className={styles.viewport}
        ref={viewportRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onCanvasDrop}
      >
        <div className={styles.canvasStage}>
          <canvas
            ref={canvasRef}
            width={canvasW}
            height={canvasH}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            onMouseLeave={onCanvasMouseUp}
            onDoubleClick={onCanvasDblClick}
            onWheel={handleWheel}
            style={{
              width:  `${Math.round(canvasW * zoom)}px`,
              height: `${Math.round(canvasH * zoom)}px`,
            }}
          />
        </div>

        {leftOverlay && (
          <div className={styles.leftOverlay}>{leftOverlay}</div>
        )}
        {rightOverlay && (
                  <div className={styles.rightOverlay}>{rightOverlay}</div>
          )}

        {/* Empty state — only shown on the overview */}
        {phase === 'empty' && !roomViewMode && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <rect x="8" y="8" width="48" height="48" rx="4" stroke="rgba(0,200,248,0.2)" strokeWidth="2"/>
                <path d="M24 28l4 4 4-4" stroke="rgba(0,200,248,0.3)" strokeWidth="2" strokeLinecap="round"/>
                <path d="M32 20v16" stroke="rgba(0,200,248,0.3)" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="32" cy="32" r="4" stroke="rgba(0,200,248,0.3)" strokeWidth="1.5"/>
              </svg>
            </div>
            <h3 className={styles.emptyTitle}>No Floor Plan Uploaded</h3>
            <p className={styles.emptyDesc}>Upload a floor plan image to begin AI-powered network design</p>
          </div>
        )}

        {/* Device tooltip */}
        {hoveredDevice && (() => {
          // Convert canvas coords → viewport coords:
          // The canvasStage centers the canvas with padding (20px top, 24px left).
          // We must account for zoom scale and the scroll offset of the viewport.
          const vp = viewportRef?.current;
          const stagePadL = 24;
          const stagePadT = 20;
          const scrollLeft = vp ? vp.scrollLeft : 0;
          const scrollTop  = vp ? vp.scrollTop  : 0;
          const tipX = stagePadL + hoveredDevice.x * zoom - scrollLeft + 14;
          const tipY = stagePadT + hoveredDevice.y * zoom - scrollTop  - 10;
          return (
          <div className={styles.tooltip} style={{ left: tipX, top: tipY }}>
            <div className={styles.tooltipType}>{hoveredDevice.type}</div>
            <div className={styles.tooltipRow}>
              <span className={styles.tooltipLabel}>Location:</span>
              <span className={styles.tooltipValue}>
                {hoveredDevice.room
                  ? (rooms?.find(r => r.id === hoveredDevice.room)?.name || 'Room')
                  : 'Infrastructure'}
              </span>
            </div>
            {hoveredDevice.vlan_id != null && (
              <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>VLAN:</span>
                <span className={styles.tooltipValue}>
                  {hoveredDevice.vlan_id}
                  {vlanNames?.[Number(hoveredDevice.vlan_id)]
                    ? ` — ${vlanNames[Number(hoveredDevice.vlan_id)]}`
                    : ''}
                </span>
              </div>
            )}
            {hoveredDevice.ports != null && (
              <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>Ports:</span>
                <span className={styles.tooltipValue}>{hoveredDevice.ports}</span>
              </div>
            )}
          </div>
          );
        })()}

      </div>

      {/* Bottom slot (room-types panel etc.) — hidden in room-view mode */}
      {children && !roomViewMode && (
        <div className={styles.bottomSlot}>{children}</div>
      )}
    </div>
  );
}
