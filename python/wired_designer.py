#!/usr/bin/env python3
"""
Wired Network Designer -- ILP (facility-location) redesign.

This version implements the decisions written down in
`wired_network_redesign_ideas.md`:

  1. No Outlet devices are generated here anymore. Topology is a direct
     Endpoint/Camera -> Access Switch link. Outlet counts are computed
     later in Laravel from the endpoint count.
  2. The old `AgglomerativeClustering` step is removed entirely. Switch
     placement + endpoint assignment is solved directly as a
     Capacitated Facility Location Problem (CFLP) with Google OR-Tools
     (CP-SAT), replacing the GeneticOptimizer.
  3. Manhattan (L1) distance is used everywhere for cabling, converted
     to real meters via `physical_scale`.
  4. Room-eligibility rules (backbone-eligible / forbidden / camera-only)
     are enforced before any placement happens.
  5. Switch size (24 vs 48 ports) is derived after solving, from the
     actual assigned load -- it is not a decision variable.
  6. Backbone gateway chain: Core Switch -- Proxy -- Firewall -- Router
     -- Modem (each hop a single point-to-point link). Server, DNS and
     DHCP are internal services wired directly to the Core Switch, each
     on its own port -- not chained behind the Firewall.
  7. An NVR is hosted inside the Security room (if one exists) on the
     camera VLAN, instead of being a separate backbone member.
  8. If no room on the floor is backbone-eligible, the function raises
     `NoBackboneRoomError` instead of silently falling back to
     something arbitrary.

Two things called out in the .md as still open (section 13) are kept as
clearly-marked, easily-editable constants rather than hardcoded logic:
  - ROOM_ENDPOINT_RULES (endpoint-per-room-type estimation numbers)
  - Candidate-switch-point grid density inside large rooms
Tune them freely without touching the solver logic.

Third-party dependency: `pip install ortools` (Google OR-Tools' CP-SAT
solver is used to solve the facility-location ILP exactly, rather than
approximating it with a genetic algorithm).
"""

import json
import math
import re
from collections import defaultdict

from shapely.geometry import Polygon, Point
from shapely.ops import nearest_points

from ortools.sat.python import cp_model


# ============================================================
# Errors
# ============================================================

class NoBackboneRoomError(Exception):
    """
    Raised when the floor plan contains no room eligible to host the
    network backbone (Router / Firewall / Core Switch / Server / DNS).

    Per the agreed design there is NO automatic fallback: the caller
    (Laravel) must prompt the user to pick a room manually.
    """
    pass


# ============================================================
# Room categories & eligibility rules
# ============================================================

# Rooms allowed to host the backbone (Router/Firewall/Core Switch/
# Server/DNS). None of them is *required* to have one -- the floor just
# needs at least one such room somewhere.
BACKBONE_ELIGIBLE_TYPES = {
    'Security',
    'Administrative Office',
    'dr.office',
    'Server Room',
}

# Rooms where NO network device of any kind is allowed (not even a
# camera or an access switch passing through).
NO_DEVICE_TYPES = {
    'WC',
    'Cafe',
    'Other',
}

# Rooms where only a camera is allowed (no endpoints, no switches).
CAMERA_ONLY_TYPES = {
    'Lobby',
}

# Preference order when several backbone-eligible rooms exist on the
# same floor (lower number = preferred). This ordering is our own
# reasonable default -- the .md agreed on the eligible *set*, not on a
# priority order between its members, so feel free to tune this list.
BACKBONE_ROOM_PRIORITY = {
    'Server Room': 0,
    'Security': 1,
    'Administrative Office': 2,
    'dr.office': 3,
}


# ============================================================
# VLAN definitions
# ============================================================

VLANS = {
    'vlan_10': {
        'id': 10,
        'name': 'Management',
        'subnet': '192.168.10.0/24',
        'devices': ['Router', 'Firewall', 'Proxy', 'Modem', 'Core Switch', 'Switch', 'Server', 'DNS', 'DHCP', 'UPS'],
    },
    'vlan_20': {
        'id': 20,
        'name': 'Staff',
        'subnet': '192.168.20.0/24',
        'devices': ['Administrative Office', 'Secretary', 'dr.office'],
    },
    'vlan_30': {
        'id': 30,
        'name': 'Academics',
        'subnet': '192.168.30.0/24',
        'devices': ['Laboratory', 'Classroom', 'Library', 'Meeting Room'],
    },
    'vlan_50': {
        'id': 50,
        'name': 'Security',
        'subnet': '192.168.50.0/24',
        'devices': ['Camera', 'NVR', 'Security', 'Lobby'],
    },
}


def get_vlan_for_room(room_type):
    """VLAN for an Endpoint that lives in a given room type."""
    if room_type == 'Security':
        return VLANS['vlan_50']
    if room_type in ('Laboratory', 'Classroom', 'Library', 'Meeting Room'):
        return VLANS['vlan_30']
    if room_type in ('Administrative Office', 'Secretary', 'dr.office'):
        return VLANS['vlan_20']
    if room_type == 'Server Room':
        return VLANS['vlan_10']
    return VLANS['vlan_20']


def get_vlan_for_device(device_type):
    if device_type in ('Router', 'Firewall', 'Proxy', 'Modem', 'Switch', 'Core Switch', 'Server', 'DNS', 'DHCP', 'UPS'):
        return VLANS['vlan_10']
    if device_type in ('Camera', 'NVR'):
        return VLANS['vlan_50']
    return VLANS['vlan_20']


# ============================================================
# Scale handling (unchanged from the original file)
# ============================================================

def parse_drawing_scale(drawing_scale):
    """Accept 100, '100', '1:100', or '1 / 100'."""
    if drawing_scale is None:
        return None

    if isinstance(drawing_scale, (int, float)):
        denominator = float(drawing_scale)
    else:
        text = str(drawing_scale).strip().lower()
        match = re.fullmatch(r'(?:1\s*[:/]\s*)?(\d+(?:\.\d+)?)', text)
        if not match:
            raise ValueError(
                "drawing_scale must look like 100, '100', '1:100', or '1/100'."
            )
        denominator = float(match.group(1))

    if denominator <= 0:
        raise ValueError('Drawing scale denominator must be > 0.')

    return denominator


def compute_scale_from_drawing_scale(drawing_scale, dpi):
    """Compute meters per original pixel from a physical drawing scale and DPI."""
    denominator = parse_drawing_scale(drawing_scale)

    if dpi is None or dpi <= 0:
        raise ValueError('dpi must be a positive number when using drawing_scale.')

    real_m_per_paper_cm = denominator / 100.0
    pixels_per_paper_cm = dpi / 2.54

    return real_m_per_paper_cm / pixels_per_paper_cm


def resolve_meters_per_pixel(
    scale=None,
    drawing_scale=None,
    dpi=None,
    source_width_px=None,
    processed_width_px=512,
    meters_per_pixel=None,
):
    """
    Resolve meters/pixel for the CURRENT processed image.

    Priority:
    1. meters_per_pixel: explicit and safest.
    2. drawing_scale + dpi + source_width_px + processed_width_px.
    3. drawing_scale + dpi (only if the processed image itself is at that DPI).
    4. legacy scale parameter.
    """

    if meters_per_pixel is not None:
        mpp = float(meters_per_pixel)
        if mpp <= 0:
            raise ValueError('meters_per_pixel must be > 0.')
        return mpp

    if drawing_scale is not None:
        original_mpp = compute_scale_from_drawing_scale(drawing_scale, dpi)

        if source_width_px is not None:
            if processed_width_px is None or processed_width_px <= 0:
                raise ValueError('processed_width_px must be > 0.')

            return original_mpp * (float(source_width_px) / float(processed_width_px))

        return original_mpp

    if scale is not None:
        mpp = float(scale)
        if mpp <= 0:
            raise ValueError('scale must be > 0.')
        return mpp

    raise ValueError(
        'Provide one of: meters_per_pixel, drawing_scale+dpi, or scale.'
    )


# ============================================================
# Geometry helpers (unchanged from the original file)
# ============================================================

def polygon_area(corners):
    """Area in pixel^2 using the Shoelace Formula."""
    if len(corners) < 3:
        return 0.0

    area = 0.0
    n = len(corners)

    for i in range(n):
        x1 = float(corners[i]['x'])
        y1 = float(corners[i]['y'])
        x2 = float(corners[(i + 1) % n]['x'])
        y2 = float(corners[(i + 1) % n]['y'])
        area += x1 * y2 - x2 * y1

    return abs(area) / 2.0


def normalize_type(raw):
    """Normalize exactly the room categories used by the project."""
    t = str(raw).lower().strip()

    if t in ('lab', 'labs', 'laboratory', 'laboratories'):
        return 'Laboratory'
    if t in ('class', 'classroom', 'classrooms'):
        return 'Classroom'
    if t in ('administrative office', 'admin office', 'administration'):
        return 'Administrative Office'
    if t in ('secretary', 'secretary office', 'secretarial'):
        return 'Secretary'
    if t in ('cafe', 'cafeteria', 'café'):
        return 'Cafe'
    if t in ('lobby',):
        return 'Lobby'
    if t in ('dr.office', 'dr office', "doctor's office", 'doctor office'):
        return 'dr.office'
    if t in ('library', 'libraries'):
        return 'Library'
    if t in ('meeting room', 'meeting', 'conference', 'conference room'):
        return 'Meeting Room'
    if t in ('security', 'security room', 'guard'):
        return 'Security'
    if t in ('wc', 'bathroom', 'toilet', 'restroom'):
        return 'WC'
    if t in ('server room', 'server', 'serverroom', 'data room', 'datacenter'):
        return 'Server Room'

    return 'Other'


def build_room_polygon(corners):
    if not corners or len(corners) < 3:
        return None

    points = [(float(c['x']), float(c['y'])) for c in corners]

    try:
        polygon = Polygon(points)

        if not polygon.is_valid:
            polygon = polygon.buffer(0)

        if polygon.is_empty:
            return None

        return polygon

    except Exception:
        return None


def safe_covers(geometry, point):
    if geometry is None or geometry.is_empty:
        return False

    try:
        return geometry.covers(point)
    except Exception:
        return False


def nearest_valid_point(geometry, point):
    if geometry is None or geometry.is_empty:
        return None

    if safe_covers(geometry, point):
        return Point(point.x, point.y)

    try:
        nearest_geom, _ = nearest_points(geometry, point)
        return nearest_geom
    except Exception:
        try:
            return geometry.representative_point()
        except Exception:
            return None


def choose_valid_position(
    region,
    preferred_x,
    preferred_y,
    candidate_offsets=None,
    used_points=None,
    min_separation=0.0,
):
    """Choose a valid point inside region, preferably near preferred location."""

    if region is None or region.is_empty:
        return float(preferred_x), float(preferred_y)

    if candidate_offsets is None:
        candidate_offsets = [
            (0, 0),
            (10, 0), (-10, 0), (0, 10), (0, -10),
            (20, 0), (-20, 0), (0, 20), (0, -20),
            (15, 15), (-15, 15), (15, -15), (-15, -15),
            (30, 0), (-30, 0), (0, 30), (0, -30),
        ]

    used_points = used_points or []

    def acceptable(point):
        if not safe_covers(region, point):
            return False
        if min_separation <= 0:
            return True
        return all(point.distance(other) >= min_separation for other in used_points)

    for dx, dy in candidate_offsets:
        candidate = Point(float(preferred_x + dx), float(preferred_y + dy))
        if acceptable(candidate):
            return candidate.x, candidate.y

    preferred_point = Point(float(preferred_x), float(preferred_y))
    nearest = nearest_valid_point(region, preferred_point)

    if nearest is not None and acceptable(nearest):
        return nearest.x, nearest.y

    representative = region.representative_point()
    return representative.x, representative.y


def random_point_inside_polygon(polygon, center=None, radius=20.0, max_attempts=100):
    """Return a pseudo-random-ish valid point inside a room polygon."""
    import random as _random

    if polygon is None or polygon.is_empty:
        if center is not None:
            return float(center[0]), float(center[1])
        return 0.0, 0.0

    if center is None:
        rep = polygon.representative_point()
        center = (rep.x, rep.y)

    cx, cy = center

    for _ in range(max_attempts):
        x = cx + _random.uniform(-radius, radius)
        y = cy + _random.uniform(-radius, radius)
        candidate = Point(x, y)
        if safe_covers(polygon, candidate):
            return x, y

    minx, miny, maxx, maxy = polygon.bounds

    for _ in range(max_attempts):
        x = _random.uniform(minx, maxx)
        y = _random.uniform(miny, maxy)
        candidate = Point(x, y)
        if safe_covers(polygon, candidate):
            return x, y

    rep = polygon.representative_point()
    return rep.x, rep.y


def distribute_points_in_region(region, count, preferred_point, min_separation=5.0):
    """
    Return up to `count` well-separated points inside `region`, spread
    out via greedy farthest-point selection over a background grid.

    Reused for two different purposes in this file:
      - generating several candidate switch sites inside one large room
      - spreading individual endpoint markers inside a room
    """
    if count <= 0:
        return []

    if region is None or region.is_empty:
        return [(preferred_point.x, preferred_point.y) for _ in range(count)]

    minx, miny, maxx, maxy = region.bounds

    candidates = []
    grid_n = max(5, int(math.ceil(math.sqrt(count) * 4)))

    for gx in range(grid_n):
        for gy in range(grid_n):
            x = minx + (gx + 0.5) * (maxx - minx) / grid_n
            y = miny + (gy + 0.5) * (maxy - miny) / grid_n
            p = Point(x, y)
            if safe_covers(region, p):
                candidates.append(p)

    candidates.append(region.representative_point())

    nearest = nearest_valid_point(region, preferred_point)
    if nearest is not None:
        candidates.append(nearest)

    chosen = []

    while candidates and len(chosen) < count:
        if not chosen:
            candidate = min(candidates, key=lambda p: p.distance(preferred_point))
        else:
            candidate = max(candidates, key=lambda p: min(p.distance(c) for c in chosen))

        if not chosen or all(candidate.distance(c) >= min_separation for c in chosen):
            chosen.append(candidate)

        candidates.remove(candidate)

    while len(chosen) < count:
        chosen.append(region.representative_point())

    return [(float(p.x), float(p.y)) for p in chosen]


# ============================================================
# Room loading
# ============================================================

def load_rooms_from_list(rooms):
    ids = []
    centers = []
    types = []
    areas = []
    corners_list = []
    polygons = []

    for r in rooms:
        rid = r.get('id') or r.get('room_id')
        if rid is None:
            raise ValueError("Room missing 'id' or 'room_id'.")

        ids.append(rid)

        center = r.get('center', {})
        centers.append([float(center.get('x', 0)), float(center.get('y', 0))])

        raw_type = r.get('type', 'other')
        types.append(normalize_type(raw_type))

        corners = r.get('corners', [])
        corners_list.append(corners)
        areas.append(polygon_area(corners))
        polygons.append(build_room_polygon(corners))

    return ids, centers, types, areas, corners_list, polygons


# ============================================================
# Endpoint estimation
# ------------------------------------------------------------
# STILL OPEN (see .md section 13): these numbers are a placeholder
# translation of the interim table agreed in section 4. Tune freely --
# nothing else in the file depends on the exact numbers, only on the
# shape of `estimate_endpoints()`'s output (a non-negative int).
# ============================================================

ROOM_ENDPOINT_RULES = {
    # Computer lab: high density, ~1 endpoint per 3-4 m^2.
    'Laboratory': {'base': 0, 'area_per_unit': 3.5, 'max_endpoints': 40},
    # 1 fixed (projector/teacher station) + 1 per ~25-30 m^2 beyond that.
    'Classroom': {'base': 1, 'extra_area_per_unit': 27.5, 'max_endpoints': 12},
    'Administrative Office': {'base': 0, 'area_per_unit': 9.0, 'max_endpoints': 10},
    'Secretary': {'base': 0, 'area_per_unit': 9.0, 'max_endpoints': 8},
    'dr.office': {'base': 0, 'area_per_unit': 9.0, 'max_endpoints': 6},
    'Library': {'base': 2, 'extra_area_per_unit': 40.0, 'max_endpoints': 10},
    'Meeting Room': {'base': 1, 'extra_area_per_unit': 30.0, 'max_endpoints': 6},
    'Security': {'base': 1, 'max_endpoints': 2},        # monitoring workstation(s)
    'Server Room': {'base': 1, 'max_endpoints': 1},     # management port
    'Lobby': {'base': 0, 'max_endpoints': 0},           # cameras only
    'Cafe': {'base': 0, 'max_endpoints': 0},            # no device at all
    'WC': {'base': 0, 'max_endpoints': 0},              # no device at all
    'Other': {'base': 0, 'area_per_unit': 20.0, 'max_endpoints': 5},
}


def estimate_endpoints(room_type, area_pixels, scale):
    """Estimate wired endpoints from physical area and room type."""

    if room_type in NO_DEVICE_TYPES or room_type in CAMERA_ONLY_TYPES:
        return 0

    rule = ROOM_ENDPOINT_RULES.get(room_type, ROOM_ENDPOINT_RULES['Other'])
    area_m2 = max(0.0, float(area_pixels) * (scale ** 2))
    maximum = rule['max_endpoints']

    if maximum == 0:
        return 0

    if 'area_per_unit' in rule:
        # Pure density model: total endpoints scale with room area.
        count = math.ceil(area_m2 / rule['area_per_unit'])
        count = max(1, count)
    else:
        # Fixed base + extra endpoints for large rooms.
        base = rule.get('base', 0)
        extra_unit = rule.get('extra_area_per_unit')
        extra = math.floor(area_m2 / extra_unit) if extra_unit else 0
        count = base + extra
        count = max(base, count) if base > 0 else max(0, count)

    return int(min(maximum, count))


# ============================================================
# Backbone room selection (deterministic, not part of the ILP)
# ============================================================

def choose_backbone_room(room_ids, room_types, polygons, room_centers):
    """
    Deterministically pick which BACKBONE_ELIGIBLE_TYPES room hosts the
    Router/Firewall/Core Switch/Server/DNS, using BACKBONE_ROOM_PRIORITY
    and, as a tiebreaker, the largest available room of that type.

    Raises NoBackboneRoomError if no eligible room exists anywhere on
    the floor -- per the agreed design there is NO automatic fallback.
    """
    candidates = []

    for idx, room_type in enumerate(room_types):
        if room_type not in BACKBONE_ELIGIBLE_TYPES:
            continue

        polygon = polygons[idx]
        area = polygon.area if polygon is not None and not polygon.is_empty else 0.0
        priority = BACKBONE_ROOM_PRIORITY.get(room_type, 99)
        candidates.append((priority, -area, idx))

    if not candidates:
        raise NoBackboneRoomError(
            'No room on this floor is eligible to host the network backbone '
            f'(eligible types: {sorted(BACKBONE_ELIGIBLE_TYPES)}). '
            'Ask the user to pick a room manually.'
        )

    candidates.sort()
    _, _, idx = candidates[0]

    return idx, room_ids[idx], polygons[idx], room_centers[idx]


# ============================================================
# Candidate switch sites
# ------------------------------------------------------------
# STILL OPEN (see .md section 13): grid density inside large rooms.
# GRID_CELL_AREA_M2 controls how many candidate points a large room
# gets (roughly one candidate per that many m^2). Tune freely.
# ============================================================

GRID_CELL_AREA_M2 = 40.0
MAX_CANDIDATES_PER_ROOM = 6
MAX_CABLE_DISTANCE_M = 90.0  # TIA/EIA-568 practical limit


def switch_eligible(room_type):
    return room_type not in NO_DEVICE_TYPES and room_type not in CAMERA_ONLY_TYPES


def generate_switch_candidates(room_ids, room_types, polygons, room_centers, room_areas, scale):
    """
    For every room that may host a switch, generate one or more
    candidate (x, y) points in pixel space. Small rooms get a single
    point near their center; large rooms get several spread-out points
    so the solver can open more than one switch inside them if needed.

    Returns a list of dicts: {site_id, room_id, room_idx, x, y}
    """
    sites = []
    site_id = 0

    for idx, room_id in enumerate(room_ids):
        room_type = room_types[idx]

        if not switch_eligible(room_type):
            continue

        polygon = polygons[idx]
        cx, cy = room_centers[idx]
        area_m2 = max(0.0, room_areas[idx] * (scale ** 2))

        num_candidates = max(1, math.ceil(area_m2 / GRID_CELL_AREA_M2))
        num_candidates = min(MAX_CANDIDATES_PER_ROOM, num_candidates)

        if num_candidates == 1:
            if polygon is not None and not polygon.is_empty:
                x, y = choose_valid_position(polygon, cx, cy)
            else:
                x, y = cx, cy
            points = [(x, y)]
        else:
            points = distribute_points_in_region(
                polygon, num_candidates, Point(cx, cy), min_separation=8.0
            )

        for x, y in points:
            sites.append({
                'site_id': site_id,
                'room_id': room_id,
                'room_idx': idx,
                'x': x,
                'y': y,
            })
            site_id += 1

    return sites


# ============================================================
# Demand points (endpoints + cameras that need a switch)
# ============================================================

def generate_demand_points(room_ids, room_types, polygons, room_centers, room_areas, scale):
    """
    Returns a list of demand-point dicts, one per Endpoint and one per
    Camera, each needing exactly one access-switch connection:
      {demand_id, kind ('Endpoint'|'Camera'), room_id, room_type, x, y, vlan}

    Camera placement note (not spelled out in the .md, kept simple by
    design): one camera per room, except rooms in NO_DEVICE_TYPES
    (WC/Cafe) which get no device of any kind at all.
    """
    demands = []
    demand_id = 0

    for idx, room_id in enumerate(room_ids):
        room_type = room_types[idx]
        polygon = polygons[idx]
        cx, cy = room_centers[idx]

        if room_type not in NO_DEVICE_TYPES:
            n_endpoints = estimate_endpoints(room_type, room_areas[idx], scale)
            used_points = []

            for ep in range(n_endpoints):
                x, y = random_point_inside_polygon(polygon, center=(cx, cy), radius=10.0)
                point = Point(x, y)

                attempts = 0
                while any(point.distance(q) < 3.0 for q in used_points) and attempts < 50:
                    x, y = random_point_inside_polygon(polygon, center=(cx, cy), radius=15.0)
                    point = Point(x, y)
                    attempts += 1

                used_points.append(point)

                demands.append({
                    'demand_id': demand_id,
                    'kind': 'Endpoint',
                    'room_id': room_id,
                    'room_type': room_type,
                    'x': float(x),
                    'y': float(y),
                    'vlan': get_vlan_for_room(room_type),
                })
                demand_id += 1

            # One camera per room, except where devices are forbidden.
            cam_x, cam_y = choose_valid_position(
                polygon, cx, cy,
                candidate_offsets=[(0, 0), (15, -15), (-15, -15), (15, 15), (-15, 15)],
            ) if polygon is not None and not polygon.is_empty else (cx, cy)

            demands.append({
                'demand_id': demand_id,
                'kind': 'Camera',
                'room_id': room_id,
                'room_type': room_type,
                'x': float(cam_x),
                'y': float(cam_y),
                'vlan': VLANS['vlan_50'],
            })
            demand_id += 1

    return demands


# ============================================================
# Facility-Location ILP (replaces AgglomerativeClustering + GA)
# ============================================================

# Usable data ports on the largest standard access switch, after
# reserving one port for the Core uplink.
SWITCH_MAX_USABLE_PORTS = 47

# Cost weights for the fitness/objective function (.md section 7).
# All distances are converted to centimeters (integers) for CP-SAT.
COST_PER_CM_ENDPOINT_CABLE = 1
COST_PER_CM_UPLINK_CABLE = 1
COST_PER_OPEN_SWITCH = 30_000        # cm-equivalent "setup cost"
COST_PER_WASTED_PORT = 200           # cm-equivalent, light penalty


def manhattan_cm(ax, ay, bx, by, scale):
    """Manhattan distance between two pixel points, in centimeters."""
    dx = abs(ax - bx) * scale * 100.0
    dy = abs(ay - by) * scale * 100.0
    return dx + dy


def solve_facility_location(demands, sites, core_point, scale, time_limit_s=30.0):
    """
    Solve the Capacitated Facility Location Problem with CP-SAT:
      - every demand point is assigned to exactly one OPEN switch site
        that is within MAX_CABLE_DISTANCE_M of it (hard constraint --
        infeasible assignments are never even offered to the solver,
        so there is no need for a soft "distance penalty" the way the
        GA needed one)
      - an open site may not carry more load than SWITCH_MAX_USABLE_PORTS
      - objective: endpoint/camera cable cost + switch->core uplink
        cost + per-switch setup cost + a light wasted-port penalty

    Returns (open_site_ids, assignment) where assignment maps
    demand_id -> site_id.
    """
    model = cp_model.CpModel()

    max_cm = MAX_CABLE_DISTANCE_M * 100.0

    # Precompute allowed (demand, site) pairs within cable range.
    allowed_pairs = defaultdict(list)   # demand_id -> [(site_id, dist_cm), ...]
    site_ids_in_range = set()

    for d in demands:
        for s in sites:
            dist_cm = manhattan_cm(d['x'], d['y'], s['x'], s['y'], scale)
            if dist_cm <= max_cm:
                allowed_pairs[d['demand_id']].append((s['site_id'], dist_cm))
                site_ids_in_range.add(s['site_id'])

    missing = [d['demand_id'] for d in demands if not allowed_pairs.get(d['demand_id'])]
    if missing:
        # Should not happen because every room gets at least one of its
        # own candidate switch sites, but fail loudly instead of
        # silently dropping devices if it ever does.
        raise RuntimeError(
            f'{len(missing)} demand point(s) have no switch candidate within '
            f'{MAX_CABLE_DISTANCE_M} m. Check candidate-site generation for '
            f'their room(s).'
        )

    site_by_id = {s['site_id']: s for s in sites}

    open_var = {}
    for site_id in site_ids_in_range:
        open_var[site_id] = model.NewBoolVar(f'open_s{site_id}')

    assign_var = {}
    for d in demands:
        for site_id, _dist_cm in allowed_pairs[d['demand_id']]:
            assign_var[(d['demand_id'], site_id)] = model.NewBoolVar(
                f'assign_d{d["demand_id"]}_s{site_id}'
            )

    # Each demand point connects to exactly one switch.
    for d in demands:
        model.Add(
            sum(
                assign_var[(d['demand_id'], site_id)]
                for site_id, _ in allowed_pairs[d['demand_id']]
            ) == 1
        )

    # A demand can only be assigned to an open switch.
    for d in demands:
        for site_id, _ in allowed_pairs[d['demand_id']]:
            model.Add(assign_var[(d['demand_id'], site_id)] <= open_var[site_id])

    # Capacity per open switch.
    for site_id in site_ids_in_range:
        load_terms = [
            assign_var[(d['demand_id'], site_id)]
            for d in demands
            if (d['demand_id'], site_id) in assign_var
        ]
        model.Add(sum(load_terms) <= SWITCH_MAX_USABLE_PORTS)

    # ---- Objective ----
    objective_terms = []

    # 1) Endpoint/Camera -> Switch cable cost.
    for d in demands:
        for site_id, dist_cm in allowed_pairs[d['demand_id']]:
            coeff = int(round(dist_cm * COST_PER_CM_ENDPOINT_CABLE))
            objective_terms.append(coeff * assign_var[(d['demand_id'], site_id)])

    # 2) Switch -> Core uplink cost + 3) per-open-switch setup cost.
    for site_id in site_ids_in_range:
        site = site_by_id[site_id]
        uplink_cm = manhattan_cm(site['x'], site['y'], core_point[0], core_point[1], scale)
        uplink_coeff = int(round(uplink_cm * COST_PER_CM_UPLINK_CABLE))
        objective_terms.append(uplink_coeff * open_var[site_id])
        objective_terms.append(COST_PER_OPEN_SWITCH * open_var[site_id])

    # 4) Wasted-port penalty: SWITCH_MAX_USABLE_PORTS * open - actual_load.
    for site_id in site_ids_in_range:
        load_terms = [
            assign_var[(d['demand_id'], site_id)]
            for d in demands
            if (d['demand_id'], site_id) in assign_var
        ]
        waste_expr = SWITCH_MAX_USABLE_PORTS * open_var[site_id] - sum(load_terms)
        objective_terms.append(COST_PER_WASTED_PORT * waste_expr)

    model.Minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_search_workers = 8

    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(
            f'Facility-location solver returned no usable solution (status={status}).'
        )

    open_site_ids = [
        site_id for site_id, var in open_var.items()
        if solver.Value(var) == 1
    ]

    assignment = {}
    for d in demands:
        for site_id, _ in allowed_pairs[d['demand_id']]:
            key = (d['demand_id'], site_id)
            if key in assign_var and solver.Value(assign_var[key]) == 1:
                assignment[d['demand_id']] = site_id
                break

    return open_site_ids, assignment


# ============================================================
# Device generation
# ============================================================

def size_switch_ports(load):
    """Smallest standard switch size (24 or 48) that fits `load` + uplink + 10% spare.

    Kept as-is: still used for Core Switch port sizing, unrelated to
    the per-site access-switch optimization below.
    """
    required = math.ceil((load + 1) * 1.10)  # +1 reserved uplink port, +10% spare
    if required <= 24:
        return 24
    return 48


# ============================================================
# Multi-type access switch selection & in-room placement (GA)
# ------------------------------------------------------------
# The facility-location ILP above assigns every open site the SAME
# capacity/cost while deciding WHERE to open switches. Only after
# solving does the old `size_switch_ports()` pick a real hardware size
# (24 or 48) from whatever load happened to land on that site -- as a
# single switch.
#
# That leaves real savings on the table. Example: 60 endpoints landing
# on one open site could become 2x48-port switches (minimum possible
# switch count), or 3x24-port switches, or anything in between once
# more catalog sizes are available (8/16-port, etc.), each with a
# different total hardware cost AND a different total cable length
# once the room's demand points are actually split between several
# switch positions instead of one.
#
# So for every open site we now ask three questions together:
#   1) how many physical switches does this load need at minimum /
#      maximum (switch_count_bounds), given the switch catalog?
#   2) which catalog type should each one be?
#   3) if more than one, where inside the room should each one
#      physically sit to minimize total cable length?
# A Genetic Algorithm searches (2) and (3) jointly for every switch
# count in the range from (1), and keeps the cheapest feasible result.
# ============================================================

SWITCH_CATALOG = [
    # (usable_ports, price) -- smaller port count = cheaper, matching
    # the standard market pricing curve (placeholder prices; swap in
    # real vendor quotes whenever available, nothing else changes).
    (8, 80),
    (16, 140),
    (24, 190),
    (48, 340),
]


def _switch_usable_capacity(ports):
    """Ports actually usable for demand devices, after the reserved
    uplink port and the same 10% spare margin `size_switch_ports`
    already uses elsewhere in this file."""
    raw = ports - 1  # 1 port reserved for the uplink to Core
    return max(0, math.floor(raw / 1.10))


_SWITCH_CAPACITY = {ports: _switch_usable_capacity(ports) for ports, _ in SWITCH_CATALOG}
_MAX_SWITCH_CAPACITY = max(_SWITCH_CAPACITY.values())
_MIN_SWITCH_CAPACITY = min(c for c in _SWITCH_CAPACITY.values() if c > 0)


def switch_count_bounds(load):
    """
    Minimum and maximum number of physical switches a given load could
    plausibly need:
      - minimum: using only the biggest catalog switch (48-port)
      - maximum: using only the smallest catalog switch (8-port)
    e.g. load=60 -> min 2 (2x48-port), max 8 (8x8-port). The GA below
    searches this whole range for the actual cheapest combination.
    """
    if load <= 0:
        return 0, 0
    min_k = max(1, math.ceil(load / _MAX_SWITCH_CAPACITY))
    max_k = max(1, math.ceil(load / _MIN_SWITCH_CAPACITY))
    max_k = min(max_k, load)  # never more switches than devices to serve
    return min_k, max_k


def _combo_hardware_cost(ports_list):
    price_by_ports = dict(SWITCH_CATALOG)
    return sum(price_by_ports[p] for p in ports_list)


def _combo_capacity(ports_list):
    return sum(_SWITCH_CAPACITY[p] for p in ports_list)


def choose_switch_configuration(
    site, load, demand_points, core_point, scale,
    region_polygon=None,
    pop=24, gens=30, mut=0.2, seed=42,
):
    """
    Genetic algorithm: decide how many access switches this site's
    load needs, which catalog type each one is, and (when there is
    more than one) where inside the room each one should physically
    sit, to minimize hardware + endpoint-cable + uplink cost together.

    demand_points: [(demand_id, x, y), ...] the ILP already assigned
                   to this site.
    Returns (switches, demand_to_local_index):
      switches: [{'x','y','ports','assigned_load'}, ...]
      demand_to_local_index: demand_id -> index into `switches`
    """
    import random as _random
    rng = _random.Random(seed)

    if load <= 0:
        return [], {}

    min_k, max_k = switch_count_bounds(load)
    ports_options = [p for p, _ in SWITCH_CATALOG]

    def random_combo():
        k = rng.randint(min_k, max_k)
        return [rng.choice(ports_options) for _ in range(k)]

    def positions_for_combo(k):
        """k spread-out candidate positions inside the room (reuses
        the same farthest-point spreading already used elsewhere in
        this file for candidate switch sites / endpoint placement)."""
        if k <= 1:
            return [(site['x'], site['y'])]
        preferred = Point(site['x'], site['y'])
        if region_polygon is not None and not region_polygon.is_empty:
            return distribute_points_in_region(region_polygon, k, preferred, min_separation=8.0)
        return [(site['x'], site['y'])] * k

    def decode(combo):
        k = len(combo)
        if _combo_capacity(combo) < load:
            return None  # infeasible: not enough total capacity

        positions = positions_for_combo(k)
        sub_load = [0] * k
        sub_demand_ids = [[] for _ in range(k)]
        cable_cm = 0.0

        # Partition demands to their nearest switch position that
        # still has spare capacity (greedy nearest-feasible).
        for demand_id, dx, dy in demand_points:
            order = sorted(
                range(k),
                key=lambda i: manhattan_cm(dx, dy, positions[i][0], positions[i][1], scale),
            )
            placed = False
            for i in order:
                if sub_load[i] < _SWITCH_CAPACITY[combo[i]]:
                    sub_load[i] += 1
                    sub_demand_ids[i].append(demand_id)
                    cable_cm += manhattan_cm(dx, dy, positions[i][0], positions[i][1], scale)
                    placed = True
                    break
            if not placed:
                return None  # this combo/partition can't actually fit everyone

        uplink_cm = sum(
            manhattan_cm(positions[i][0], positions[i][1], core_point[0], core_point[1], scale)
            for i in range(k)
        )
        hw_cost_cm_equiv = _combo_hardware_cost(combo) * 100.0  # same cm-cost scale as cabling

        total_cost = hw_cost_cm_equiv + cable_cm + uplink_cm
        return total_cost, positions, sub_load, sub_demand_ids

    def fitness(combo):
        decoded = decode(combo)
        return decoded[0] if decoded is not None else float('inf')

    population = [random_combo() for _ in range(pop)]
    best_combo, best_fit = None, float('inf')

    for _ in range(gens):
        fits = [fitness(c) for c in population]
        gen_best = min(range(len(population)), key=lambda i: fits[i])
        if fits[gen_best] < best_fit:
            best_fit = fits[gen_best]
            best_combo = population[gen_best][:]

        ranked = sorted(range(len(population)), key=lambda i: fits[i])
        elite = [population[i][:] for i in ranked[:4]]
        new_pop = elite[:]

        def tournament():
            cand = rng.sample(list(zip(population, fits)), min(3, len(population)))
            return min(cand, key=lambda x: x[1])[0]

        while len(new_pop) < pop:
            p1, p2 = tournament(), tournament()
            cut = min(len(p1), len(p2))
            point = rng.randint(1, cut) if cut > 1 else 1
            child = p1[:point] + p2[point:]
            if child and rng.random() < mut:
                idx = rng.randrange(len(child))
                child[idx] = rng.choice(ports_options)
            if len(child) < max_k and rng.random() < mut * 0.5:
                child.append(rng.choice(ports_options))
            if len(child) > min_k and rng.random() < mut * 0.5:
                child.pop(rng.randrange(len(child)))
            new_pop.append(child)

        population = new_pop[:pop]

    if best_combo is None:
        best_combo = [ports_options[-1]] * min_k

    decoded = decode(best_combo)
    if decoded is None:
        best_combo = [ports_options[-1]] * max_k
        decoded = decode(best_combo)

    _, positions, sub_load, sub_demand_ids = decoded

    switches = []
    demand_to_local_index = {}
    for i, ports in enumerate(best_combo):
        switches.append({
            'x': positions[i][0], 'y': positions[i][1],
            'ports': ports, 'assigned_load': sub_load[i],
        })
        for demand_id in sub_demand_ids[i]:
            demand_to_local_index[demand_id] = i

    return switches, demand_to_local_index


def generate_devices(
    demands,
    sites,
    open_site_ids,
    assignment,
    backbone_room_id,
    backbone_polygon,
    backbone_center,
    room_types_by_id,
    scale,
    polygon_by_room_id=None,
):
    devices = []
    dev_id = 0
    device_by_demand_id = {}

    site_by_id = {s['site_id']: s for s in sites}

    # --------------------------------------------------------
    # Access switches -- one OR MORE physical switches per open site,
    # sized and positioned by the GA in choose_switch_configuration().
    # switch_device_by_site_id[site_id] is now a LIST (may have more
    # than one entry), and demand_to_switch_device_id maps each demand
    # straight to the exact switch device it connects to (needed
    # because a site's demands may now be split across several
    # physical switches).
    # --------------------------------------------------------
    switch_device_by_site_id = defaultdict(list)
    demand_to_switch_device_id = {}

    demands_by_site = defaultdict(list)
    for d in demands:
        demands_by_site[assignment[d['demand_id']]].append((d['demand_id'], d['x'], d['y']))

    for site_id in open_site_ids:
        site = site_by_id[site_id]
        site_demands = demands_by_site.get(site_id, [])
        load = len(site_demands)

        region_polygon = None
        if polygon_by_room_id is not None:
            region_polygon = polygon_by_room_id.get(site['room_id'])

        switches, demand_to_local_idx = choose_switch_configuration(
            site, load, site_demands, backbone_center, scale,
            region_polygon=region_polygon,
        )

        local_devices = []
        for local_idx, cfg in enumerate(switches):
            unit_note = f", unit {local_idx + 1}/{len(switches)}" if len(switches) > 1 else ''
            sw = {
                'device_id': dev_id,
                'type': 'Switch',
                'room_id': site['room_id'],
                'x': float(cfg['x']),
                'y': float(cfg['y']),
                'ports': cfg['ports'],
                'assigned_load': cfg['assigned_load'],
                'notes': (
                    f"Access Switch (room {site['room_id']}, "
                    f"load {cfg['assigned_load']}/{cfg['ports'] - 1}{unit_note})"
                ),
                'connectivity': 'wired',
                'vlan': VLANS['vlan_10'],
            }
            devices.append(sw)
            switch_device_by_site_id[site_id].append(sw)
            local_devices.append(sw)
            dev_id += 1

        for demand_id, local_idx in demand_to_local_idx.items():
            demand_to_switch_device_id[demand_id] = local_devices[local_idx]['device_id']

    # --------------------------------------------------------
    # Endpoints & Cameras.
    # --------------------------------------------------------
    for d in demands:
        site_id = assignment[d['demand_id']]

        dev = {
            'device_id': dev_id,
            'type': d['kind'],
            'room_id': d['room_id'],
            'x': d['x'],
            'y': d['y'],
            'notes': f"{d['kind']} room {d['room_id']}",
            'connectivity': 'wired',
            'vlan': d['vlan'],
        }
        devices.append(dev)
        device_by_demand_id[d['demand_id']] = dev
        dev_id += 1

    # --------------------------------------------------------
    # Backbone: Core Switch, Router, Firewall, Server, DNS, UPS.
    # Placed inside the chosen backbone room.
    # --------------------------------------------------------
    if backbone_polygon is not None and not backbone_polygon.is_empty:
        region = backbone_polygon
    else:
        region = None

    bx, by = backbone_center
    central_used = []

    def place_central(offset):
        preferred_x = bx + offset[0]
        preferred_y = by + offset[1]
        x, y = choose_valid_position(
            region, preferred_x, preferred_y,
            used_points=central_used, min_separation=5.0,
        )
        central_used.append(Point(x, y))
        return float(x), float(y)

    # Core Switch port sizing: capacity must cover every access-switch
    # uplink plus everything hung directly off the core on its own
    # port (Proxy, Server, DNS, DHCP) -- deterministic, not part of
    # the ILP.
    core_direct_member_count = 4  # Proxy + Server + DNS + DHCP
    total_access_switches = sum(len(v) for v in switch_device_by_site_id.values())
    core_ports = size_switch_ports(total_access_switches + core_direct_member_count)

    core_x, core_y = place_central((0, 0))
    devices.append({
        'device_id': dev_id, 'type': 'Core Switch',
        'room_id': backbone_room_id, 'x': core_x, 'y': core_y, 'ports': core_ports,
        'notes': 'Core Switch', 'connectivity': 'wired', 'vlan': VLANS['vlan_10'],
    })
    core_sw_id = dev_id
    dev_id += 1

    # Internet-gateway chain: Core Switch -- Proxy -- Firewall --
    # Router -- Modem. Each hop is a single point-to-point link, so
    # every device in the chain only needs 2 ports (uplink + downlink).
    proxy_x, proxy_y = place_central((6, 0))
    devices.append({
        'device_id': dev_id, 'type': 'Proxy', 'room_id': backbone_room_id,
        'x': proxy_x, 'y': proxy_y, 'ports': 2,
        'notes': 'Proxy (Core Switch <-> Firewall)', 'connectivity': 'wired',
        'vlan': VLANS['vlan_10'],
    })
    proxy_id = dev_id
    dev_id += 1

    firewall_x, firewall_y = place_central((12, 0))
    devices.append({
        'device_id': dev_id, 'type': 'Firewall', 'room_id': backbone_room_id,
        'x': firewall_x, 'y': firewall_y, 'ports': 2,
        'notes': 'Main Firewall', 'connectivity': 'wired', 'vlan': VLANS['vlan_10'],
    })
    firewall_id = dev_id
    dev_id += 1

    router_x, router_y = place_central((18, 0))
    devices.append({
        'device_id': dev_id, 'type': 'Router', 'room_id': backbone_room_id,
        'x': router_x, 'y': router_y, 'ports': 2,
        'notes': 'Main Router', 'connectivity': 'wired', 'vlan': VLANS['vlan_10'],
    })
    router_id = dev_id
    dev_id += 1

    modem_x, modem_y = place_central((24, 0))
    devices.append({
        'device_id': dev_id, 'type': 'Modem', 'room_id': backbone_room_id,
        'x': modem_x, 'y': modem_y, 'ports': 1,
        'notes': 'ISP Modem', 'connectivity': 'wired', 'vlan': VLANS['vlan_10'],
    })
    modem_id = dev_id
    dev_id += 1

    # Internal services: each hangs directly off the Core Switch, one
    # per port -- not chained behind the Firewall anymore.
    server_x, server_y = place_central((0, 8))
    devices.append({
        'device_id': dev_id, 'type': 'Server', 'role': 'DC', 'room_id': backbone_room_id,
        'x': server_x, 'y': server_y,
        'notes': 'Main Server (Domain Controller)', 'connectivity': 'wired',
        'vlan': VLANS['vlan_10'],
    })
    server_id = dev_id
    dev_id += 1

    dns_x, dns_y = place_central((6, 8))
    devices.append({
        'device_id': dev_id, 'type': 'DNS', 'room_id': backbone_room_id,
        'x': dns_x, 'y': dns_y,
        'notes': 'DNS Server (direct on Core Switch port)',
        'connectivity': 'wired', 'vlan': VLANS['vlan_10'],
    })
    dns_id = dev_id
    dev_id += 1

    dhcp_x, dhcp_y = place_central((12, 8))
    devices.append({
        'device_id': dev_id, 'type': 'DHCP', 'room_id': backbone_room_id,
        'x': dhcp_x, 'y': dhcp_y,
        'notes': 'DHCP Server (direct on Core Switch port)',
        'connectivity': 'wired', 'vlan': VLANS['vlan_10'],
    })
    dhcp_id = dev_id
    dev_id += 1

    ups_x, ups_y = place_central((-8, 0))
    devices.append({
        'device_id': dev_id, 'type': 'UPS', 'room_id': backbone_room_id,
        'x': ups_x, 'y': ups_y, 'capacity_kva': 3.0,
        'protects': [
            core_sw_id, proxy_id, firewall_id, router_id, modem_id,
            server_id, dns_id, dhcp_id,
        ],
        'notes': 'UPS for Core Infrastructure',
        'connectivity': 'wired', 'vlan': VLANS['vlan_10'],
    })
    dev_id += 1

    # --------------------------------------------------------
    # NVR: only if a Security room exists on this floor. Hosted
    # inside Security, on the Camera/Security VLAN, connected like a
    # regular demand point to its nearest open access switch.
    # --------------------------------------------------------
    nvr_device = None
    nvr_nearest_switch_id = None
    security_room_id = next(
        (rid for rid, rtype in room_types_by_id.items() if rtype == 'Security'),
        None,
    )

    if security_room_id is not None:
        # Reuse the Security room's own switch (if it has one) or the
        # nearest open switch overall, same rule as any camera. A site
        # may now host more than one physical switch, so flatten first.
        all_switches = [sw for sw_list in switch_device_by_site_id.values() for sw in sw_list]
        security_switches = [sw for sw in all_switches if sw['room_id'] == security_room_id]
        if not security_switches:
            security_switches = all_switches

        nearest_sw = min(
            security_switches,
            key=lambda sw: manhattan_cm(bx, by, sw['x'], sw['y'], scale),
        ) if security_switches else None

        nvr_x, nvr_y = (nearest_sw['x'] + 3, nearest_sw['y'] + 3) if nearest_sw else (bx, by)

        # NVR device dict only carries fields that belong in the
        # exported schema -- same shape as every other device. The
        # nearest-switch lookup used by build_connections is returned
        # separately below, not smuggled into the dict as a "_private"
        # key (that key was leaking straight into the JSON returned
        # to Laravel, unlike any other device).
        nvr_device = {
            'device_id': dev_id, 'type': 'NVR', 'room_id': security_room_id,
            'x': float(nvr_x), 'y': float(nvr_y),
            'notes': 'NVR (Security room)', 'connectivity': 'wired',
            'vlan': VLANS['vlan_50'],
        }
        nvr_nearest_switch_id = nearest_sw['device_id'] if nearest_sw else None
        devices.append(nvr_device)
        dev_id += 1

    return (
        devices,
        device_by_demand_id,
        switch_device_by_site_id,
        demand_to_switch_device_id,
        core_sw_id,
        proxy_id,
        firewall_id,
        router_id,
        modem_id,
        server_id,
        dns_id,
        dhcp_id,
        nvr_device,
        nvr_nearest_switch_id,
    )


# ============================================================
# Connection builder
# ============================================================

def build_connections(
    demands,
    device_by_demand_id,
    switch_device_by_site_id,
    demand_to_switch_device_id,
    assignment,
    core_sw_id,
    proxy_id,
    firewall_id,
    router_id,
    modem_id,
    server_id,
    dns_id,
    dhcp_id,
    nvr_device,
    nvr_nearest_switch_id,
    devices,
    scale,
):
    connections = []
    devices_by_id = {d['device_id']: d for d in devices}

    # --------------------------------------------------------
    # Endpoint/Camera -> Access Switch (direct, no Outlet in between).
    # --------------------------------------------------------
    for d in demands:
        dev = device_by_demand_id[d['demand_id']]
        sw = devices_by_id[demand_to_switch_device_id[d['demand_id']]]

        dist_m = manhattan_cm(dev['x'], dev['y'], sw['x'], sw['y'], scale) / 100.0

        connections.append({
            'from': dev['device_id'],
            'to': sw['device_id'],
            'type': 'ethernet',
            'distance_m': round(dist_m, 2),
            'medium': 'copper',
        })

    # --------------------------------------------------------
    # NVR -> its nearest access switch.
    # --------------------------------------------------------
    if nvr_device is not None and nvr_nearest_switch_id is not None:
        sw = devices_by_id[nvr_nearest_switch_id]
        dist_m = manhattan_cm(nvr_device['x'], nvr_device['y'], sw['x'], sw['y'], scale) / 100.0
        connections.append({
            'from': nvr_device['device_id'],
            'to': sw['device_id'],
            'type': 'ethernet',
            'distance_m': round(dist_m, 2),
            'medium': 'copper',
        })

    # --------------------------------------------------------
    # Access Switch -> Core Switch (fiber uplink).
    # --------------------------------------------------------
    core_sw = devices_by_id[core_sw_id]

    all_access_switches = [sw for sw_list in switch_device_by_site_id.values() for sw in sw_list]
    for sw in all_access_switches:
        dist_m = manhattan_cm(sw['x'], sw['y'], core_sw['x'], core_sw['y'], scale) / 100.0
        connections.append({
            'from': sw['device_id'],
            'to': core_sw_id,
            'type': 'ethernet_trunk',
            'speed': '10 Gbps',
            'distance_m': round(dist_m, 2),
            'medium': 'fiber',
        })

    # --------------------------------------------------------
    # Internet-gateway chain (each hop is a single point-to-point
    # link): Core Switch -- Proxy -- Firewall -- Router -- Modem.
    # --------------------------------------------------------
    proxy = devices_by_id[proxy_id]
    firewall = devices_by_id[firewall_id]
    router = devices_by_id[router_id]
    modem = devices_by_id[modem_id]

    def backbone_link(a, b, speed='10 Gbps', medium='fiber', ctype='ethernet'):
        dist_m = manhattan_cm(a['x'], a['y'], b['x'], b['y'], scale) / 100.0
        connections.append({
            'from': a['device_id'], 'to': b['device_id'], 'type': ctype,
            'speed': speed, 'distance_m': round(dist_m, 2), 'medium': medium,
        })

    backbone_link(core_sw, proxy)
    backbone_link(proxy, firewall)
    backbone_link(firewall, router)
    backbone_link(router, modem, speed='1 Gbps', medium='copper')  # WAN uplink.

    # --------------------------------------------------------
    # Internal services -- each on its own Core Switch port, not
    # chained behind the Firewall.
    # --------------------------------------------------------
    server = devices_by_id[server_id]
    dns = devices_by_id[dns_id]
    dhcp = devices_by_id[dhcp_id]

    backbone_link(core_sw, server, speed='1 Gbps', medium='copper')
    backbone_link(core_sw, dns, speed='1 Gbps', medium='copper')
    backbone_link(core_sw, dhcp, speed='1 Gbps', medium='copper')

    return connections


# ============================================================
# Main optimizer
# ============================================================

def run_wired_optimizer(
    rooms_list,
    scale=None,
    drawing_scale=None,
    dpi=None,
    source_width_px=None,
    processed_width_px=512,
    meters_per_pixel=None,
    solver_time_limit_s=30.0,
):
    """
    Main public function.

    Raises NoBackboneRoomError if the floor has no room eligible to
    host the backbone -- the caller should surface that to the user
    and ask them to pick a room manually (no automatic fallback, per
    the agreed design).
    """

    physical_scale = resolve_meters_per_pixel(
        scale=scale, drawing_scale=drawing_scale, dpi=dpi,
        source_width_px=source_width_px, processed_width_px=processed_width_px,
        meters_per_pixel=meters_per_pixel,
    )

    ids, centers, types, areas, corners_list, polygons = load_rooms_from_list(rooms_list)

    if not ids:
        return {
            'devices': [], 'connections': [], 'vlans': list(VLANS.values()),
            'metadata': {
                'total_devices': 0, 'total_endpoints': 0,
                'scale_m_per_px': physical_scale, 'solver_objective': 0.0,
            },
        }

    room_types_by_id = {ids[i]: types[i] for i in range(len(ids))}
    polygon_by_room_id = {ids[i]: polygons[i] for i in range(len(ids))}

    # --------------------------------------------------------
    # Backbone room: deterministic pick, raises if none exists.
    # --------------------------------------------------------
    (
        backbone_idx, backbone_room_id, backbone_polygon, backbone_center,
    ) = choose_backbone_room(ids, types, polygons, centers)

    # --------------------------------------------------------
    # Demand points (Endpoints + Cameras) and switch candidate sites.
    # --------------------------------------------------------
    demands = generate_demand_points(ids, types, polygons, centers, areas, physical_scale)
    sites = generate_switch_candidates(ids, types, polygons, centers, areas, physical_scale)

    # --------------------------------------------------------
    # Facility-location ILP (replaces Clustering + GeneticOptimizer).
    # --------------------------------------------------------
    open_site_ids, assignment = solve_facility_location(
        demands, sites, backbone_center, physical_scale,
        time_limit_s=solver_time_limit_s,
    )

    # --------------------------------------------------------
    # Devices & connections.
    # --------------------------------------------------------
    (
        devices, device_by_demand_id, switch_device_by_site_id,
        demand_to_switch_device_id,
        core_sw_id, proxy_id, firewall_id, router_id, modem_id,
        server_id, dns_id, dhcp_id, nvr_device, nvr_nearest_switch_id,
    ) = generate_devices(
        demands, sites, open_site_ids, assignment,
        backbone_room_id, backbone_polygon, backbone_center,
        room_types_by_id, physical_scale,
        polygon_by_room_id=polygon_by_room_id,
    )

    connections = build_connections(
        demands, device_by_demand_id, switch_device_by_site_id,
        demand_to_switch_device_id, assignment,
        core_sw_id, proxy_id, firewall_id, router_id, modem_id,
        server_id, dns_id, dhcp_id, nvr_device, nvr_nearest_switch_id,
        devices, physical_scale,
    )

    return {
        'devices': devices,
        'connections': connections,
        'vlans': list(VLANS.values()),
        'metadata': {
            'total_devices': len(devices),
            'total_endpoints': sum(1 for d in devices if d['type'] == 'Endpoint'),
            'total_cameras': sum(1 for d in devices if d['type'] == 'Camera'),
            'total_access_switches': sum(
                1 for d in devices if d['type'] == 'Switch'
            ),
            'backbone_room_id': backbone_room_id,
            'scale_m_per_px': physical_scale,
            'room_areas_m2': {
                str(ids[i]): round(areas[i] * (physical_scale ** 2), 2)
                for i in range(len(ids))
            },
        },
    }


# ============================================================
# Example
# ============================================================

if __name__ == '__main__':
    # Example usage:
    #
    # try:
    #     result = run_wired_optimizer(
    #         rooms_list,
    #         drawing_scale='1:100',
    #         dpi=96,
    #         source_width_px=2048,
    #         processed_width_px=512,
    #     )
    #     print(json.dumps(result, indent=2, ensure_ascii=False))
    # except NoBackboneRoomError as exc:
    #     print(f'Manual room selection needed: {exc}')
    pass
