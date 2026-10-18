# Fit the 16 Originals (12 chairs, 3 tables, the whiteboard) where the real items stand, and print setup.json's
# `originals` (plus a fit report on stderr).
# usage: python fit_originals.py <repo root> <floor.png> [dir with align.json and layout.json] > originals.json
#   floor.png: top-down render of POLYCAM_ROOM_GLB_1 below 0.12 m, 2 mm/px, 3700 px square, centered at
#   (x=-0.3, z=0), image up = -z (render spec "floor" in renders.json) -> floorColor.
#
# Chairs: start from layout.json's chair boxes; trimmed ICP (yaw, x, z) of the chair Master Copy's surface into
#   SPLAT_ROOM_1's points around the box (table tops removed). A second fit also frees the scale, to check the
#   Master Copy's size against each real chair.
# Tables: the two East legs are crisp columns in the splat: their centers give the yaw and the position; the
#   Master Copy's legs are put on them.
# Whiteboard: flat against the East wall (x = 1.5759, setup.json), ends and height measured on GLB_1's image.
import json, sys
import numpy as np
import trimesh
from PIL import Image
from scipy.spatial import cKDTree
from scipy.optimize import least_squares

root, floor_png = sys.argv[1], sys.argv[2]
V2 = f'{root}/data/scans/lounge'
A = sys.argv[3] if len(sys.argv) > 3 else V2      # part A's align.json and layout.json
log = lambda *a: print(*a, file=sys.stderr)

def roty(a):
    return np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])

def model_points(name, n):
    sc = trimesh.load(f'{V2}/models/{name}.glb')
    geoms = []
    for node in sc.graph.nodes_geometry:
        T, gname = sc.graph[node]
        if not node.startswith('shadow'):
            geoms.append(sc.geometry[gname].copy().apply_transform(T))
    m = trimesh.util.concatenate(geoms)
    p, _ = trimesh.sample.sample_surface(m, n, seed=0)
    return p, m.bounds

def load_splat():
    al = json.load(open(f'{A}/align.json'))['sources']['SPLAT_ROOM_1.ply']['matrix']
    path = f'{root}/data/scans/real-scans/SPLAT_ROOM_1.ply'
    with open(path, 'rb') as f:
        hdr = b''
        while not hdr.endswith(b'end_header\n'):
            hdr += f.readline()
        props = [l.split()[-1].decode() for l in hdr.split(b'\n') if l.startswith(b'property')]
        n = int([l for l in hdr.split(b'\n') if l.startswith(b'element vertex')][0].split()[-1])
        a = np.fromfile(f, dtype=np.float32, count=n * len(props)).reshape(n, len(props))
    P = {p: i for i, p in enumerate(props)}
    M = np.array(al)
    xyz = a[:, [P['x'], P['y'], P['z']]].astype(np.float64) @ M[:3, :3].T + M[:3, 3]
    op = 1 / (1 + np.exp(-a[:, P['opacity']]))
    rgb = np.clip(0.5 + 0.28209479 * a[:, [P['f_dc_0'], P['f_dc_1'], P['f_dc_2']]], 0, 1)
    return xyz, op, rgb

xyz, op, rgb = load_splat()
layout = json.load(open(f'{A}/layout.json'))
floor = np.asarray(Image.open(floor_png).convert('RGB')).astype(float)

def floor_color(cx, cz, hw, hd, rot):
    """Median floor color in the ring 5-30 cm outside the footprint (the Empty Room's floor there)."""
    xs, zs = np.meshgrid(np.arange(-hw - 0.3, hw + 0.3, 0.01), np.arange(-hd - 0.3, hd + 0.3, 0.01))
    ring = (np.maximum(np.abs(xs) - hw, np.abs(zs) - hd) > 0.05)
    lx, lz = xs[ring], zs[ring]
    x = cx + lx * np.cos(rot) + lz * np.sin(rot); z = cz - lx * np.sin(rot) + lz * np.cos(rot)
    r = ((z - 0) / 0.002 + 1850).astype(int); c = ((x + 0.3) / 0.002 + 1850).astype(int)
    ok = (r >= 0) & (r < floor.shape[0]) & (c >= 0) & (c < floor.shape[1])
    px = floor[r[ok], c[ok]]
    px = px[px.max(1) > 10]
    lum = px.mean(1)
    px = px[(lum > np.percentile(lum, 30)) & (lum < np.percentile(lum, 95))]   # drop shadows, legs and highlights
    return '#%02x%02x%02x' % tuple(np.median(px, 0).round().astype(int))

originals = []
report = []

def box_size(b):
    """[width, height, depth]: the box stands on the floor at the model's origin, so its height reaches the
    geometry's top (the whiteboard's box runs from the floor to the board's top)."""
    return [round(b[1][0] - b[0][0], 3), round(b[1][1], 3), round(b[1][2] - b[0][2], 3)]

# ---------------- tables ----------------
TABLE_L, TABLE_LEG_IN = 1.515, 0.019
tbl_model, tbl_bounds = model_points('table', 20000)
tables = sorted([it for it in layout['items'] if it['category'] == 'table'], key=lambda it: it['box']['position'][2])
orange = rgb[:, 0] - rgb[:, 2] > 0.15
legcol = (op > 0.2) & ~orange & (xyz[:, 1] > 0.15) & (xyz[:, 1] < 0.6)
L = xyz[legcol]
table_boxes = []
table_legs = []
for i, it in enumerate(tables):
    bz = it['box']['position'][2]
    cents = []
    for lz in (bz - 0.35, bz + 0.35):
        # search the East end for the leg column nearest the expected spot
        cand = L[(L[:, 0] > -0.2) & (L[:, 0] < 0.05) & (np.abs(L[:, 2] - lz) < 0.12)]
        H, xe, ze = np.histogram2d(cand[:, 0], cand[:, 2], bins=[np.arange(-0.2, 0.05, 0.01), np.arange(lz - 0.12, lz + 0.12, 0.01)])
        ix, iz = np.unravel_index(H.argmax(), H.shape)
        px_, pz_ = xe[ix] + 0.005, ze[iz] + 0.005
        for r in (0.04, 0.025):
            s = np.hypot(L[:, 0] - px_, L[:, 2] - pz_) < r
            px_, pz_ = np.median(L[s, 0]), np.median(L[s, 2])
        cents.append((px_, pz_))
    (ax, az), (bx, bz2) = cents
    table_legs += cents
    yaw = np.arctan2(bx - ax, bz2 - az)
    c, s = np.cos(yaw), np.sin(yaw)
    mx, mz = (ax + bx) / 2, (az + bz2) / 2
    wc = -(TABLE_L / 2 - TABLE_LEG_IN)
    ox, oz = mx + wc * c, mz - wc * s
    size = box_size(tbl_bounds)
    label = f'Table {i + 1}'
    originals.append(dict(id=f'og_table_{i + 1}', label=label, category='table', model='models/table.glb',
                          box=dict(position=[round(ox, 4), 0, round(oz, 4)], size=size, rotationY=round(float(yaw), 5)),
                          kept=False, floorColor=floor_color(ox, oz, size[0] / 2, size[2] / 2, yaw)))
    table_boxes.append((ox, oz, yaw))
    report.append(f'{label}: legs at ({ax:.3f}, {az:.3f}) and ({bx:.3f}, {bz2:.3f}), {np.hypot(bx - ax, bz2 - az):.3f} apart; '
                  f'yaw {np.degrees(yaw):.2f} deg; Layout box center moved {np.hypot(ox - it["box"]["position"][0], oz - it["box"]["position"][2]) * 100:.1f} cm')

# ---------------- chairs ----------------
chair_model, chair_bounds = model_points('chair', 40000)
cm_sub = chair_model[::4]
P = xyz[op > 0.3]
def in_table_top(p):
    bad = np.zeros(len(p), bool)
    for ox, oz, yaw in table_boxes:
        q = (p[:, [0, 2]] - [ox, oz]); c, s = np.cos(yaw), np.sin(yaw)
        lx = q[:, 0] * c - q[:, 1] * s; lz = q[:, 0] * s + q[:, 1] * c
        bad |= (np.abs(lx) < TABLE_L / 2 + 0.01) & (np.abs(lz) < 0.385) & (p[:, 1] > 0.6)
    for lx_, lz_ in table_legs:   # and the tables' metal legs, which would pull a chair onto them
        bad |= np.hypot(p[:, 0] - lx_, p[:, 2] - lz_) < 0.06
    return bad
chairs = [it for it in layout['items'] if it['category'] == 'chair']
# number chairs table by table (North to South), North side before South side, West before East
def chair_key(it):
    x, _, z = it['box']['position']
    t = int(np.argmin([abs(z - tb[1]) for tb in table_boxes]))
    return (t, z > table_boxes[t][1], x)
chairs.sort(key=chair_key)
for i, it in enumerate(chairs):
    bx, _, bz = it['box']['position']; byaw = it['box']['rotationY']
    box = P[(np.abs(P[:, 0] - bx) < 0.45) & (np.abs(P[:, 2] - bz) < 0.45) & (P[:, 1] > 0.03) & (P[:, 1] < 1.0)]
    box = box[~in_table_top(box)]
    def coarse(data):
        best = None
        for dyaw in np.radians(np.arange(-20, 20.1, 2.5)):
            for dx in np.arange(-0.15, 0.151, 0.025):
                for dz in np.arange(-0.15, 0.151, 0.025):
                    M = cm_sub[::3] @ roty(byaw + dyaw).T + [bx + dx, 0, bz + dz]
                    d, _ = cKDTree(M).query(data[::2])
                    sc_ = np.mean(np.minimum(d, 0.04))
                    if best is None or sc_ < best[0]:
                        best = (sc_, byaw + dyaw, bx + dx, bz + dz)
        return np.array(best[1:])
    def icp(x, data, free_scale):
        x = np.append(x, 1.0) if free_scale else x
        for _ in range(30):
            s = x[3] if free_scale else 1.0
            M = (cm_sub * s) @ roty(x[0]).T + [x[1], 0, x[2]]
            d, k = cKDTree(M).query(data)
            keep = d < min(max(np.percentile(d, 70), 0.01), 0.05)
            A, B = cm_sub[k[keep]], data[keep]
            def r(y):
                s = y[3] if free_scale else 1.0
                return ((A * s) @ roty(y[0]).T + [y[1], 0, y[2]] - B).ravel()
            x = least_squares(r, x, loss='soft_l1', f_scale=0.01).x
        return x
    def score(x, data):
        d, _ = cKDTree(cm_sub @ roty(x[0]).T + [x[1], 0, x[2]]).query(data)
        return np.median(d[d < 0.05]), (d < 0.03).mean()
    # bags and other clutter stand on the floor near some chairs: also fit on the seat and back alone
    # (points above 0.40 m) and keep the pose that explains the seat and back better
    upper = box[box[:, 1] > 0.40]
    cands = [icp(coarse(box), box, False), icp(coarse(upper), upper, False)]
    x = min(cands, key=lambda c: score(c, upper)[0])
    med, inl = score(x, box)
    xs = icp(x, box, True)
    meds = score(xs[:3], box)[0]
    yaw = float(np.arctan2(np.sin(x[0]), np.cos(x[0])))
    size = box_size(chair_bounds)
    label = f'Chair {i + 1}'
    originals.append(dict(id=f'og_chair_{i + 1}', label=label, category='chair', model='models/chair.glb',
                          box=dict(position=[round(x[1], 4), 0, round(x[2], 4)], size=size, rotationY=round(yaw, 5)),
                          kept=False, floorColor=floor_color(x[1], x[2], size[0] / 2, size[2] / 2, yaw)))
    report.append(f'{label}: ({x[1]:.3f}, {x[2]:.3f}) yaw {np.degrees(yaw):.1f} deg; splat points {len(box)}, '
                  f'median distance {med * 1000:.1f} mm, within 3 cm {inl:.0%}; free-scale fit: scale {xs[3]:.4f} '
                  f'(median {meds * 1000:.1f} mm); Layout box center moved {np.hypot(x[1] - bx, x[2] - bz) * 100:.1f} cm')

# ---------------- whiteboard ----------------
WB_Z0, WB_Z1, WALL_X = -3.565, 2.522, 1.5759
_, wb_bounds = model_points('whiteboard', 1000)
size = box_size(wb_bounds)
pos = [round(WALL_X - size[2] / 2, 4), 0, round((WB_Z0 + WB_Z1) / 2, 4)]
originals.append(dict(id='og_whiteboard', label='Whiteboard', category='wall_art', model='models/whiteboard.glb',
                      box=dict(position=pos, size=size, rotationY=round(-np.pi / 2, 5)), kept=False,
                      floorColor=floor_color(pos[0] - 0.2, pos[2], size[0] / 2, 0.15, -np.pi / 2)))
report.append(f'Whiteboard: back on the East wall at x = {WALL_X}, z {WB_Z0}..{WB_Z1}, y {wb_bounds[0][1]:.3f}..{wb_bounds[1][1]:.3f}')

log('\n'.join(report))
print(json.dumps(originals, indent=2))
