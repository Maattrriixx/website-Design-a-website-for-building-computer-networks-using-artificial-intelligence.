

import math
import random
from collections import defaultdict

from corridor_path_finder import CorridorPathFinder


# ------------------------------------------------------------------------------
# Reproducibility (same convention as the original GA)
# ------------------------------------------------------------------------------
RANDOM_SEED = 42
random.seed(RANDOM_SEED)



FORBIDDEN_SWITCH_ROOM_TYPES = {
    'WC', 'Cafe', 'Other',   # NO_DEVICE_TYPES: no device of any kind allowed
    'Lobby',                 # CAMERA_ONLY_TYPES: camera only, no switch
}


class ForbiddenRoomError(Exception):
    """Raised when a candidate switch site sits in a room type where
    switches are explicitly not allowed."""
    pass


def assert_sites_allowed(sites, room_types_by_id=None, forbidden_types=None):
    """
    Fail loudly if any candidate site is in a forbidden room type.

    room_types_by_id: optional {room_id: room_type} map. If not given,
    this only checks sites that carry a 'room_type' key directly
    (skips the check silently for sites with no type info available --
    it cannot invent information the caller didn't provide, but it
    will always catch the case where the info IS available and wrong).
    """
    forbidden = forbidden_types or FORBIDDEN_SWITCH_ROOM_TYPES
    bad = []

    for s in sites:
        room_type = s.get('room_type')
        if room_type is None and room_types_by_id is not None:
            room_type = room_types_by_id.get(s.get('room_id'))
        if room_type is not None and room_type in forbidden:
            bad.append((s['site_id'], s.get('room_id'), room_type))

    if bad:
        details = ', '.join(f"site {sid} (room {rid}, type '{rt}')" for sid, rid, rt in bad)
        raise ForbiddenRoomError(
            f'{len(bad)} candidate switch site(s) fall inside a forbidden '
            f'room type and must never host a switch: {details}'
        )


# ------------------------------------------------------------------------------
# Switch catalog & cost model  -- PLACEHOLDER NUMBERS, tune freely.
#
# Rule agreed with the team: fewer ports = cheaper. Cost is modelled as
# a small fixed "own a switch at all" overhead plus a per-port price,
# so total cost still grows with port count but larger switches are
# cheaper per-port (matches real switch pricing curves).
# ------------------------------------------------------------------------------
SWITCH_CATALOG = [
    # (usable_ports, cost)
    (8,  80),
    (16, 140),
    (24, 190),
    (48, 340),
]

COST_PER_METER_COPPER = 1.0     # endpoint/camera -> access switch
COST_PER_METER_FIBER = 2.5      # access switch -> core switch (uplink)
MAX_CABLE_DISTANCE_M = 90.0     # must match the ILP's TIA/EIA-568 limit
UPLINK_RESERVED_PORTS = 1       # every switch reserves 1 port for its uplink
SPARE_RATIO = 0.10              # 10% spare capacity, same as the ILP


def usable_capacity(ports):
    """Ports actually available for demand devices on a given switch size."""
    raw = ports - UPLINK_RESERVED_PORTS
    return max(0, math.floor(raw / (1.0 + SPARE_RATIO)))


# Precompute for convenience.
SWITCH_CAPACITY = {ports: usable_capacity(ports) for ports, _ in SWITCH_CATALOG}
MAX_SINGLE_SWITCH_CAPACITY = max(SWITCH_CAPACITY.values())


def cheapest_switch_combo(load):
    """
    Cheapest combination of catalog switches (possibly MORE THAN ONE
    physical switch at the same site) that covers `load` demand ports.

    Small exact search (loads are small integers in practice, and the
    catalog is small) -- exact dynamic program over "load units covered".
    Returns (total_cost, [ports, ports, ...]).
    """
    if load <= 0:
        return 0, []

    # DP over units of capacity needed, capped generously.
    cap = load
    INF = float('inf')
    best_cost = [INF] * (cap + 1)
    best_choice = [None] * (cap + 1)
    best_cost[0] = 0

    for units in range(1, cap + 1):
        for ports, price in SWITCH_CATALOG:
            capacity = SWITCH_CAPACITY[ports]
            if capacity <= 0:
                continue
            prev = max(0, units - capacity)
            if best_cost[prev] + price < best_cost[units]:
                best_cost[units] = best_cost[prev] + price
                best_choice[units] = (ports, prev)

    # Reconstruct.
    combo = []
    units = cap
    while units > 0 and best_choice[units] is not None:
        ports, prev = best_choice[units]
        combo.append(ports)
        units = prev

    if units > 0:
        # Load exceeds what any combination could cover (shouldn't
        # happen since the DP always allows repeating the biggest
        # switch) -- fail loudly rather than silently under-provision.
        raise RuntimeError(f'Cannot cover load={load} with the given switch catalog.')

    return best_cost[cap], combo


# ------------------------------------------------------------------------------
# Geometry helper (Manhattan, matches the ILP's convention)
# ------------------------------------------------------------------------------
def manhattan_m(ax, ay, bx, by, scale):
    return (abs(ax - bx) + abs(ay - by)) * scale


# ------------------------------------------------------------------------------
# Genetic Optimizer
#
# Chromosome = one bit per ILP-opened site: keep it open (1) or close
# it (0) and let a nearby still-open site absorb its demands. Decoding
# (which demand goes to which still-open site, and which hardware
# combo each open site gets) is deterministic given the open/close
# bits, which keeps the search space to exactly the part that matters:
# "which switches do we actually need".
# ------------------------------------------------------------------------------
class GeneticSwitchCableOptimizer:
    def __init__(
        self,
        sites,               # [{'site_id', 'x', 'y', 'room_id'}, ...] (ILP's OPEN sites only)
        demands,              # [{'demand_id', 'x', 'y', 'room_id'}, ...]
        demand_home_site,     # demand_id -> site_id, the ILP's original assignment
        core_point,           # (x, y) of the core switch / backbone room
        core_room_id,         # room_id the core switch lives in
        scale,                # meters per pixel
        path_finder=None,     # CorridorPathFinder instance; falls back to Manhattan if None
        pop=40,
        gens=60,
        mut=0.15,
        elite=5,
    ):
        self.sites = sites
        self.site_ids = [s['site_id'] for s in sites]
        self.site_by_id = {s['site_id']: s for s in sites}
        self.demands = demands
        self.demand_home_site = demand_home_site
        self.core_point = core_point
        self.core_room_id = core_room_id
        self.scale = scale
        self.path_finder = path_finder
        self.pop_size = pop
        self.generations = gens
        self.mut_rate = mut
        self.elite_size = elite
        self.n_sites = len(sites)

        # --- distance helper: real corridor path if we have a
        # CorridorPathFinder, otherwise fall back to Manhattan. ---
        def real_dist(pa, room_a, pb, room_b):
            if self.path_finder is None:
                return manhattan_m(pa[0], pa[1], pb[0], pb[1], self.scale)
            dist_m, _path, _ok = self.path_finder.distance(pa, room_a, pb, room_b)
            return dist_m

        self._dist = real_dist

        # Precompute demand -> candidate sites within cable range,
        # sorted by distance (nearest first) so decoding is cheap.
        # NOTE: this precompute is the expensive part when using A*
        # (one A* run per demand-site pair) -- fine for a single
        # floor's worth of demands/sites, which is the actual scale
        # of this project.
        self.candidates_by_demand = {}
        for d in demands:
            dists = []
            for s in sites:
                dm = self._dist(
                    (d['x'], d['y']), d.get('room_id'),
                    (s['x'], s['y']), s.get('room_id'),
                )
                if dm <= MAX_CABLE_DISTANCE_M:
                    dists.append((dm, s['site_id']))
            dists.sort()
            self.candidates_by_demand[d['demand_id']] = dists

    # ---------------- population ----------------
    def init_pop(self):
        population = []
        for _ in range(self.pop_size):
            # Bias initial population towards "keep everything open"
            # (the ILP's own solution) so the GA only has to find
            # IMPROVEMENTS, never starts worse than the baseline.
            individual = [1 if random.random() > 0.15 else 0 for _ in range(self.n_sites)]
            population.append(individual)
        # Guarantee the ILP baseline itself is in the population.
        population[0] = [1] * self.n_sites
        return population

    # ---------------- decoding ----------------
    def decode(self, individual):
        """
        Returns (assignment, site_configs, feasible, total_cost)
          assignment: demand_id -> site_id
          site_configs: site_id -> (switch_combo_ports_list, hw_cost)
        """
        open_sites = {
            site_id for site_id, bit in zip(self.site_ids, individual) if bit == 1
        }

        if not open_sites:
            return None, None, False, float('inf')

        assignment = {}
        load = defaultdict(int)
        cable_cost = 0.0

        for d in self.demands:
            candidates = self.candidates_by_demand[d['demand_id']]
            chosen = None
            for dist_m, site_id in candidates:
                if site_id in open_sites and load[site_id] < MAX_SINGLE_SWITCH_CAPACITY * 4:
                    # capacity is checked precisely below; this loose
                    # cap just avoids piling everything on one site
                    # when a farther-but-open alternative exists.
                    chosen = (site_id, dist_m)
                    break
            if chosen is None:
                return None, None, False, float('inf')

            site_id, dist_m = chosen
            assignment[d['demand_id']] = site_id
            load[site_id] += 1
            cable_cost += dist_m * COST_PER_METER_COPPER

        # Hardware combo per open site + capacity feasibility check.
        site_configs = {}
        hw_cost = 0.0
        for site_id in open_sites:
            site_load = load.get(site_id, 0)
            if site_load == 0:
                continue  # nobody assigned here -> don't buy a switch at all
            try:
                cost, combo = cheapest_switch_combo(site_load)
            except RuntimeError:
                return None, None, False, float('inf')
            site_configs[site_id] = (combo, cost)
            hw_cost += cost

        # Uplink (fiber) cost: one link per switch actually installed.
        uplink_cost = 0.0
        for site_id in site_configs:
            s = self.site_by_id[site_id]
            dist_m = self._dist(
                (s['x'], s['y']), s.get('room_id'),
                self.core_point, self.core_room_id,
            )
            uplink_cost += dist_m * COST_PER_METER_FIBER

        total_cost = cable_cost + hw_cost + uplink_cost
        return assignment, site_configs, True, total_cost

    # ---------------- GA machinery (same shape as the original GA) ----------------
    def fitness(self, individual):
        _, _, feasible, cost = self.decode(individual)
        if not feasible:
            return 1e12  # hard infeasibility penalty
        return cost

    def select(self, pop, fits):
        def tournament():
            candidates = random.sample(list(zip(pop, fits)), 3)
            return min(candidates, key=lambda x: x[1])[0]
        return tournament(), tournament()

    def crossover(self, p1, p2):
        if self.n_sites < 2:
            return p1[:], p2[:]
        point = random.randint(1, self.n_sites - 1)
        return p1[:point] + p2[point:], p2[:point] + p1[point:]

    def mutate(self, individual):
        result = individual[:]
        for i in range(self.n_sites):
            if random.random() < self.mut_rate:
                result[i] = 1 - result[i]
        return result

    def run(self):
        if self.n_sites == 0:
            return {}, {}, 0.0

        pop = self.init_pop()
        best_ind, best_fit = None, float('inf')

        for _ in range(self.generations):
            fits = [self.fitness(ind) for ind in pop]
            best_idx = min(range(len(pop)), key=lambda i: fits[i])
            if fits[best_idx] < best_fit:
                best_fit = fits[best_idx]
                best_ind = pop[best_idx][:]

            ranked = sorted(range(len(pop)), key=lambda i: fits[i])
            elite_idx = ranked[:self.elite_size]
            new_pop = [pop[i][:] for i in elite_idx]

            while len(new_pop) < self.pop_size:
                p1, p2 = self.select(pop, fits)
                c1, c2 = self.crossover(p1, p2)
                new_pop.extend([self.mutate(c1), self.mutate(c2)])

            pop = new_pop[:self.pop_size]

        assignment, site_configs, feasible, cost = self.decode(best_ind)
        if not feasible:
            # Should not happen (baseline is always feasible) but never
            # return a broken network -- fall back to "keep everything open".
            assignment, site_configs, _, cost = self.decode([1] * self.n_sites)

        return assignment, site_configs, cost


# ------------------------------------------------------------------------------
# Public entry point: plug this in right after solve_facility_location(),
# before generate_devices().
# ------------------------------------------------------------------------------
def optimize_switches_and_cabling(
    open_site_ids,
    sites,              # full candidate site list from generate_switch_candidates()
    demands,             # full demand list from generate_demand_points()
    ilp_assignment,      # demand_id -> site_id, from solve_facility_location()
    core_point,
    core_room_id,
    scale,
    rooms=None,          # room list (id/corners) -> builds a CorridorPathFinder if given
    path_finder=None,    # or pass an already-built CorridorPathFinder directly
    room_types_by_id=None,  # optional {room_id: room_type} for the safety check below
):
    # Defense-in-depth: refuse to even start if any candidate site is
    # sitting in a room type where a switch must never be placed.
    assert_sites_allowed(sites, room_types_by_id=room_types_by_id)

    """
    Returns:
      new_assignment: demand_id -> site_id (subset of open_site_ids, possibly
                       smaller than the ILP's original open_site_ids)
      site_configs:   site_id -> (switch_ports_list, hardware_cost)
                       e.g. {3: ([48, 8], 420)} means site 3 now needs a
                       48-port switch AND an 8-port switch.
      total_cost:      cable + uplink + hardware cost of the refined design
      baseline_cost:   same total cost formula, evaluated on the ILP's own
                       (unmerged) solution -- for reporting the savings.
    """
    open_sites = [s for s in sites if s['site_id'] in set(open_site_ids)]

    if path_finder is None and rooms is not None:
        path_finder = CorridorPathFinder(rooms, scale=scale)

    optimizer = GeneticSwitchCableOptimizer(
        sites=open_sites,
        demands=demands,
        demand_home_site=ilp_assignment,
        core_point=core_point,
        core_room_id=core_room_id,
        scale=scale,
        path_finder=path_finder,
    )

    _, baseline_configs, _, baseline_cost = optimizer.decode([1] * optimizer.n_sites)
    new_assignment, site_configs, total_cost = optimizer.run()

    return {
        'assignment': new_assignment,
        'site_configs': site_configs,
        'total_cost': total_cost,
        'baseline_cost': baseline_cost,
        'savings': baseline_cost - total_cost,
        'switches_before': sum(1 for cfg in baseline_configs.values() for _ in cfg[0]),
        'switches_after': sum(1 for cfg in site_configs.values() for _ in cfg[0]),
    }


if __name__ == '__main__':
    # ---------------- end-to-end demo: a small floor with real rooms ----------------
    # Room A: cluster of light-load endpoints (mergeable, like site 0/1/3 before)
    # Room B: heavy load, far away, behind an obstacle room -> needs its own
    #         big switch AND a real corridor detour for its uplink cable.
    # Room C: the "wall" obstacle sitting between A/B and the core switch.
    # Core (backbone room): where the core switch physically sits.
    rooms = [
        {'id': 'A',    'corners': [{'x': 0,   'y': 100}, {'x': 100, 'y': 100},
                                    {'x': 100, 'y': 200}, {'x': 0,   'y': 200}]},
        {'id': 'C',    'corners': [{'x': 100, 'y': 0},   {'x': 200, 'y': 0},
                                    {'x': 200, 'y': 250}, {'x': 100, 'y': 250}]},
        {'id': 'B',    'corners': [{'x': 200, 'y': 100}, {'x': 300, 'y': 100},
                                    {'x': 300, 'y': 200}, {'x': 200, 'y': 200}]},
        {'id': 'CORE', 'corners': [{'x': 130, 'y': 260}, {'x': 170, 'y': 260},
                                    {'x': 170, 'y': 300}, {'x': 130, 'y': 300}]},
    ]
    SCALE = 0.02  # 1 px = 2 cm

    demo_sites = [
        {'site_id': 0, 'x': 10.0, 'y': 190.0, 'room_id': 'A'},
        {'site_id': 1, 'x': 15.0, 'y': 110.0, 'room_id': 'A'},  # close to 0 -> mergeable
        {'site_id': 2, 'x': 290.0, 'y': 150.0, 'room_id': 'B'},  # far, heavy load
    ]

    demo_demands = []
    did = 0
    for site_id, n in [(0, 3), (1, 3)]:
        s = demo_sites[site_id]
        for _ in range(n):
            demo_demands.append({
                'demand_id': did,
                'x': s['x'] + random.uniform(-5, 5),
                'y': s['y'] + random.uniform(-5, 5),
                'room_id': 'A',
            })
            did += 1
    for _ in range(40):
        demo_demands.append({
            'demand_id': did,
            'x': 290 + random.uniform(-8, 8),
            'y': 150 + random.uniform(-30, 30),
            'room_id': 'B',
        })
        did += 1

    path_finder = CorridorPathFinder(rooms, scale=SCALE, cell_size_px=4)

    def nearest_site(d):
        return min(
            demo_sites,
            key=lambda s: path_finder.distance((d['x'], d['y']), d['room_id'], (s['x'], s['y']), s['room_id'])[0],
        )

    ilp_assignment_demo = {d['demand_id']: nearest_site(d)['site_id'] for d in demo_demands}

    core_point = (150.0, 280.0)

    result = optimize_switches_and_cabling(
        open_site_ids=[0, 1, 2],
        sites=demo_sites,
        demands=demo_demands,
        ilp_assignment=ilp_assignment_demo,
        core_point=core_point,
        core_room_id='CORE',
        scale=SCALE,
        rooms=rooms,
    )

    print('=== Real floor plan, real corridor distances, GA switch/merge decision ===')
    print('Baseline (ILP, one switch per opened site) cost :', round(result['baseline_cost'], 1))
    print('GA-refined cost                                 :', round(result['total_cost'], 1))
    print('Savings                                          :', round(result['savings'], 1))
    print('Switch count before -> after                     :', result['switches_before'], '->', result['switches_after'])
    print('Final site hardware configs:')
    for site_id, (combo, cost) in result['site_configs'].items():
        print(f'  site {site_id}: switches={combo}  cost={cost}')
