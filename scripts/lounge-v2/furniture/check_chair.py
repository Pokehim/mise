# Done-when check for the chair: its size against the 12 chairs in the room scans (SPLAT_ROOM_1), and its shape
# against the Detail Captures.
# usage: python check_chair.py <repo root> <originals.json> <align/layout dir> <chair1_crop.glb> <chair2_crop.glb> <icp12.json> [SPLAT_ROOM_1|SPLAT_ROOM_2]
# Each real chair is read in its fitted pose (chair frame: +Z front, x = 0 the symmetry plane). The same statistics
# are taken from the splat's points and from points sampled on the Master Copy:
#   seat height  - 90th percentile height of points over the seat's center (|x| < 5 cm, -6 < z < 4 cm, 0.38-0.56 m)
#   seat width   - between the medians of the points on the shell's two outer sides (|x| > 0.17 m), 0.40-0.47 m high
#   back height  - 99th percentile height of points on the back (|x| < 0.12 m, z < -0.10 m, above 0.70 m)
#   leg spread   - each leg's axis 2-30 cm above the floor, fitted to its points as a cone of the Master Copy's
#                  radius and splay (so a leg seen from one side only is not pulled outward); at 5 cm high
import json, sys
import numpy as np
import trimesh
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation as Rot
from scipy.optimize import least_squares
# the Master Copy's legs (chair.py)
LEG_BACK = dict(slope=(-np.tan(np.radians(13.26)), np.tan(np.radians(14.15))))
LEG_FRONT = dict(slope=(-np.tan(np.radians(10.49)), -np.tan(np.radians(7.07))))
R0, R1 = 0.0120, (0.01815 - 0.0120) / 0.35

root, originals_path, A, c1, c2, icp_path = sys.argv[1:7]
SPLAT = sys.argv[7] if len(sys.argv) > 7 else 'SPLAT_ROOM_1'
V2 = f'{root}/data/scans/lounge-v2'

def roty(a):
    return np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])

def load_splat():
    al = json.load(open(f'{A}/align.json'))['sources'][f'{SPLAT}.ply']['matrix']
    with open(f'{root}/data/scans/real-scans/{SPLAT}.ply', 'rb') as f:
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
    k = op > 0.3
    return xyz[k], rgb[k]

def stats(q, orange):
    out = {}
    s = q[(np.abs(q[:, 0]) < 0.05) & (q[:, 2] > -0.06) & (q[:, 2] < 0.04) & (q[:, 1] > 0.38) & (q[:, 1] < 0.56)]
    out['seat height'] = np.percentile(s[:, 1], 90) if len(s) > 10 else np.nan
    w = q[(q[:, 1] > 0.40) & (q[:, 1] < 0.47) & (np.abs(q[:, 2]) < 0.15) & (np.abs(q[:, 0]) > 0.17) & (np.abs(q[:, 0]) < 0.32)]
    l, r = w[w[:, 0] < 0, 0], w[w[:, 0] > 0, 0]
    out['seat width'] = np.median(r) - np.median(l) if min(len(l), len(r)) > 10 else np.nan
    b = q[(np.abs(q[:, 0]) < 0.12) & (q[:, 2] < -0.10) & (q[:, 2] > -0.40) & (q[:, 1] > 0.70) & (q[:, 1] < 1.0)]
    out['back height'] = np.percentile(b[:, 1], 99) if len(b) > 20 else np.nan
    f = q[orange & (q[:, 1] > 0.02) & (q[:, 1] < 0.30) & (np.abs(q[:, 0]) < 0.32) & (np.abs(q[:, 2]) < 0.32)]
    feet = {}
    for sx in (-1, 1):
        for sz in (-1, 1):
            g = f[(np.sign(f[:, 0]) == sx) & (np.sign(f[:, 2]) == sz)]
            spec = LEG_FRONT if sz > 0 else LEG_BACK
            kx, kz = spec['slope'][0] * sx, spec['slope'][1]
            if len(g) < 30:
                feet[(sx, sz)] = np.array([np.nan, np.nan]); continue
            def res(c):
                ax = c[0] + kx * g[:, 1]; az = c[1] + kz * g[:, 1]
                return np.hypot(g[:, 0] - ax, g[:, 2] - az) - (R0 + R1 * g[:, 1])
            c0 = np.median(g[:, [0, 2]], 0) - [kx * np.median(g[:, 1]), kz * np.median(g[:, 1])]
            c = least_squares(res, c0, loss='soft_l1', f_scale=0.003).x
            feet[(sx, sz)] = c + [kx * 0.05, kz * 0.05]   # axis at 5 cm high
    out['leg spread, front (x)'] = feet[(1, 1)][0] - feet[(-1, 1)][0]
    out['leg spread, back (x)'] = feet[(1, -1)][0] - feet[(-1, -1)][0]
    out['leg spread, side (z)'] = np.mean([feet[(s, 1)][1] - feet[(s, -1)][1] for s in (-1, 1)])
    return out

xyz, rgb = load_splat()
orange_all = rgb[:, 0] - rgb[:, 2] > 0.15
originals = json.load(open(originals_path))
chairs = [o for o in originals if o['category'] == 'chair']

# Master Copy samples, at a density like the splat's on a chair, read the same way
sc = trimesh.load(f'{V2}/models/chair.glb')
parts = {}
for node in sc.graph.nodes_geometry:
    T, g = sc.graph[node]
    if not node.startswith('shadow'):
        parts[node] = sc.geometry[g].copy().apply_transform(T)
mesh = trimesh.util.concatenate(list(parts.values()))
mp, mf = trimesh.sample.sample_surface(mesh, 200000, seed=1)
# legs are orange in the splat; mark the model's leg samples the same way (legs node, below the seat)
legs_mesh = [m for n, m in parts.items() if n.startswith('legs')][0]
d_leg = cKDTree(trimesh.sample.sample_surface(legs_mesh, 100000, seed=2)[0]).query(mp)[0]
m_orange = (d_leg < 0.002) & (mp[:, 1] < 0.36)
model = stats(mp, m_orange)

rows = []
for o in chairs:
    x0, _, z0 = o['box']['position']; a = o['box']['rotationY']
    near = (np.abs(xyz[:, 0] - x0) < 0.45) & (np.abs(xyz[:, 2] - z0) < 0.45)
    q = (xyz[near] - [x0, 0, z0]) @ roty(a)
    rows.append(stats(q, orange_all[near]))
keys = list(model.keys())
print(f'Real chairs read in {SPLAT}')
print('| | Master Copy | real chairs (median of 12) | difference | chairs measured |')
print('|---|---|---|---|---|')
for k in keys:
    vals = np.array([r[k] for r in rows]); vals = vals[np.isfinite(vals)]
    med = np.median(vals)
    print(f'| {k} | {model[k] * 1000:.0f} mm | {med * 1000:.0f} mm (p25-p75 {np.percentile(vals, 25) * 1000:.0f}-{np.percentile(vals, 75) * 1000:.0f}) | {(model[k] - med) * 1000:+.1f} mm | {len(vals)} |')

# shape vs the Detail Captures, scaled to fit (the same scale the Master Copy uses): median surface distance
icp = json.load(open(icp_path))
import struct
b = open(f'{V2}/models/chair.glb', 'rb').read(); n = struct.unpack('<I', b[12:16])[0]
shift = np.array(next(nd for nd in json.loads(b[20:20 + n])['nodes'] if nd.get('name') == 'seat').get('translation', [0, 0, 0]))
for name, path in (('POLYCAM_CHAIR_1', c1), ('POLYCAM_CHAIR_2', c2)):
    m = trimesh.load(path, force='mesh')
    p, _ = trimesh.sample.sample_surface(m, 200000, seed=3)
    if name.endswith('1'):
        p = icp['s'] * Rot.from_rotvec(icp['rotvec']).apply(p) + icp['t']
    p = p + shift   # recenter_glb.py's shift of the Master Copy
    # Master Copy -> capture and capture -> Master Copy (the capture's torn bits and floor scraps excluded by y > 2 cm)
    p = p[p[:, 1] > 0.02]
    d1 = cKDTree(p).query(mp)[0]
    d2 = cKDTree(mp).query(p)[0]
    print(f'{name}: median surface distance Master Copy->capture {np.median(d1) * 1000:.1f} mm, capture->Master Copy {np.median(d2) * 1000:.1f} mm '
          f'(80th pct {np.percentile(d1, 80) * 1000:.1f} / {np.percentile(d2, 80) * 1000:.1f} mm)')
