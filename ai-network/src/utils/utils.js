// Helper functions
export function uid() { return Math.random().toString(36).slice(2, 10); }
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
export function validateImage(file) {
  const valid = ['image/jpeg','image/jpg','image/png','image/gif','image/webp'];
  if (!valid.includes(file.type)) return { valid: false, error: 'Invalid file type' };
  if (file.size > 15 * 1024 * 1024) return { valid: false, error: 'File too large (max 15MB)' };
  return { valid: true };
}

// Session management (sessionStorage only for token & user session)
export function getCurrentUser() {
  try { return JSON.parse(sessionStorage.getItem('netarch_user') || 'null'); }
  catch { return null; }
}
export function setSession(user) {
  const s = { id: user.id, name: user.name, email: user.email, accent: user.accent || '#00c8f8', loggedIn: true };
  sessionStorage.setItem('netarch_user', JSON.stringify(s));
  return s;
}
export function clearSession() { sessionStorage.removeItem('netarch_user'); }

// Project queue for opening from settings
export function queueOpenProject(projectId) {
  sessionStorage.setItem('netarch_open_project', projectId);
}
export function popQueuedProject() {
  const id = sessionStorage.getItem('netarch_open_project');
  sessionStorage.removeItem('netarch_open_project');
  return id || null;
}
// Designer state persistence — saves everything needed to restore the canvas
// The floorPlan Image object is serialized as its dataURL and rebuilt on load.
const DESIGNER_STATE_KEY = 'netarch_designer_state';

export function saveDesignerState(state) {
  try {
    // state.floorPlanDataUrl must be provided by the caller (canvas.toDataURL or img.src)
    const serializable = {
      phase:            state.phase,
      projectName:      state.projectName,
      projectType:      state.projectType,
      measureOfDraw:    state.measureOfDraw,
      canvasW:          state.canvasW,
      canvasH:          state.canvasH,
      rooms:            state.rooms,
      devices:          state.devices,
      connections:      state.connections,
      currentProjectId: state.currentProjectId,
      viewMode:         state.viewMode,
      floorPlanDataUrl: state.floorPlanDataUrl || null,
    };
    sessionStorage.setItem(DESIGNER_STATE_KEY, JSON.stringify(serializable));
  } catch (e) {
    console.warn('saveDesignerState failed:', e);
  }
}

export function loadDesignerState() {
  try {
    const raw = sessionStorage.getItem(DESIGNER_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearDesignerState() {
  sessionStorage.removeItem(DESIGNER_STATE_KEY);
}

export function _autoProjectName() {
  const d = new Date();
  return `Network ${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}