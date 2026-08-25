import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { loadIcons, getIconImage } from '../utils/iconLoader';
import * as Utils from '../utils/utils';
import { saveDesignerState, loadDesignerState, clearDesignerState } from '../utils/utils';
import Sidebar from '../components/Sidebar';
import CanvasArea from '../components/CanvasArea';
import StatusBar from '../components/StatusBar';
import LoadingOverlay from '../components/LoadingOverlay';
import styles from './Designer.module.css';
import { ProjectsAPI, RoomsAPI, DevicesAPI, API_CONFIG } from '../services/api';

// Device colors mapping
const DEVICE_COLORS = {
  nvr:      '#22c55e',
  endpoint: '#34e79d',
  camera:   '#f59e0b',
  switch:   '#ff6b35',
  router:   '#00c8f8',
  firewall: '#ef4444',
  server:   '#10b981',
  ups:      '#a78bfa',
};
const DEVICE_SCALE_BY_TYPE = {
  nvr:      0.90,
  endpoint: 0.92,
  camera:   0.95,
  switch:   1.05,
  router:   1.08,
  firewall: 1.10,
  server:   1.12,
  ups:      1.08,
};

const ROOM_COLORS = ['#00c8f8', '#34e79d', '#ff6b35', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#22c55e', '#38bdf8', '#a78bfa'];
const DEVICE_BOUNDARY_PADDING = 22;

// VLAN color palette — one color per VLAN ID
const VLAN_COLORS = {
  10: '#00c8f8', // Management   → cyan
  20: '#f59e0b', // Surveillance → amber
  30: '#10b981', // Academic     → green
  40: '#8b5cf6', // Admin        → purple
  50: '#ff6b35', // Faculty      → orange
  60: '#ec4899', // Common       → pink
};
const _vlanColor = (vlanId) => {
  if (vlanId == null) return '#4a5568';
  return VLAN_COLORS[Number(vlanId)] || `hsl(${(Number(vlanId) * 47) % 360},70%,55%)`;
};
const DEFAULT_ROOM_TYPES = [
  'laboratories',
  'classroom',
  'administrative office',
  'secretary',
  'server room',
  'café',
  'lobby',
  'security',
  'dr.office',
  'library',
  'meeting room',
  'wc',
  'other',
];

export default function Designer() {
  const { user, logout } = useAuth();
  const [phase, setPhase] = useState('empty');
  const [floorPlan, setFloorPlan] = useState(null);
  const [floorPlanFile, setFloorPlanFile] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [projectType, setProjectType] = useState('');
  const [measureOfDraw, setMeasureOfDraw] = useState('1/100');
  const [projectTypeOptions, setProjectTypeOptions] = useState(['university', 'bank', 'residential', 'commercial']);
  const [measureOptions, setMeasureOptions] = useState(['1/50', '1/100', '1/200']);
  const [roomTypes, setRoomTypes] = useState(DEFAULT_ROOM_TYPES);
  const [typeUpdatingRoomId, setTypeUpdatingRoomId] = useState(null);
  const [originalWidth, setOriginalWidth] = useState(0);
  const [originalHeight, setOriginalHeight] = useState(0);
  const [canvasW, setCanvasW] = useState(800);
  const [canvasH, setCanvasH] = useState(600);
  const [rooms, setRooms] = useState([]);
  const [devices, setDevices] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [roomViewMode, setRoomViewMode] = useState(false);
  const [hoveredDevice, setHoveredDevice] = useState(null);
  // Set of device IDs expanded in room view (quantity > 1 → show individual copies)
  const [expandedDeviceIds, setExpandedDeviceIds] = useState(new Set());
  // Stores pre-computed positions for expanded copies: Map<deviceId, [{x,y}, ...]>
  const [expandedDeviceCopies, setExpandedDeviceCopies] = useState(new Map());
  const [zoom, setZoom] = useState(1);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [status, setStatus] = useState({ msg: 'Upload a floor plan to begin', type: 'ok' });
  const [aiStatus, setAiStatus] = useState({ label: 'AI Ready', processing: false });
  const [loading, setLoading] = useState({ show: false, title: '', sub: '' });
  const [saveBtnSaved, setSaveBtnSaved] = useState(false);
  // 'network' | 'vlan'
  const [viewMode, setViewMode] = useState('network');

  const mainCanvasRef = useRef(null);
  const viewportRef = useRef(null);
  const dragRef = useRef({ active: false, deviceId: null, ox: 0, oy: 0 });
  const rafIdRef = useRef(null);


  const [pendingDevice, setPendingDevice] = useState(null);
// { type, room, point, canvasX, canvasY }

  useEffect(() => {
    let alive = true;
    ProjectsAPI.getProjectSettings().then((data) => {
      if (!alive) return;
      const types = Array.isArray(data?.project_types) ? data.project_types : null;
      const measures = Array.isArray(data?.available_measures) ? data.available_measures : null;
      if (types?.length) {
        setProjectTypeOptions(types);
        setProjectType(prev => types.includes(prev) ? prev : (types[0] || ''));
      }
      if (measures?.length) {
        setMeasureOptions(measures);
        setMeasureOfDraw(prev => measures.includes(prev) ? prev : (measures.includes('1/100') ? '1/100' : (measures[0] || '')));
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // ─── Mount: restore session OR load queued project from Settings ─────────────
  // Priority: queued project (clicked from Settings card) > saved session state.
  // Both keys are consumed immediately so a refresh does not re-trigger either.
  useEffect(() => {
    const queuedId = Utils.popQueuedProject();
    if (queuedId) {
      // User clicked a project card in Settings: discard saved session, load fresh.
      clearDesignerState();
      loadIcons().finally(() => {
        loadProjectFromBackend(Number(queuedId));
      });
      return;
    }

    // No queued project: restore Designer session saved before going to Settings.
    const saved = loadDesignerState();
    if (!saved || saved.phase === 'empty') return;
    clearDesignerState();

    setPhase(saved.phase);
    setProjectName(saved.projectName || '');
    setProjectType(saved.projectType || '');
    setMeasureOfDraw(saved.measureOfDraw || '1/100');
    setCanvasW(saved.canvasW || 800);
    setCanvasH(saved.canvasH || 600);
    setRooms(saved.rooms || []);
    setDevices(saved.devices || []);
    setConnections(saved.connections || []);
    setCurrentProjectId(saved.currentProjectId || null);
    setViewMode(saved.viewMode || 'network');
    setStatus({ msg: 'Restored previous session', type: 'ok' });
    setAiStatus({ label: saved.phase === 'network' ? 'Network ready' : 'Rooms analyzed', processing: false });

    if (saved.floorPlanDataUrl) {
      const img = new Image();
      img.onload = () => setFloorPlan(img);
      img.src = saved.floorPlanDataUrl;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Drawing helpers ────────────────────────────────────────────────────────

  const _roomCorners = (room) => {
    const corners = Array.isArray(room?.corners) ? room.corners : [];
    if (corners.length >= 3) return corners;
    return [
      { x: room.x, y: room.y },
      { x: room.x + room.width, y: room.y },
      { x: room.x + room.width, y: room.y + room.height },
      { x: room.x, y: room.y + room.height },
    ];
  };

  const _pointInPolygon = (px, py, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const _roomAtPoint = (x, y) => {
    for (let i = rooms.length - 1; i >= 0; i--) {
      const r = rooms[i];
      if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) continue;
      const corners = _roomCorners(r);
      if (corners.length >= 3 && !_pointInPolygon(x, y, corners)) continue;
      return r;
    }
    return null;
  };

  const _sameEntityId = (a, b) => a != null && b != null && String(a) === String(b);

  const _roomBounds = (room) => {
    const corners = _roomCorners(room);
    const xs = corners.map(p => p.x);
    const ys = corners.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      corners,
      minX,
      maxX,
      minY,
      maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
  };

  const _distancePointToSegment = (px, py, ax, ay, bx, by) => {
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    if (!lenSq) return Math.hypot(px - ax, py - ay);
    const t = Utils.clamp(((px - ax) * abx + (py - ay) * aby) / lenSq, 0, 1);
    const projX = ax + abx * t;
    const projY = ay + aby * t;
    return Math.hypot(px - projX, py - projY);
  };

  const _distanceToPolygonEdges = (x, y, corners) => {
    if (!Array.isArray(corners) || corners.length < 2) return Infinity;
    let minDistance = Infinity;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      minDistance = Math.min(minDistance, _distancePointToSegment(x, y, a.x, a.y, b.x, b.y));
    }
    return minDistance;
  };

  const _constrainPointToCanvas = useCallback((x, y, padding = DEVICE_BOUNDARY_PADDING) => ({
    x: Utils.clamp(x, padding, Math.max(padding, canvasW - padding)),
    y: Utils.clamp(y, padding, Math.max(padding, canvasH - padding)),
  }), [canvasW, canvasH]);

  const _constrainPointToRoom = useCallback((room, x, y, padding = DEVICE_BOUNDARY_PADDING) => {
    if (!room) return _constrainPointToCanvas(x, y, padding);

    const bounds = _roomBounds(room);
    const clamped = {
      x: Utils.clamp(x, bounds.minX + padding, Math.max(bounds.minX + padding, bounds.maxX - padding)),
      y: Utils.clamp(y, bounds.minY + padding, Math.max(bounds.minY + padding, bounds.maxY - padding)),
    };

    if (_pointInPolygon(clamped.x, clamped.y, bounds.corners) &&
        _distanceToPolygonEdges(clamped.x, clamped.y, bounds.corners) >= Math.max(6, padding * 0.35)) {
      return clamped;
    }

    const center = { x: bounds.centerX, y: bounds.centerY };
    let low = 0;
    let high = 1;
    let best = center;
    for (let i = 0; i < 18; i++) {
      const mid = (low + high) / 2;
      const test = {
        x: center.x + (clamped.x - center.x) * mid,
        y: center.y + (clamped.y - center.y) * mid,
      };
      const inside = _pointInPolygon(test.x, test.y, bounds.corners);
      const farEnough = _distanceToPolygonEdges(test.x, test.y, bounds.corners) >= Math.max(4, padding * 0.2);
      if (inside && farEnough) {
        best = test;
        low = mid;
      } else {
        high = mid;
      }
    }

    return best;
  }, [_constrainPointToCanvas]);

  const _getRoomViewFrame = useCallback((room, viewportWidth, viewportHeight, padding = 40) => {
    const bounds = _roomBounds(room);
    const paddingBox = typeof padding === 'number'
      ? { top: padding, right: padding, bottom: padding, left: padding }
      : {
          top: Number(padding?.top ?? 40),
          right: Number(padding?.right ?? 40),
          bottom: Number(padding?.bottom ?? 40),
          left: Number(padding?.left ?? 40),
        };
    const availW = Math.max(1, viewportWidth - paddingBox.left - paddingBox.right);
    const availH = Math.max(1, viewportHeight - paddingBox.top - paddingBox.bottom);
    const scale = Math.min(availW / bounds.width, availH / bounds.height);
    const drawW = bounds.width * scale;
    const drawH = bounds.height * scale;
    const offsetX = paddingBox.left + (availW - drawW) / 2;
    const offsetY = paddingBox.top + (availH - drawH) / 2;

    return {
      ...bounds,
      padding: paddingBox,
      scale,
      drawW,
      drawH,
      offsetX,
      offsetY,
      transformedCorners: bounds.corners.map(p => ({
        x: offsetX + (p.x - bounds.minX) * scale,
        y: offsetY + (p.y - bounds.minY) * scale,
      })),
    };
  }, []);

  const _getRoomDeviceScale = useCallback((room, frame, deviceCount = 1) => {
    const bounds = _roomBounds(room);
    const minOriginalSide = Math.max(1, Math.min(bounds.width, bounds.height));
    const minRenderedSide = Math.max(1, Math.min(frame.drawW, frame.drawH));
    const roomFactor = minOriginalSide / 140;
    const renderFactor = minRenderedSide / 320;
    const densityFactor = deviceCount > 0 ? (1 / Math.sqrt(Math.max(1, deviceCount / 4))) : 1;
    return Utils.clamp(Math.min(roomFactor, renderFactor) * densityFactor, 0.38, 1.05);
  }, []);

  const _toRoomViewPoint = (x, y, frame) => ({
    x: frame.offsetX + (x - frame.minX) * frame.scale,
    y: frame.offsetY + (y - frame.minY) * frame.scale,
  });

  // Picks a uniformly random point that actually lies inside the room polygon
  // (not just its bounding box), with optional inset from the walls.
  const _randomPointInRoom = useCallback((room, padding = 22) => {
    const bounds = _roomBounds(room);
    const innerMinX = bounds.minX + padding;
    const innerMaxX = bounds.maxX - padding;
    const innerMinY = bounds.minY + padding;
    const innerMaxY = bounds.maxY - padding;
    const minX = innerMaxX > innerMinX ? innerMinX : bounds.minX + 4;
    const maxX = innerMaxX > innerMinX ? innerMaxX : bounds.maxX - 4;
    const minY = innerMaxY > innerMinY ? innerMinY : bounds.minY + 4;
    const maxY = innerMaxY > innerMinY ? innerMaxY : bounds.maxY - 4;

    for (let attempt = 0; attempt < 40; attempt++) {
      const x = minX + Math.random() * Math.max(1, maxX - minX);
      const y = minY + Math.random() * Math.max(1, maxY - minY);
      if (_pointInPolygon(x, y, bounds.corners)) return { x, y };
    }
    // Fallback: room centroid if random sampling kept missing the polygon
    return { x: bounds.centerX, y: bounds.centerY };
  }, []);

  const _separateDevicesInRoom = useCallback((room, items, minGap = 28) => {
    if (!room || !Array.isArray(items) || items.length < 2) return items;

    const bounds = _roomBounds(room);
    const gap = Utils.clamp(minGap, 16, Math.max(18, Math.min(bounds.width, bounds.height) * 0.3));
    const next = items.map(item => ({ ...item, x: Number(item.x || 0), y: Number(item.y || 0) }));

    for (let iteration = 0; iteration < 14; iteration++) {
      let moved = false;

      for (let i = 0; i < next.length; i++) {
        for (let j = i + 1; j < next.length; j++) {
          const a = next[i];
          const b = next[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy) || 0.0001;
          if (distance >= gap) continue;

          const overlap = (gap - distance) / 2;
          const nx = dx / distance;
          const ny = dy / distance;

          const pushedA = _constrainPointToRoom(room, a.x - nx * overlap, a.y - ny * overlap);
          const pushedB = _constrainPointToRoom(room, b.x + nx * overlap, b.y + ny * overlap);

          a.x = pushedA.x;
          a.y = pushedA.y;
          b.x = pushedB.x;
          b.y = pushedB.y;
          moved = true;
        }
      }

      next.forEach((item) => {
        const constrained = _constrainPointToRoom(room, item.x, item.y);
        if (constrained.x !== item.x || constrained.y !== item.y) moved = true;
        item.x = constrained.x;
        item.y = constrained.y;
      });

      if (!moved) break;
    }

    return next;
  }, [_constrainPointToRoom]);

  // Assigns each device in `items` a random, non-overlapping position inside `room`.
  const _randomizeDevicesInRoom = useCallback((room, items, minGap = 30) => {
    if (!room || !Array.isArray(items) || !items.length) return items;
    const padding = DEVICE_BOUNDARY_PADDING;
    const seeded = items.map(item => {
      const point = _randomPointInRoom(room, padding);
      return { ...item, x: point.x, y: point.y };
    });
    return _separateDevicesInRoom(room, seeded, minGap);
  }, [_randomPointInRoom, _separateDevicesInRoom]);

  const _normalizeDeviceType = (type) => {
    const normalized = String(type || '').trim().toLowerCase();
    // If already a valid type, return as-is
    const valid = ['nvr', 'endpoint', 'camera', 'switch', 'router', 'firewall', 'server', 'ups'];
    return valid.includes(normalized) ? normalized : 'endpoint';
  };
  const _deviceTypeToBackend = (type) => {
    const normalized = _normalizeDeviceType(type);
    const ACRONYMS = { nvr: 'NVR', ups: 'UPS' };
    return ACRONYMS[normalized] || (normalized.charAt(0).toUpperCase() + normalized.slice(1));
  };

  const _frontendDeviceId = (device, idx) => {
    // optimizer returns device_id directly — check it first
    const optimizerId = Number(device?.device_id);
    if (Number.isFinite(optimizerId)) return optimizerId;
    // fallback: DB id from Laravel
    const dbId = Number(device?.id);
    if (Number.isFinite(dbId)) return dbId;
    // last resort: device_code suffix
    const codeMatch = /-(\d+)$/.exec(String(device?.device_code || ''));
    const codeId = codeMatch ? Number(codeMatch[1]) : NaN;
    if (Number.isFinite(codeId)) return codeId;
    return `device-${idx + 1}`;
  };

  // Maps optimizer/backend connection types to frontend render types
  const _normalizeConnectionType = (type) => {
    const t = String(type || '').toLowerCase().trim();
    if (t === 'ethernet_trunk' || t === 'uplink') return 'uplink';
    if (t === 'ethernet_redundant' || t === 'backbone') return 'backbone';
    if (t === 'wireless' || t === 'wifi') return 'wireless';
    if (t === 'patch_cord' || t === 'patch') return 'patch';
    return 'ethernet'; // default
  };

  const _sanitizeDeviceLabel = (device, idx) => {
    const label = device?.device_code || device?.label || device?.name;
    if (label && String(label).trim()) return String(label).trim();
    const type = _normalizeDeviceType(device?.type) || 'device';
    return `${type}-${idx + 1}`;
  };

  // Each device from the backend already carries its own `quantity` field.
  // We render every device as a single node; if quantity > 1 the drawDevice
  // function shows a badge automatically via d.count.
  const _computeRenderDevices = useCallback(() => {
    if (!devices.length) return { renderDevices: [], hiddenIds: new Set(), idMap: new Map() };

    const byRoom = new Map();
    const noRoom = [];
    devices.forEach(d => {
      if (d.room != null) {
        const key = String(d.room);
        if (!byRoom.has(key)) byRoom.set(key, []);
        byRoom.get(key).push(d);
      } else {
        noRoom.push(d);
      }
    });

    const renderDevices = [];

    byRoom.forEach((roomDevices, roomKey) => {
      const room = rooms.find(r => _sameEntityId(r.id, roomKey));
      // Pass quantity through as count so drawDevice renders the badge
      const withCount = roomDevices.map(d => ({
        ...d,
        count: (d.quantity && d.quantity > 1) ? d.quantity : undefined,
      }));
      const separated = room ? _separateDevicesInRoom(room, withCount, 26) : withCount;
      separated.forEach(d => renderDevices.push(d));
    });

    noRoom.forEach(d => renderDevices.push({
      ...d,
      count: (d.quantity && d.quantity > 1) ? d.quantity : undefined,
    }));

    return { renderDevices, hiddenIds: new Set(), idMap: new Map() };
  }, [devices, rooms, _separateDevicesInRoom]);

  // Room drill-down: devices with quantity > 1 show as a badge unless expanded.
  // Expanding a badge renders `quantity` individual copies at pre-computed positions.
  const _computeRoomViewScene = useCallback((roomId) => {
    const actualRoomDevices = devices.filter(d => _sameEntityId(d.room, roomId));
    const room = rooms.find(r => _sameEntityId(r.id, roomId));

    if (!actualRoomDevices.length) {
      return { renderDevices: [], idMap: new Map(), hiddenIds: new Set() };
    }

    const toPlace = [];

    actualRoomDevices.forEach(d => {
      const qty = d.quantity && d.quantity > 1 ? d.quantity : 1;
      const isExpanded = expandedDeviceIds.has(d.id);

      if (qty > 1 && !isExpanded) {
        toPlace.push({ ...d, count: qty, isExpandableBadge: true });
      } else if (qty > 1 && isExpanded) {
        // Use pre-computed stable positions
        const positions = expandedDeviceCopies.get(d.id) || [];
        for (let i = 0; i < qty; i++) {
          const pos = positions[i] || { x: d.x, y: d.y };
          toPlace.push({
            ...d,
            id: `${d.id}-copy-${i}`,
            _realId: d.id,
            count: undefined,
            isExpandableBadge: false,
            x: pos.x,
            y: pos.y,
          });
        }
      } else {
        toPlace.push({ ...d, count: undefined });
      }
    });

    const separated = room ? _separateDevicesInRoom(room, toPlace, 22) : toPlace;
    return { renderDevices: separated, idMap: new Map(), hiddenIds: new Set() };
  }, [devices, rooms, expandedDeviceIds, expandedDeviceCopies, _separateDevicesInRoom]);

  // Shared stroke styling for a connection line, used by both the main overview
  // and room drill-down renderers so the switch-on-type logic lives in one place.
  const _applyConnectionStyle = (ctx, type) => {
    switch (type) {
      case 'backbone':
        ctx.strokeStyle = 'rgba(0,200,248,0.85)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([]);
        break;
      case 'uplink':
        ctx.strokeStyle = 'rgba(255,107,53,0.7)';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([8, 5]);
        break;
      case 'wireless':
        ctx.strokeStyle = 'rgba(0,200,248,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        break;
      case 'patch':
        ctx.strokeStyle = 'rgba(180,200,220,0.5)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 3]);
        break;
      default:
        ctx.strokeStyle = 'rgba(90,120,170,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
    }
  };

  // Draws a single connection line between two points using the style for `type`.
  const _drawConnectionLine = (ctx, fromPoint, toPoint, type) => {
    ctx.beginPath();
    ctx.moveTo(fromPoint.x, fromPoint.y);
    ctx.lineTo(toPoint.x, toPoint.y);
    _applyConnectionStyle(ctx, type);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const drawRooms = useCallback((ctx) => {
    rooms.forEach(room => {
      const sel = _sameEntityId(room.id, selectedRoom);
      const col = room.color;
      const corners = _roomCorners(room);
      const xs = corners.map(p => p.x);
      const ys = corners.map(p => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      ctx.fillStyle = Utils.hexToRgba(col, sel ? 0.12 : 0.07);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.setLineDash(sel ? [] : [7, 4]);
      ctx.strokeStyle = col;
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      const labelH = 22;
      ctx.fillStyle = Utils.hexToRgba(col, 0.8);
      ctx.fillRect(minX, minY, maxX - minX, labelH);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(room.name.toUpperCase(), minX + 7, minY + 14);
      if (sel) {
        ctx.fillStyle = col;
        corners.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });
  }, [rooms, selectedRoom]);

  const drawDevice = useCallback((ctx, d, selected = false, scale = 1, options = {}) => {
    const { x, y, type } = d;
    const isVlanMode = options.viewMode === 'vlan';
    const col = isVlanMode ? _vlanColor(d.vlan_id) : (DEVICE_COLORS[type] || '#888');
    const typeScale = DEVICE_SCALE_BY_TYPE[type] ?? 0.85;
    const effectiveScale = Utils.clamp(scale * typeScale, 0.48, 1.45);
    const size = Math.round(13 * effectiveScale);
    const showLabel = Boolean(options.showLabel);
    const isHovered = hoveredDevice?.id === d?.id;

    const iconImg = getIconImage(type);

    if (selected) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
    } else if (isHovered) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
    }

    if (iconImg) {
      const iconSize = size * 2;
      ctx.drawImage(iconImg, x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
    } else {
      ctx.fillStyle = '#0a0e1a';
      ctx.strokeStyle = col;
      ctx.lineWidth = selected ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = `bold ${Math.max(10, Math.round(10 * effectiveScale))}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(type[0].toUpperCase(), x, y);
    }

    // VLAN mode: رسم دائرة رفيعة بلون الـ VLAN حول الجهاز
    if (isVlanMode && d.vlan_id != null) {
      const vlanRingColor = _vlanColor(d.vlan_id);
      const ringRadius = (iconImg ? size * 1.6 : size) + Math.round(5 * effectiveScale);
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = vlanRingColor;
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (d.count && d.count > 1) {
      const badgeR = Math.max(8, Math.round(10 * effectiveScale));
      const bx = x + Math.round(12 * effectiveScale);
      const by = y - Math.round(12 * effectiveScale);
      ctx.fillStyle = '#0b1220';
      ctx.beginPath();
      ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(10, Math.round(10 * effectiveScale))}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(d.count), bx, by);
      ctx.shadowBlur = 0;
      return;
    }

    ctx.shadowBlur = 0;
    if (!showLabel) return;

    const fontSize = Math.max(7, Math.round(8 * effectiveScale));
    const text = d.label.length > 12 ? d.label.slice(0, 12) : d.label;
    ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
    const labelW = Math.max(Math.round(44 * effectiveScale), Math.ceil(ctx.measureText(text).width + 12));
    ctx.fillStyle = 'rgba(5,8,18,0.75)';
    ctx.fillRect(x - labelW / 2, y + size + 3, labelW, fontSize + 4);
    ctx.fillStyle = '#c8d4e8';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y + size + fontSize + 3);
  }, [hoveredDevice]);

  // ─── Room drill-down renderer ────────────────────────────────────────────────
  // Draws the selected room centred on the canvas while preserving its aspect
  // ratio.  Empty space around it becomes padding rather than stretching the room.
  const redrawRoomView = useCallback(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    const room = rooms.find(r => _sameEntityId(r.id, selectedRoom));
    if (!room) return;

       // الخلفية دايماً بيضاء وعلى كامل الكانفا — بدون قص أو تكبير لصورة
    // المخطط داخل شكل الغرفة.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const labelH = 24;
    const frame = _getRoomViewFrame(room, W, H, { top: 72, right: 40, bottom: 40, left: 40 });
    const { transformedCorners: corners } = frame;
      // ── 3. Room border ── (removed — no outline around the room)

    // ── 4. Room name label — fixed at the top of the canvas ──
    const topLabelH = 32;
    ctx.fillStyle = Utils.hexToRgba(room.color, 0.85);
    ctx.fillRect(0, 0, W, topLabelH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(room.name.toUpperCase(), W / 2, topLabelH / 2);

    // ── 5. Connections between visible backend devices only ──
    const { renderDevices } = _computeRoomViewScene(selectedRoom);
    const roomDevices = renderDevices.filter(d => _sameEntityId(d.room, selectedRoom));
    const roomDeviceScale = _getRoomDeviceScale(room, frame, roomDevices.length);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.clip();

    connections.forEach(c => {
      const from = roomDevices.find(d => d.id === c.from);
      const to   = roomDevices.find(d => d.id === c.to);
      if (!from || !to) return;

      const fromPoint = _toRoomViewPoint(from.x, from.y, frame);
      const toPoint = _toRoomViewPoint(to.x, to.y, frame);
      _drawConnectionLine(ctx, fromPoint, toPoint, c.type);
    });

    // ── 6. Devices ──
    roomDevices.forEach(d => {
      const point = _toRoomViewPoint(d.x, d.y, frame);
      drawDevice(ctx, { ...d, x: point.x, y: point.y }, d?.id === selectedDevice?.id, roomDeviceScale, { showLabel: true });
    });
    ctx.restore();

    // ── 7. Empty-room hint ──
    if (roomDevices.length === 0) {
      ctx.fillStyle = 'rgba(107,125,153,0.55)';
      ctx.font = '13px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No devices in this room', W / 2, H / 2);
    }
  }, [
    selectedRoom, rooms, devices, connections,
    floorPlan, canvasW, canvasH,
    drawDevice, selectedDevice, _computeRoomViewScene, _getRoomViewFrame, _getRoomDeviceScale,
  ]);

  // ─── Main redraw dispatcher ──────────────────────────────────────────────────
  const redraw = useCallback(() => {
    if (roomViewMode && selectedRoom) {
      redrawRoomView();
      return;
    }

    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (floorPlan) ctx.drawImage(floorPlan, 0, 0, W, H);
    if (phase === 'analyzed' || phase === 'network') drawRooms(ctx);
    if (phase === 'network' || devices.length) {
      const { renderDevices, idMap } = _computeRenderDevices();
      connections.forEach(c => {
        const fromId = idMap.get(c.from) ?? c.from;
        const toId   = idMap.get(c.to)   ?? c.to;
        const from = renderDevices.find(d => d.id === fromId);
        const to   = renderDevices.find(d => d.id === toId);
        if (!from || !to) return;
        if (viewMode === 'vlan') {
          // Color connection by the VLAN of the source device
          const vlanCol = _vlanColor(from.vlan_id);
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.strokeStyle = vlanCol;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.7;
          ctx.setLineDash([]);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        } else {
          _drawConnectionLine(ctx, from, to, c.type);
        }
      });
      renderDevices.forEach(d => {
        const isSelected = d?.id === selectedDevice?.id;
        const isHovered = d?.id === hoveredDevice?.id;
        drawDevice(ctx, d, isSelected, 1, { showLabel: isSelected || isHovered, viewMode });
      });
    }
  }, [
    floorPlan, phase, devices, connections, drawRooms, drawDevice, selectedDevice,
    roomViewMode, selectedRoom, redrawRoomView, _computeRenderDevices, hoveredDevice, viewMode,
  ]);

  useEffect(() => {
    const canvas = mainCanvasRef.current;
    if (canvas) {
      canvas.width  = canvasW;
      canvas.height = canvasH;
      redraw();
    }
  }, [canvasW, canvasH, redraw]);

  // Load icons from Laravel backend on mount
  useEffect(() => {
    loadIcons().then(() => {
      redraw();
    }).catch(err => {
      console.error('Failed to load icons:', err);
    });
  }, []);



  // ─── Floor plan loader ───────────────────────────────────────────────────────
  const loadFloorPlan = (file) => {
    const check = Utils.validateImage(file);
    if (!check.valid) { setStatus({ msg: check.error, type: 'err' }); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        setFloorPlan(img);
        setFloorPlanFile(file);
        setProjectName(Utils._autoProjectName());
        setProjectType('university');
        setMeasureOfDraw('1/100');
        setRoomTypes(DEFAULT_ROOM_TYPES);
        setOriginalWidth(img.naturalWidth);
        setOriginalHeight(img.naturalHeight);
        const newW = 800;
        const newH = Math.round(img.naturalHeight * (800 / img.naturalWidth));
        setCanvasW(newW);
        setCanvasH(newH);
        setPhase('loaded');
        setRooms([]);
        setDevices([]);
        setConnections([]);
        setSelectedDevice(null);
        setSelectedRoom(null);
        setRoomViewMode(false);
        setCurrentProjectId(null);
        setStatus({ msg: `Loaded: ${file.name}`, type: 'ok' });
        setAiStatus({ label: 'Ready', processing: false });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  // ─── Analyze rooms ───────────────────────────────────────────────────────────
  const analyzeRooms = async () => {
    if (!floorPlanFile) { setStatus({ msg: 'No floor plan file loaded.', type: 'err' }); return; }
    if (!projectName.trim()) { setStatus({ msg: 'Project name is required.', type: 'err' }); return; }
    if (!projectType) { setStatus({ msg: 'Project type is required.', type: 'err' }); return; }
    if (!measureOfDraw) { setStatus({ msg: 'Measure of draw is required.', type: 'err' }); return; }
    setLoading({ show: true, title: 'Analyzing Floor Plan', sub: 'AI is detecting room boundaries…' });
    setAiStatus({ label: 'Processing…', processing: true });
    try {
      let projectId = currentProjectId;
      if (!projectId) {
        const project = await ProjectsAPI.createProject({
          name: projectName.trim(),
          type: projectType,
          imageFile: floorPlanFile,
          measureOfDraw,
        });
        projectId = project.id;
        setCurrentProjectId(projectId);
      }

      const analysis = await ProjectsAPI.analyzeProject(projectId);
      const rawRooms = Array.isArray(analysis.rooms) ? analysis.rooms : [];
      // Backend resizes every image to MODEL_IMG_SIZE×MODEL_IMG_SIZE before
      // detecting rooms, so all returned coordinates are in that space — not
      // in the original image's pixel space.  We must scale from MODEL_IMG_SIZE
      // to canvas size, NOT from originalWidth/Height.
      const modelSize = analysis.model_img_size || 512;
      const scaleX = canvasW / modelSize;
      const scaleY = canvasH / modelSize;
      const scaled = rawRooms.map((r, idx) => {
        const rawCorners = Array.isArray(r.corners) ? r.corners : [];
        const corners = rawCorners
          .map(c => ({ x: Number(c?.x ?? 0), y: Number(c?.y ?? 0) }))
          .filter(c => Number.isFinite(c.x) && Number.isFinite(c.y));
        const hasCorners = corners.length >= 3;
        const scaledCorners = hasCorners
          ? corners.map(c => ({ x: Math.round(c.x * scaleX), y: Math.round(c.y * scaleY) }))
          : null;
        const x1 = hasCorners ? Math.min(...scaledCorners.map(c => c.x)) : Math.round(Number(r.x1 ?? r.x ?? 0) * scaleX);
        const y1 = hasCorners ? Math.min(...scaledCorners.map(c => c.y)) : Math.round(Number(r.y1 ?? r.y ?? 0) * scaleY);
        const x2 = hasCorners ? Math.max(...scaledCorners.map(c => c.x)) : Math.round(Number(r.x2 ?? (r.x ?? 0) + (r.width ?? 0)) * scaleX);
        const y2 = hasCorners ? Math.max(...scaledCorners.map(c => c.y)) : Math.round(Number(r.y2 ?? (r.y ?? 0) + (r.height ?? 0)) * scaleY);
        const x = x1;
        const y = y1;
        const width = x2 - x1;
        const height = y2 - y1;
        const id   = r.id ?? `${projectId}_${idx}`;
        const dbId = Number.isFinite(Number(r.id)) ? Number(r.id) : null;
        const type = r.type || null;
        return {
          ...r,
          id,
          dbId,
          x,
          y,
          width,
          height,
          corners: hasCorners ? scaledCorners : [
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height },
          ],
          name: type ? String(type) : `Room ${idx + 1}`,
          color: ROOM_COLORS[idx % ROOM_COLORS.length],
          type,
        };
      });
      setRooms(scaled);

      try {
        const meta = await RoomsAPI.getRooms(projectId);
        if (Array.isArray(meta.types) && meta.types.length > 0) {
          setRoomTypes(meta.types);
        } else {
          setRoomTypes(DEFAULT_ROOM_TYPES);
        }
        if (Array.isArray(meta.rooms)) {
          const typeById = new Map(meta.rooms.map(rr => [rr.id, rr.type]));
          setRooms(prev => prev.map(rr => {
            const t = typeById.get(rr.id) ?? rr.type ?? null;
            if (!t) return rr;
            return { ...rr, type: t, name: String(t) };
          }));
        }
      } catch (_) {}

      setPhase('analyzed');
      setStatus({ msg: `Detected ${scaled.length} rooms`, type: 'ok' });
      setAiStatus({ label: 'Rooms analyzed', processing: false });
    } catch (err) {
      setStatus({ msg: `Analyze failed: ${err.message}`, type: 'err' });
      setAiStatus({ label: 'Error', processing: false });
    } finally {
      setLoading({ show: false, title: '', sub: '' });
    }
  };

  // ─── Generate network ────────────────────────────────────────────────────────
  const generateNetwork = async () => {
    if (!currentProjectId) {
      setStatus({ msg: 'Create and analyze the project first.', type: 'err' });
      return;
    }
    if (!rooms.length) {
      setStatus({ msg: 'No rooms available for optimization.', type: 'err' });
      return;
    }

    setLoading({ show: true, title: 'Optimizing Network', sub: 'Backend is generating devices and connections…' });
    setAiStatus({ label: 'Optimizing…', processing: true });

    try {
      const optimizeResult = await ProjectsAPI.optimizeNetwork(currentProjectId);
      const topologyResult = await ProjectsAPI.getProjectTopology(currentProjectId);
      const topology = topologyResult?.project || topologyResult || {};
      const rawDevices = Array.isArray(topology.devices) ? topology.devices : [];
      const rawConnections = Array.isArray(topology.connections) ? topology.connections : [];

      if (!rawDevices.length) {
        throw new Error('Network generated but no devices returned — check backend optimizer response.');
      }

      const deviceRefMap = new Map();
      const mappedDevices = rawDevices.map((device, idx) => {
        const frontendId = _frontendDeviceId(device, idx);
        const dbId = Number(device?.id);
        const optimizerId = Number(device?.device_id);
        // register all possible references → frontendId
        if (Number.isFinite(dbId))        deviceRefMap.set(dbId, frontendId);
        if (Number.isFinite(optimizerId)) deviceRefMap.set(optimizerId, frontendId);

        // 1. room_id مباشر من الباك-إند
        // 2. rooms[] → أقرب غرفة بالإحداثيات
        // 3. لا شيء → سكّل إحداثيات الباك-إند وشوف وين تقع على الكانفاس
        let rawRoomId = device?.room_id ?? null;

        if (rawRoomId == null && Array.isArray(device?.rooms) && device.rooms.length > 0) {
          const dx = Number(device?.x ?? 0);
          const dy = Number(device?.y ?? 0);
          const candidates = device.rooms
            .map(rid => rooms.find(r =>
              _sameEntityId(r.id, rid) || _sameEntityId(r.dbId, rid)
            ))
            .filter(Boolean);
          if (candidates.length > 0) {
            const nearest = candidates.reduce((best, r) => {
              const bounds = _roomBounds(r);
              const dist = Math.hypot(dx - bounds.centerX, dy - bounds.centerY);
              return dist < best.dist ? { room: r, dist } : best;
            }, { room: candidates[0], dist: Infinity });
            rawRoomId = nearest.room.id;
          } else {
            rawRoomId = device.rooms[0];
          }
        }

        // Fallback: سكّل إحداثيات الباك-إند وشوف أي غرفة تحتوي الجهاز
        // لكن الـ core devices طبيعتها تكون loose — لا نحطها بغرف
        const coreTypes = ['router', 'firewall', 'server', 'ups'];
        const normalizedType = _normalizeDeviceType(device?.type);
        const isCoreDevice = coreTypes.includes(normalizedType) || device?.layer === 'Core';

        const matchedRoomEntity = rawRoomId != null
          ? rooms.find(r =>
              _sameEntityId(r.id, rawRoomId) ||
              _sameEntityId(r.dbId, rawRoomId) ||
              _sameEntityId(r.room_id, rawRoomId)
            )
          : null;
        const matchedRoom = matchedRoomEntity?.id ?? null;

        // إحداثيات الباك محولة من فضاء 512×512 إلى فضاء الكانفاس
        const modelSize = 512;
        const backendX = device?.x != null ? (Number(device.x) / modelSize) * canvasW : null;
        const backendY = device?.y != null ? (Number(device.y) / modelSize) * canvasH : null;

        return {
          ...device,
          id: frontendId,
          backendId: dbId || null,
          label: _sanitizeDeviceLabel(device, idx),
          type: _normalizeDeviceType(device?.type),
          x: 0,
          y: 0,
          room: matchedRoom,
          _backendX: backendX,
          _backendY: backendY,
        };
      });

      const mappedConnections = rawConnections.map((conn, idx) => {
        const fromRef = Number(conn?.from_device_id ?? conn?.from);
        const toRef   = Number(conn?.to_device_id   ?? conn?.to);
        return {
          ...conn,
          id:   conn?.id ?? `connection-${idx + 1}`,
          from: deviceRefMap.get(fromRef) ?? fromRef,
          to:   deviceRefMap.get(toRef)   ?? toRef,
          type: _normalizeConnectionType(conn?.type),
        };
      }).filter(conn =>
        mappedDevices.some(d => d.id === conn.from) &&
        mappedDevices.some(d => d.id === conn.to)
      );

      // Ignore backend-provided coordinates for layout purposes: scatter each
      // device randomly inside its assigned room so nothing overlaps and the
      // arrangement doesn't just mirror the optimizer's raw coordinates.
      const byRoomKey = new Map();
      const looseDevices = [];
      mappedDevices.forEach(d => {
        if (d.room != null) {
          const key = String(d.room);
          if (!byRoomKey.has(key)) byRoomKey.set(key, []);
          byRoomKey.get(key).push(d);
        } else {
          looseDevices.push(d);
        }
      });

      const randomizedDevices = [];
      byRoomKey.forEach((roomDevices, roomKey) => {
        const room = rooms.find(r => _sameEntityId(r.id, roomKey));
        const placed = room ? _randomizeDevicesInRoom(room, roomDevices, 30) : roomDevices;
        placed.forEach(d => randomizedDevices.push(d));
      });
      // الأجهزة بدون غرفة → إحداثيات الباك مباشرة (محولة من 512)
      looseDevices.forEach(d => {
        if (d._backendX != null && d._backendY != null) {
          randomizedDevices.push({ ...d, x: d._backendX, y: d._backendY });
        } else {
          // fallback إذا الباك ما بعت إحداثيات
          const x = DEVICE_BOUNDARY_PADDING + Math.random() * Math.max(1, canvasW - DEVICE_BOUNDARY_PADDING * 2);
          const y = DEVICE_BOUNDARY_PADDING + Math.random() * Math.max(1, canvasH - DEVICE_BOUNDARY_PADDING * 2);
          randomizedDevices.push({ ...d, ..._constrainPointToCanvas(x, y) });
        }
      });

      setDevices(randomizedDevices);
      setConnections(mappedConnections);
      setPhase('network');
      setSelectedDevice(null);
      setStatus({
        msg: optimizeResult?.message || `Generated ${mappedDevices.length} devices and ${mappedConnections.length} connections`,
        type: 'ok',
      });
      setAiStatus({ label: 'Network ready', processing: false });
    } catch (err) {
      setStatus({ msg: `Network optimization failed: ${err.message}`, type: 'err' });
      setAiStatus({ label: 'Error', processing: false });
    } finally {
      setLoading({ show: false, title: '', sub: '' });
    }
  };

  // ─── Load saved project from Settings ────────────────────────────────────────
  const loadProjectFromBackend = useCallback(async (projectId) => {
    setLoading({ show: true, title: 'Loading Project', sub: 'Fetching saved network design…' });
    setAiStatus({ label: 'Loading…', processing: true });
    try {
      const result = await ProjectsAPI.getFullProject(projectId);
      const proj = result?.project || result;
      if (!proj) throw new Error('No project data returned');

      // ── Canvas size from floor plan image ──────────────────────────────────
      const backendOrigin = API_CONFIG.BASE_URL.replace(/\/api\/?$/, '');
      const rawImageUrl = proj.image_url || proj.image;
      const imageUrl = rawImageUrl
        ? (rawImageUrl.startsWith('http') ? rawImageUrl : `${backendOrigin}/${rawImageUrl.replace(/^\//, '')}`)
        : null;

      const newW = 800;
      let newH = 600;

      if (imageUrl) {
        const loadedImg = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = imageUrl;
        });
        if (loadedImg) {
          newH = Math.round(loadedImg.naturalHeight * (800 / loadedImg.naturalWidth));
          setFloorPlan(loadedImg);
        }
      }
      setCanvasW(newW);
      setCanvasH(newH);

      // ── Rooms — same transform as analyzeRooms (512→canvas) ───────────────
      const modelSize = 512;
      const scaleX = newW / modelSize;
      const scaleY = newH / modelSize;

      const rawRooms = Array.isArray(proj.rooms) ? proj.rooms : [];
      const scaledRooms = rawRooms.map((r, idx) => {
        const rawCorners = Array.isArray(r.corners) ? r.corners : [];
        const corners = rawCorners
          .map(c => ({ x: Number(c?.x ?? 0), y: Number(c?.y ?? 0) }))
          .filter(c => Number.isFinite(c.x) && Number.isFinite(c.y));
        const hasCorners = corners.length >= 3;
        const scaledCorners = hasCorners
          ? corners.map(c => ({ x: Math.round(c.x * scaleX), y: Math.round(c.y * scaleY) }))
          : null;
        const x1 = hasCorners ? Math.min(...scaledCorners.map(c => c.x)) : 0;
        const y1 = hasCorners ? Math.min(...scaledCorners.map(c => c.y)) : 0;
        const x2 = hasCorners ? Math.max(...scaledCorners.map(c => c.x)) : newW;
        const y2 = hasCorners ? Math.max(...scaledCorners.map(c => c.y)) : newH;
        const x = x1, y = y1, width = x2 - x1, height = y2 - y1;
        const id = r.id ?? `${projectId}_${idx}`;
        const dbId = Number.isFinite(Number(r.id)) ? Number(r.id) : null;
        const type = r.type || null;
        return {
          ...r,
          id, dbId, x, y, width, height,
          corners: hasCorners ? scaledCorners : [
            { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
          ],
          name: type ? String(type) : `Room ${idx + 1}`,
          color: ROOM_COLORS[idx % ROOM_COLORS.length],
          type,
        };
      });
      setRooms(scaledRooms);
      // ── Room types — fetch actual list from backend (same as analyzeRooms) ──
      try {
        const meta = await RoomsAPI.getRooms(projectId);
        if (Array.isArray(meta.types) && meta.types.length > 0) {
          setRoomTypes(meta.types);
        } else {
          setRoomTypes(DEFAULT_ROOM_TYPES);
        }
        if (Array.isArray(meta.rooms)) {
          const typeById = new Map(meta.rooms.map(rr => [rr.id, rr.type]));
          setRooms(prev => prev.map(rr => {
            const t = typeById.get(rr.id) ?? rr.type ?? null;
            if (!t) return rr;
            return { ...rr, type: t, name: String(t) };
          }));
        }
      } catch (_) {}

      // ── Devices + Connections — same transform as generateNetwork ─────────
      // ── Devices + Connections — same transform as generateNetwork ─────────
      const rawDevices = Array.isArray(proj.devices) ? proj.devices : [];
      const rawConnections = Array.isArray(proj.connections) ? proj.connections : [];

      const deviceRefMap = new Map();
      const mappedDevices = rawDevices.map((device, idx) => {
        const frontendId = _frontendDeviceId(device, idx);
        const dbId = Number(device?.id);
        const optimizerId = Number(device?.device_id);
        if (Number.isFinite(dbId))        deviceRefMap.set(dbId, frontendId);
        if (Number.isFinite(optimizerId)) deviceRefMap.set(optimizerId, frontendId);

        let rawRoomId = device?.room_id ?? null;
        if (rawRoomId == null && Array.isArray(device?.rooms) && device.rooms.length > 0) {
          const dx = Number(device?.x ?? 0);
          const dy = Number(device?.y ?? 0);
          const candidates = device.rooms
            .map(rid => scaledRooms.find(r => _sameEntityId(r.id, rid) || _sameEntityId(r.dbId, rid)))
            .filter(Boolean);
          if (candidates.length > 0) {
            const nearest = candidates.reduce((best, r) => {
              const bounds = _roomBounds(r);
              const dist = Math.hypot(dx - bounds.centerX, dy - bounds.centerY);
              return dist < best.dist ? { room: r, dist } : best;
            }, { room: candidates[0], dist: Infinity });
            rawRoomId = nearest.room.id;
          } else {
            rawRoomId = device.rooms[0];
          }
        }

        const matchedRoomEntity = rawRoomId != null
          ? scaledRooms.find(r =>
              _sameEntityId(r.id, rawRoomId) ||
              _sameEntityId(r.dbId, rawRoomId) ||
              _sameEntityId(r.room_id, rawRoomId)
            )
          : null;
        const matchedRoom = matchedRoomEntity?.id ?? null;

        const backendX = device?.x != null ? (Number(device.x) / modelSize) * newW : null;
        const backendY = device?.y != null ? (Number(device.y) / modelSize) * newH : null;

        return {
          ...device,
          id: frontendId,
          backendId: dbId || null,
          label: _sanitizeDeviceLabel(device, idx),
          type: _normalizeDeviceType(device?.type),
          x: 0, y: 0,
          room: matchedRoom,
          _backendX: backendX,
          _backendY: backendY,
        };
      });

      const mappedConnections = rawConnections.map((conn, idx) => {
        const fromRef = Number(conn?.from_device_id ?? conn?.from);
        const toRef   = Number(conn?.to_device_id   ?? conn?.to);
        return {
          ...conn,
          id:   conn?.id ?? `connection-${idx + 1}`,
          from: deviceRefMap.get(fromRef) ?? fromRef,
          to:   deviceRefMap.get(toRef)   ?? toRef,
          type: _normalizeConnectionType(conn?.type),
        };
      }).filter(conn =>
        mappedDevices.some(d => d.id === conn.from) &&
        mappedDevices.some(d => d.id === conn.to)
      );

      // Place devices — room devices randomized, loose devices use backend coords
      const byRoomKey = new Map();
      const looseDevices = [];
      mappedDevices.forEach(d => {
        if (d.room != null) {
          const key = String(d.room);
          if (!byRoomKey.has(key)) byRoomKey.set(key, []);
          byRoomKey.get(key).push(d);
        } else {
          looseDevices.push(d);
        }
      });

      const placedDevices = [];
      byRoomKey.forEach((roomDevices, roomKey) => {
        const room = scaledRooms.find(r => _sameEntityId(r.id, roomKey));
        const placed = room ? _randomizeDevicesInRoom(room, roomDevices, 30) : roomDevices;
        placed.forEach(d => placedDevices.push(d));
      });
      looseDevices.forEach(d => {
        if (d._backendX != null && d._backendY != null) {
          placedDevices.push({ ...d, x: d._backendX, y: d._backendY });
        } else {
          const x = DEVICE_BOUNDARY_PADDING + Math.random() * Math.max(1, newW - DEVICE_BOUNDARY_PADDING * 2);
          const y = DEVICE_BOUNDARY_PADDING + Math.random() * Math.max(1, newH - DEVICE_BOUNDARY_PADDING * 2);
          placedDevices.push({ ...d, x, y });
        }
      });

      setDevices(placedDevices);
      setConnections(mappedConnections);
      setCurrentProjectId(proj.id);
      setProjectName(proj.name || '');
      setProjectType(proj.type || 'university');
      setMeasureOfDraw(proj.measure_of_draw || '1/100');
      setPhase(placedDevices.length > 0 ? 'network' : scaledRooms.length > 0 ? 'analyzed' : 'loaded');
      setSelectedDevice(null);
      setSelectedRoom(null);
      setRoomViewMode(false);
      setStatus({ msg: `Loaded: "${proj.name}"`, type: 'ok' });
      setAiStatus({ label: placedDevices.length > 0 ? 'Network ready' : 'Rooms analyzed', processing: false });
    } catch (err) {
      setStatus({ msg: `Failed to load project: ${err.message}`, type: 'err' });
      setAiStatus({ label: 'Error', processing: false });
    } finally {
      setLoading({ show: false, title: '', sub: '' });
    }
  }, [_frontendDeviceId, _sanitizeDeviceLabel, _normalizeDeviceType, _normalizeConnectionType,
      _roomBounds, _sameEntityId, _randomizeDevicesInRoom]);

  // ─── Reset ───────────────────────────────────────────────────────────────────
  const resetAll = () => {
    setPhase('empty');
    setFloorPlan(null);
    setFloorPlanFile(null);
    setProjectName('');
    setProjectType('');
    setMeasureOfDraw('1/100');
    setRoomTypes(DEFAULT_ROOM_TYPES);
    setRooms([]);
    setDevices([]);
    setConnections([]);
    setSelectedDevice(null);
    setSelectedRoom(null);
    setRoomViewMode(false);
    setExpandedDeviceIds(new Set());
    setExpandedDeviceCopies(new Map());
    setZoom(1);
    setCurrentProjectId(null);
    setStatus({ msg: 'Reset — ready for new design', type: 'ok' });
    setAiStatus({ label: 'Ready', processing: false });
  };

  // ─── Navigate to Settings (with state persistence) ──────────────────────────
  const goToSettings = () => {
    if (phase !== 'empty') {
      saveDesignerState({
        phase,
        projectName,
        projectType,
        measureOfDraw,
        canvasW,
        canvasH,
        rooms,
        devices,
        connections,
        currentProjectId,
        viewMode,
        floorPlanDataUrl: floorPlan?.src || null,
      });
    }
    window.location.href = '/settings';
  };

  // ─── Room type assignment ────────────────────────────────────────────────────
  const assignRoomType = async (roomId, type) => {
    if (!type) return;
    const before = rooms.find(r => r.id === roomId);
    setTypeUpdatingRoomId(roomId);
    setRooms(prev => prev.map(r => r.id === roomId ? { ...r, type, name: String(type) } : r));
    try {
      await RoomsAPI.updateType(roomId, type);
    } catch (err) {
      setRooms(prev => prev.map(r => r.id === roomId ? (before || r) : r));
      setStatus({ msg: `Update type failed: ${err.message}`, type: 'err' });
    } finally {
      setTypeUpdatingRoomId(null);
    }
  };

  // ─── Export / Save ───────────────────────────────────────────────────────────
  const exportDesign = () => {
    if (!floorPlan) { setStatus({ msg: 'Nothing to export', type: 'err' }); return; }
    const link = document.createElement('a');
    link.download = 'network-design.png';
    link.href = mainCanvasRef.current.toDataURL('image/png');
    link.click();
    setStatus({ msg: 'Exported as network-design.png', type: 'ok' });
  };

  const saveProject = async () => {
    if (phase === 'empty') { setStatus({ msg: 'Nothing to save yet', type: 'err' }); return; }
    try {
      const project = await ProjectsAPI.save(
        { canvasW, canvasH, rooms, devices, connections, phase, floorPlan },
        null,
        currentProjectId,
      );
      setCurrentProjectId(project.id);
      setSaveBtnSaved(true);
      setStatus({ msg: `Saved: "${project.name}"`, type: 'ok' });
      setTimeout(() => setSaveBtnSaved(false), 2200);
    } catch (err) {
      setStatus({ msg: `Save failed: ${err.message}`, type: 'err' });
    }
  };

  // ─── Canvas event handlers ───────────────────────────────────────────────────
  const handleCanvasMouseDown = (e) => {
    const rect = mainCanvasRef.current.getBoundingClientRect();
    const scaleX = mainCanvasRef.current.width  / rect.width;
    const scaleY = mainCanvasRef.current.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top)  * scaleY;

    // In room-view mode only allow device selection / drag
    if (roomViewMode && selectedRoom) {
      const room        = rooms.find(r => _sameEntityId(r.id, selectedRoom));
      const { renderDevices: roomDevices } = _computeRoomViewScene(selectedRoom);
      if (room) {
        const W = mainCanvasRef.current.width;
        const H = mainCanvasRef.current.height;
        const frame = _getRoomViewFrame(room, W, H);

        // Convert canvas coords → room coords for hit-testing
        const hit = roomDevices.find(d => {
          const point = _toRoomViewPoint(d.x, d.y, frame);
          return Math.hypot(mouseX - point.x, mouseY - point.y) <= 18;
        });
        if (hit) {
          if (hit.isExpandableBadge) {
            // Toggle expand
            const deviceId = hit.id;
            const qty = hit.quantity || 1;
            setExpandedDeviceIds(prev => {
              const next = new Set(prev);
              if (next.has(deviceId)) {
                next.delete(deviceId);
                // Remove stored positions
                setExpandedDeviceCopies(p => { const m = new Map(p); m.delete(deviceId); return m; });
              } else {
                next.add(deviceId);
                // Compute stable random positions once and store them
                const positions = [];
                for (let i = 0; i < qty; i++) {
                  positions.push(_randomPointInRoom(room, 20));
                }
                setExpandedDeviceCopies(p => new Map(p).set(deviceId, positions));
              }
              return next;
            });
            setSelectedDevice(null);
            return;
          }
          // Regular device or expanded copy → select / drag
          dragRef.current = { active: true, deviceId: hit.id, ox: mouseX, oy: mouseY, mode: 'room' };
          setSelectedDevice(hit);
        }
      }
      return;
    }

    // Normal mode: device hit-test
    const { renderDevices } = _computeRenderDevices();
    const hit = renderDevices.find(d => Math.hypot(mouseX - d.x, mouseY - d.y) <= 18);
    if (hit) {
      dragRef.current = { active: true, deviceId: hit.id, ox: mouseX - hit.x, oy: mouseY - hit.y, mode: 'normal' };
      setSelectedDevice(hit);
      setSelectedRoom(null);
      return;
    }

    // Room hit-test → enter drill-down
    const roomHit = _roomAtPoint(mouseX, mouseY);
    if (roomHit) {
      setSelectedRoom(roomHit.id);
      setRoomViewMode(true);
      setSelectedDevice(null);
    }
  };

  const handleCanvasMouseMove = (e) => {
    const rect   = mainCanvasRef.current.getBoundingClientRect();
    const scaleX = mainCanvasRef.current.width  / rect.width;
    const scaleY = mainCanvasRef.current.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top)  * scaleY;

    if (dragRef.current.active) {
      const { deviceId } = dragRef.current;

      if (dragRef.current.mode === 'room' && selectedRoom) {
        // In room-view: translate mouse delta back to main-canvas coords
        const room = rooms.find(r => _sameEntityId(r.id, selectedRoom));
        if (room) {
          const W = mainCanvasRef.current.width;
          const H = mainCanvasRef.current.height;
          const frame = _getRoomViewFrame(room, W, H);
          const dx = (mouseX - dragRef.current.ox) / frame.scale;
          const dy = (mouseY - dragRef.current.oy) / frame.scale;
          dragRef.current.ox = mouseX;
          dragRef.current.oy = mouseY;

          setDevices(prev => prev.map(d => {
            if (d.id !== deviceId) return d;
            const nextPoint = _constrainPointToRoom(room, d.x + dx, d.y + dy);
            return { ...d, x: nextPoint.x, y: nextPoint.y, room: room.id };
          }));
        }
      } else {
        const rawX = mouseX - dragRef.current.ox;
        const rawY = mouseY - dragRef.current.oy;
        const newRoom = _roomAtPoint(rawX, rawY);
        const nextPoint = newRoom
          ? _constrainPointToRoom(newRoom, rawX, rawY)
          : _constrainPointToCanvas(rawX, rawY);

        setDevices(prev => prev.map(d => (
          d.id === deviceId
            ? { ...d, x: nextPoint.x, y: nextPoint.y, room: newRoom ? newRoom.id : null }
            : d
        )));
      }

      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          redraw();
        });
      }
      return;
    }

    if (roomViewMode && selectedRoom) {
      const room = rooms.find(r => _sameEntityId(r.id, selectedRoom));
      if (room) {
        const frame = _getRoomViewFrame(room, mainCanvasRef.current.width, mainCanvasRef.current.height);
        const { renderDevices } = _computeRoomViewScene(selectedRoom);
        const hovered = renderDevices.find(d => {
          const point = _toRoomViewPoint(d.x, d.y, frame);
          return Math.hypot(mouseX - point.x, mouseY - point.y) <= 18;
        });
        const hoveredWithViewCoords = hovered
          ? { ...hovered, ..._toRoomViewPoint(hovered.x, hovered.y, frame) }
          : null;
        if ((hoveredWithViewCoords?.id || null) !== (hoveredDevice?.id || null)) {
          setHoveredDevice(hoveredWithViewCoords);
          redraw();
        }
      }
      return;
    }

    const { renderDevices } = _computeRenderDevices();
    const hovered = renderDevices.find(d => Math.hypot(mouseX - d.x, mouseY - d.y) <= 18);
    if (hovered !== hoveredDevice) {
      setHoveredDevice(hovered);
      redraw();
    }
  };

  const handleCanvasMouseUp = () => {
    if (dragRef.current.active && dragRef.current.deviceId != null) {
      const finalDevice = devices.find(d => d.id === dragRef.current.deviceId);
      if (finalDevice) setSelectedDevice(finalDevice);
    }
    if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
    dragRef.current = { active: false, deviceId: null, ox: 0, oy: 0, mode: 'normal' };
  };

const handleCanvasDrop = (e) => {
  e.preventDefault();
  const type = e.dataTransfer.getData('netarch/type');
  if (!type) return;
  if (roomViewMode) {
    setStatus({ msg: 'Exit room view to add devices.', type: 'err' });
    return;
  }

  const rect = mainCanvasRef.current.getBoundingClientRect();
  const scaleX = mainCanvasRef.current.width / rect.width;
  const scaleY = mainCanvasRef.current.height / rect.height;
  const mouseX = (e.clientX - rect.left) * scaleX;
  const mouseY = (e.clientY - rect.top) * scaleY;

  const room = _roomAtPoint(mouseX, mouseY);
  if (!room) {
    setStatus({ msg: 'يجب إسقاط الجهاز داخل غرفة', type: 'err' });
    return;
  }
  if (!currentProjectId) {
    setStatus({ msg: 'لا يوجد مشروع نشط', type: 'err' });
    return;
  }

  const point = _constrainPointToRoom(room, mouseX, mouseY);

  // احسب موقع الـ modal على الشاشة
  const canvasX = e.clientX;
  const canvasY = e.clientY;

  setPendingDevice({ type, room, point, canvasX, canvasY });
};

  const handleCanvasDblClick = (e) => {
    if (roomViewMode) return;
    const rect = mainCanvasRef.current.getBoundingClientRect();
    const scaleX = mainCanvasRef.current.width  / rect.width;
    const scaleY = mainCanvasRef.current.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top)  * scaleY;
    const hit = devices.find(d => Math.hypot(mouseX - d.x, mouseY - d.y) <= 18);
    if (!hit) return;
    const newLabel = prompt('Enter device name:', hit.label);
    if (!newLabel || !newLabel.trim()) return;
    const updated = { ...hit, label: newLabel.trim(), localOnly: true };
    setDevices(prev => prev.map(d => d.id === hit.id ? updated : d));
    if (selectedDevice?.id === hit.id) setSelectedDevice(updated);
    setStatus({ msg: 'Device renamed (local only).', type: 'ok' });
    redraw();
  };

  // Back from room drill-down
  const handleBackToMain = () => {
    setRoomViewMode(false);
    setSelectedRoom(null);
    setSelectedDevice(null);
    setExpandedDeviceIds(new Set());
    setExpandedDeviceCopies(new Map());
  };

  // ─── Update device quantity (room view panel) ────────────────────────────────
  const handleUpdateQuantity = async (device, delta) => {
    const newQty = Math.max(1, (device.quantity || 1) + delta);
    // Optimistic update
    setDevices(prev => prev.map(d =>
      d.id === device.id ? { ...d, quantity: newQty } : d
    ));
    try {
      await DevicesAPI.updateQuantity(device.backendId ?? device.id, newQty);
      setStatus({ msg: `Updated ${device.type} quantity to ${newQty}`, type: 'ok' });
    } catch (err) {
      // Rollback
      setDevices(prev => prev.map(d =>
        d.id === device.id ? { ...d, quantity: device.quantity || 1 } : d
      ));
      setStatus({ msg: `Failed to update quantity: ${err.message}`, type: 'err' });
    }
  };

  // ─── Delete all devices of a type in a room (sidebar/keyboard + room panel) ──
  const handleDeleteDeviceFromRoom = async (device) => {
    // Find all devices of same type in same room
    const toDelete = devices.filter(d =>
      _sameEntityId(d.room, device.room) && d.type === device.type
    );
    // Optimistic: remove from state
    const idsToDelete = new Set(toDelete.map(d => d.id));
    setDevices(prev => prev.filter(d => !idsToDelete.has(d.id)));
    setConnections(prev => prev.filter(c => !idsToDelete.has(c.from) && !idsToDelete.has(c.to)));
    if (selectedDevice && idsToDelete.has(selectedDevice.id)) setSelectedDevice(null);
    setStatus({ msg: `Deleted all ${device.type} in room`, type: 'ok' });
    // Call backend for each
    try {
      await Promise.all(toDelete.map(d =>
        DevicesAPI.deleteDevice(d.backendId ?? d.id)
      ));
    } catch (err) {
      setStatus({ msg: `Delete failed: ${err.message}`, type: 'err' });
    }
    redraw();
  };

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDevice) {
        if (document.activeElement === document.body || document.activeElement === mainCanvasRef.current) {
          e.preventDefault();
          handleDeleteDeviceFromRoom(selectedDevice);
        }
      }
      if (e.key === 'Escape') {
        if (roomViewMode) {
          handleBackToMain();
        } else if (selectedDevice) {
          setSelectedDevice(null);
          redraw();
        } else if (selectedRoom) {
          setSelectedRoom(null);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [roomViewMode, selectedDevice, selectedRoom, redraw]);
  const handleDeviceModalConfirm = async ({ vlan_id, ports }) => {
  const { type, room, point } = pendingDevice;
  setPendingDevice(null);

  const backendType = _deviceTypeToBackend(type);
  const modelSize = 512;

  try {
    const data = await DevicesAPI.addDevice(currentProjectId, {
      type: backendType,
      room_id: room.dbId ?? room.id,
      x: (point.x / canvasW) * modelSize,
      y: (point.y / canvasH) * modelSize,
      quantity: 1,
      ...(vlan_id != null && { vlan_id }),
      ...(ports != null && { ports }),
    });

    const newDev = {
      ...data.device,
      id: data.device.id,
      type: _normalizeDeviceType(data.device.type),
      label: _sanitizeDeviceLabel(data.device, devices.length),
      room: room.id,
      x: point.x,
      y: point.y,
    };

    setDevices(prev => [...prev, newDev]);
    if (phase !== 'network') setPhase('network');
    setStatus({ msg: `تمت إضافة ${type} بنجاح`, type: 'ok' });
    redraw();
  } catch (err) {
    setStatus({ msg: `فشل إضافة الجهاز: ${err.message}`, type: 'err' });
  }
};

const handleDeviceModalCancel = () => setPendingDevice(null);

  // ─── JSX ─────────────────────────────────────────────────────────────────────
  const activeRoom = roomViewMode ? rooms.find(r => _sameEntityId(r.id, selectedRoom)) : null;
  const roomTypeSidebar = roomViewMode && activeRoom && roomTypes.length > 0 && phase !== 'network' ? (
    <div className={styles.roomTypeSidebar}>
      <div className={styles.roomTypeSidebarHeader}>
        <div className={styles.roomTypeSidebarTitle}>Room Types</div>
        <div className={styles.roomTypeSidebarSub}>
          Select a type for this room. You can change it anytime.
        </div>
      </div>
      <div className={styles.roomTypeSidebarList}>
        {roomTypes.map((t) => {
          const active = activeRoom.type === t;
          const updating = typeUpdatingRoomId === activeRoom.id;
          return (
            <button
              key={t}
              className={`${styles.roomTypeOption} ${active ? styles.roomTypeOptionActive : ''}`}
              disabled={updating}
              onClick={() => assignRoomType(activeRoom.id, t)}
            >
              <span className={styles.roomTypeOptionName}>{t}</span>
              {active && (
                <span className={styles.roomTypeOptionBadge}>
                  {updating ? 'Updating…' : 'Selected'}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  const DeviceModal = ({ pending, onConfirm, onCancel }) => {
  const needsPorts = ['switch', 'router'].includes(pending.type);
  const portOptions = pending.type === 'switch'
    ? [8, 16, 24, 48]
    : [4, 8, 16];

  const [vlanId, setVlanId] = useState('');
  const [ports, setPorts] = useState(portOptions[0] ?? '');

  const vlanOptions = [
    { id: 10, name: 'Management' },
    { id: 20, name: 'Surveillance' },
    { id: 30, name: 'Academic' },
    { id: 40, name: 'Administration' },
    { id: 50, name: 'Faculty' },
    { id: 60, name: 'Common Areas' },
  ];

  return (
    <div style={{
      position: 'fixed',
      top: pending.canvasY,
      left: pending.canvasX,
      zIndex: 999,
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-hi)',
      borderRadius: 10,
      padding: '14px 16px',
      minWidth: 220,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {pending.type} — {pending.room.name}
      </div>

      {/* VLAN */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1 }}>VLAN</label>
        <select
          value={vlanId}
          onChange={e => setVlanId(e.target.value)}
          style={{
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-1)',
            padding: '6px 8px',
            fontFamily: 'var(--ff-mono)',
            fontSize: 11,
            outline: 'none',
          }}
        >
          <option value="">-- بدون VLAN --</option>
          {vlanOptions.map(v => (
            <option key={v.id} value={v.id}>VLAN {v.id} — {v.name}</option>
          ))}
        </select>
      </div>

      {/* Ports — فقط للسويتش والراوتر */}
      {needsPorts && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1 }}>PORTS</label>
          <select
            value={ports}
            onChange={e => setPorts(Number(e.target.value))}
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-1)',
              padding: '6px 8px',
              fontFamily: 'var(--ff-mono)',
              fontSize: 11,
              outline: 'none',
            }}
          >
            {portOptions.map(p => (
              <option key={p} value={p}>{p} ports</option>
            ))}
          </select>
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={() => onConfirm({ vlan_id: vlanId ? Number(vlanId) : null, ports: needsPorts ? ports : null })}
          style={{
            flex: 1,
            padding: '7px 0',
            background: 'var(--cyan)',
            border: 'none',
            borderRadius: 6,
            color: '#050812',
            fontFamily: 'var(--ff-mono)',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Add Device
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '7px 12px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-3)',
            fontFamily: 'var(--ff-mono)',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

  // Collect unique VLAN IDs from current devices for the legend
  const vlanLegend = viewMode === 'vlan' && phase === 'network' ? (() => {
    const seen = new Map();
    devices.forEach(d => {
      if (d.vlan_id != null && !seen.has(Number(d.vlan_id))) {
        seen.set(Number(d.vlan_id), _vlanColor(d.vlan_id));
      }
    });
    return [...seen.entries()].sort((a, b) => a[0] - b[0]);
  })() : [];

  const VLAN_NAMES = {
    10: 'Management',
    20: 'Surveillance',
    30: 'Academic',
    40: 'Administration',
    50: 'Faculty',
    60: 'Common Areas',
  };

  const vlanOverlay = viewMode === 'vlan' && vlanLegend.length > 0 ? (
    <div className={styles.vlanLegend}>
      <div className={styles.vlanLegendTitle}>VLAN SEGMENTS</div>
      {vlanLegend.map(([id, color]) => (
        <div key={id} className={styles.vlanLegendItem}>
          <div className={styles.vlanLegendSwatch} style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
          <div className={styles.vlanLegendText}>
            <span className={styles.vlanLegendLabel}>VLAN {id}</span>
            <span className={styles.vlanLegendName}>{VLAN_NAMES[id] || '—'}</span>
          </div>
        </div>
      ))}
    </div>
  ) : null;

  // ─── Room Devices Panel — shown top-right in room view ───────────────────────
  // Groups devices by type (since same-type devices in a room collapse to one entry),
  // shows quantity, and provides +/- and delete controls.
  const roomDevicesPanel = roomViewMode && activeRoom ? (() => {
    const roomDeviceList = devices.filter(d => _sameEntityId(d.room, activeRoom.id));
    if (!roomDeviceList.length) return null;

    // Group by type (each unique type = one row)
    const grouped = new Map();
    roomDeviceList.forEach(d => {
      const key = d.type;
      if (!grouped.has(key)) {
        grouped.set(key, { ...d, quantity: d.quantity || 1 });
      } else {
        // If multiple separate device entries of same type, sum their quantities
        const existing = grouped.get(key);
        grouped.set(key, { ...existing, quantity: (existing.quantity || 1) + (d.quantity || 1) });
      }
    });

    const rows = [...grouped.values()];

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--border-hi)',
        background: 'rgba(10,14,26,0.92)',
        boxShadow: '0 16px 50px rgba(0,0,0,0.55)',
        backdropFilter: 'blur(10px)',
        minWidth: 210,
      }}>
        <div style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '1.5px',
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          marginBottom: 4,
          fontFamily: 'var(--ff-mono)',
        }}>
          Devices in Room
        </div>
        {rows.map(device => {
          const col = DEVICE_COLORS[device.type] || '#888';
          const qty = device.quantity || 1;
          return (
            <div key={device.type} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 8px',
              borderRadius: 7,
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
            }}>
              {/* Color dot + type name */}
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: col, flexShrink: 0,
                boxShadow: `0 0 6px ${col}`,
              }} />
              <span style={{
                flex: 1,
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-1)',
                fontFamily: 'var(--ff-mono)',
                textTransform: 'capitalize',
              }}>{device.type}</span>
              {/* − qty + */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={() => handleUpdateQuantity(device, -1)}
                  disabled={qty <= 1}
                  style={{
                    width: 20, height: 20,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: qty <= 1 ? 'var(--text-3)' : 'var(--text-1)',
                    cursor: qty <= 1 ? 'not-allowed' : 'pointer',
                    fontSize: 14,
                    fontFamily: 'var(--ff-mono)',
                    lineHeight: 1,
                    padding: 0,
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => { if (qty > 1) e.currentTarget.style.borderColor = 'var(--cyan)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                >−</button>
                <span style={{
                  minWidth: 22, textAlign: 'center',
                  fontSize: 12, fontWeight: 700,
                  color: 'var(--cyan)',
                  fontFamily: 'var(--ff-mono)',
                }}>{qty}</span>
                <button
                  onClick={() => handleUpdateQuantity(device, +1)}
                  style={{
                    width: 20, height: 20,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-1)',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontFamily: 'var(--ff-mono)',
                    lineHeight: 1,
                    padding: 0,
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--cyan)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                >+</button>
              </div>
              {/* Delete button */}
              <button
                onClick={() => handleDeleteDeviceFromRoom(device)}
                title={`Delete all ${device.type} in this room`}
                style={{
                  width: 20, height: 20,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 4,
                  color: 'var(--text-3)',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--red)';
                  e.currentTarget.style.color = 'var(--red)';
                  e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'transparent';
                  e.currentTarget.style.color = 'var(--text-3)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M2 3h8M4 3V2h4v1M5 5v4M7 5v4M3 3l1 7h4l1-7"
                    stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    );
  })() : null;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoMark}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke="#00c8f8" strokeWidth="1.5" fill="none"/>
              <circle cx="12" cy="12" r="3" fill="#00c8f8" opacity="0.8"/>
              <line x1="12" y1="5"    x2="12" y2="9"    stroke="#00c8f8" strokeWidth="1"/>
              <line x1="12" y1="15"   x2="12" y2="19"   stroke="#00c8f8" strokeWidth="1"/>
              <line x1="5"  y1="8.5"  x2="9"  y2="10.5" stroke="#00c8f8" strokeWidth="1"/>
              <line x1="15" y1="13.5" x2="19" y2="15.5" stroke="#00c8f8" strokeWidth="1"/>
              <line x1="5"  y1="15.5" x2="9"  y2="13.5" stroke="#00c8f8" strokeWidth="1"/>
              <line x1="15" y1="10.5" x2="19" y2="8.5"  stroke="#00c8f8" strokeWidth="1"/>
            </svg>
          </div>
          <span className={styles.logoText}>NetArch<span className={styles.logoAccent}>AI</span></span>
        </div>
        <div className={styles.pipeline}>
          <div className={`${styles.pipelineStep} ${phase === 'empty' || phase === 'loaded' ? styles.active : phase === 'analyzed' || phase === 'network' ? styles.done : ''}`}>
            <span className={styles.stepNum}>01</span>
            <span className={styles.stepLabel}>Upload</span>
          </div>
          <div className={styles.pipelineArrow}>→</div>
          <div className={`${styles.pipelineStep} ${phase === 'analyzed' ? styles.active : phase === 'network' ? styles.done : ''}`}>
            <span className={styles.stepNum}>02</span>
            <span className={styles.stepLabel}>Analyze</span>
          </div>
          <div className={styles.pipelineArrow}>→</div>
          <div className={`${styles.pipelineStep} ${phase === 'network' ? styles.active : ''}`}>
            <span className={styles.stepNum}>03</span>
            <span className={styles.stepLabel}>Network</span>
          </div>
          <div className={styles.pipelineArrow}>→</div>
          <div className={`${styles.pipelineStep} ${roomViewMode ? styles.active : ''}`}>
            <span className={styles.stepNum}>04</span>
            <span className={styles.stepLabel}>Edit</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.aiStatus}>
            <div className={`${styles.aiDot} ${aiStatus.processing ? styles.processing : ''}`}></div>
            <span className={styles.aiLabel}>{aiStatus.label}</span>
          </div>
          <div className={styles.userChip} onClick={goToSettings}>
            <div className={styles.userAvatar}>{user?.name?.charAt(0).toUpperCase() || 'U'}</div>
            <span className={styles.userName}>{user?.name || 'User'}</span>
          </div>
          {phase === 'network' && (
            <button
              className={`${styles.hdrBtn} ${viewMode === 'vlan' ? styles.hdrBtnVlanActive : ''}`}
              onClick={() => setViewMode(v => v === 'network' ? 'vlan' : 'network')}
              title="Toggle VLAN view"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="4" width="5" height="6" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="8" y="4" width="5" height="6" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M6 7h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              {viewMode === 'vlan' ? 'Network View' : 'VLAN View'}
            </button>
          )}
          <button className={styles.hdrBtn} onClick={exportDesign} title="Export PNG">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v8M4 6l3 3 3-3M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Export
          </button>
          <button className={`${styles.hdrBtn} ${styles.hdrBtnSave} ${saveBtnSaved ? styles.saved : ''}`} onClick={saveProject} title="Save Project">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2h8l2 2v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="4.5" y="2" width="4" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.1"/>
              <rect x="3.5" y="7.5" width="7" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.1"/>
            </svg>
            Save
          </button>
          <button className={styles.hdrBtn} onClick={goToSettings} title="Settings">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M7 1.5V3M7 11v1.5M1.5 7H3M11 7h1.5M3.2 3.2l1 1M9.8 9.8l1 1M3.2 10.8l1-1M9.8 4.2l1-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Settings
          </button>
          <button className={`${styles.hdrBtn} ${styles.hdrBtnLogout}`} onClick={logout} title="Sign out">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 2H2.5A1.5 1.5 0 0 0 1 3.5v7A1.5 1.5 0 0 0 2.5 12H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M9 4l3 3-3 3M5 7h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Logout
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <Sidebar
          onUpload={loadFloorPlan}
          onAnalyze={analyzeRooms}
          onGenerate={generateNetwork}
          onReset={resetAll}
          phase={phase}
          projectName={projectName}
          projectType={projectType}
          measureOfDraw={measureOfDraw}
          projectTypeOptions={projectTypeOptions}
          measureOptions={measureOptions}
          onProjectNameChange={setProjectName}
          onProjectTypeChange={setProjectType}
          onMeasureOfDrawChange={setMeasureOfDraw}
          selectedDevice={selectedDevice}
          rooms={rooms}
          floorPlan={floorPlan}
          vlanNames={VLAN_NAMES}
          onDeleteDevice={selectedDevice ? () => handleDeleteDeviceFromRoom(selectedDevice) : null}
        />

        <CanvasArea
          canvasRef={mainCanvasRef}
          viewportRef={viewportRef}
          zoom={zoom}
          setZoom={setZoom}
          canvasW={canvasW}
          canvasH={canvasH}
          phase={phase}
          onCanvasMouseDown={handleCanvasMouseDown}
          onCanvasMouseMove={handleCanvasMouseMove}
          onCanvasMouseUp={handleCanvasMouseUp}
          onCanvasDrop={handleCanvasDrop}
          onCanvasDblClick={handleCanvasDblClick}
          hoveredDevice={hoveredDevice}
          roomViewMode={roomViewMode}
          onBackToMain={handleBackToMain}
          selectedRoomName={roomViewMode ? rooms.find(r => r.id === selectedRoom)?.name : null}
          leftOverlay={vlanOverlay || roomTypeSidebar}
          rightOverlay={roomDevicesPanel}
          rooms={rooms}
          vlanNames={VLAN_NAMES}
        />
      </div>

      

      <StatusBar
        status={status}
        deviceCount={devices.length}
        roomCount={rooms.length}
        connCount={connections.length}
      />
      {loading.show && <LoadingOverlay title={loading.title} sub={loading.sub} />}
      {pendingDevice && (
      <DeviceModal
        pending={pendingDevice}
        onConfirm={handleDeviceModalConfirm}
        onCancel={handleDeviceModalCancel}
      />
)}
      
    </div>
  );
}