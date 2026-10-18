# Done-when check for the Originals' poses: refit each chair and table from its SPLAT_ROOM_1 pose against other room
# Captures (through align.json) and report how far each moves: tables against the LiDAR meshes (their tops are
# whole there), chairs against SPLAT_ROOM_2 (the meshes' chairs are torn). Agreement within 2 cm and 2 degrees
# between independent Captures is the evidence that the pose is within that of the real item.
# usage: python check_poses.py <repo root> <originals.json> <align/layout dir>
import json, sys
import numpy as np
import trimesh
from scipy.spatial import cKDTree
from scipy.optimize import least_squares

root, originals_path, A = sys.argv[1:4]
V2 = f'{root}/data/scans/lounge'
RS = f'{root}/data/scans/real-scans'
align = json.load(open(f'{A}/align.json'))['sources']

def roty(a):
    return np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])

def source_points(name, path):
    m = trimesh.load(path, force='mesh')
    p, _ = trimesh.sample.sample_surface(m, 3000000, seed=0)
    M = np.array(align[name]['matrix'])
    return p @ M[:3, :3].T + M[:3, 3]

def splat_points(name):
    M = np.array(align[name]['matrix'])
    with open(f'{RS}/{name}', 'rb') as f:
        hdr = b''
        while not hdr.endswith(b'end_header\n'):
            hdr += f.readline()
        props = [l.split()[-1].decode() for l in hdr.split(b'\n') if l.startswith(b'property')]
        n = int([l for l in hdr.split(b'\n') if l.startswith(b'element vertex')][0].split()[-1])
        a = np.fromfile(f, dtype=np.float32, count=n * len(props)).reshape(n, len(props))
    P = {p: i for i, p in enumerate(props)}
    xyz = a[:, [P['x'], P['y'], P['z']]].astype(np.float64) @ M[:3, :3].T + M[:3, 3]
    return xyz[1 / (1 + np.exp(-a[:, P['opacity']])) > 0.3]

def model_points(name):
    sc = trimesh.load(f'{V2}/models/{name}.glb')
    geo = [sc.geometry[g].copy().apply_transform(T) for n in sc.graph.nodes_geometry for T, g in [sc.graph[n]] if not n.startswith('shadow')]
    return trimesh.sample.sample_surface(trimesh.util.concatenate(geo), 8000, seed=0)[0]

models = {'chair': model_points('chair'), 'table': model_points('table')}
originals = [o for o in json.load(open(originals_path)) if o['category'] in ('chair', 'table')]
sources = {
    'POLYCAM_ROOM_GLB_1': ('table', lambda: source_points('POLYCAM_ROOM_GLB_1.glb', f'{RS}/POLYCAM_ROOM_GLB_1.glb')),
    'POLYCAM_ROOM_GLB_2': ('table', lambda: source_points('POLYCAM_ROOM_GLB_2.glb', f'{RS}/POLYCAM_ROOM_GLB_2.glb')),
    'KIRI scene': ('table', lambda: source_points('KIRI_ENGINE_CHAIR_1/model.obj', f'{RS}/KIRI_ENGINE_CHAIR_1/model.obj')),
    'SPLAT_ROOM_2': ('chair', lambda: splat_points('SPLAT_ROOM_2.ply')),
    'SPLAT_ROOM_2 ': ('table', lambda: splat_points('SPLAT_ROOM_2.ply')),   # the two splats' own offset, for reference
}
tables = [o for o in originals if o['category'] == 'table']
def not_table(p):
    ok = np.ones(len(p), bool)
    for t in tables:
        x0, _, z0 = t['box']['position']; a = t['box']['rotationY']; c, s_ = np.cos(a), np.sin(a)
        q = p[:, [0, 2]] - [x0, z0]
        lx = q[:, 0] * c - q[:, 1] * s_; lz = q[:, 0] * s_ + q[:, 1] * c
        ok &= ~((np.abs(lx) < 0.77) & (np.abs(lz) < 0.385) & (p[:, 1] > 0.6))
        ok &= ~((lx > 0.69) & (np.abs(np.abs(lz) - 0.35) < 0.06))   # its East legs
    return ok
rows = {o['label']: {} for o in originals}
for sname, (cat, load) in sources.items():
    P = load()
    for o in [o for o in originals if o['category'] == cat]:
        mp = models[o['category']]
        x0, _, z0 = o['box']['position']; a0 = o['box']['rotationY']
        # chairs: seat and back (above floor clutter); tables: the top's slab only (not the wall or the chair backs)
        rx, rz, lo, hi = (0.45, 0.45, 0.40, 1.0) if cat == 'chair' else (0.75, 0.42, 0.66, 0.74)
        box = P[(np.abs(P[:, 0] - x0) < rx) & (np.abs(P[:, 2] - z0) < rz) & (P[:, 1] > lo) & (P[:, 1] < hi)]
        if cat == 'chair':
            box = box[not_table(box)]
        sub = mp[(mp[:, 1] > lo) & (mp[:, 1] < hi)]
        x = np.array([a0, x0, z0])
        for _ in range(25):
            M = sub @ roty(x[0]).T + [x[1], 0, x[2]]
            d, k = cKDTree(M).query(box)
            keep = d < min(max(np.percentile(d, 60), 0.01), 0.04)
            Am, B = sub[k[keep]], box[keep]
            x = least_squares(lambda y: (Am @ roty(y[0]).T + [y[1], 0, y[2]] - B).ravel(), x, loss='soft_l1', f_scale=0.01).x
        d, _ = cKDTree(sub @ roty(x[0]).T + [x[1], 0, x[2]]).query(box)
        dyaw = np.degrees(np.arctan2(np.sin(x[0] - a0), np.cos(x[0] - a0)))
        rows[o['label']][sname.strip()] = (np.hypot(x[1] - x0, x[2] - z0) * 100, dyaw, np.median(d) * 1000, (d < 0.02).mean(), (x[1] - x0) * 100, (x[2] - z0) * 100)
print('| Original | refit against | moves (dx, dz) | turns | median distance after | within 2 cm |')
print('|---|---|---|---|---|---|')
for label, r in rows.items():
    for n, v in r.items():
        print(f'| {label} | {n} | {v[0]:.1f} cm ({v[4]:+.1f}, {v[5]:+.1f}) | {v[1]:+.1f}° | {v[2]:.0f} mm | {v[3]:.0%} |')
