"""align.json (#77 part 1): every source of spec §2 in lounge-v1's room frame.

- POLYCAM_ROOM_GLB_1 is the room frame's own source, through lounge-v1's meshTransform.
- The other room meshes: level by the floor, then wall occupancy correlation (yaw and x/z), then trimmed
  point-to-plane ICP against GLB_1 (the method of PR #50).
- The chair Detail Captures, which aren't to scale (SCALE): level by their floor, yaw from the floor grain, then x/z
  by ICP from each Layout chair and a grid over the room.
- The splats: the comparison's fits (docs/research/lounge-compare/align-ROOM_*.json), tilt included.
- The KIRI Layouts: from layout.py, which fits their walls to the room's.

Every transform is a 4x4 row-major matrix: room = M · [p_file, 1].
"""
import json
import os
import sys

import numpy as np
import trimesh
from scipy.spatial import cKDTree

from common import CACHE, F, H, REAL, V1, V2, X0, X1, Z0, Z1, mat4, rot_y, rounded, splat_fit, write_json, yaw_of

rng = np.random.default_rng(7)


def load(path):
    scene = trimesh.load(path, force='scene')
    return scene.to_geometry() if hasattr(scene, 'to_geometry') else scene.dump(concatenate=True)


def sample(mesh, n):
    pts, face = trimesh.sample.sample_surface(mesh, n, seed=1)
    return pts, mesh.face_normals[face]


def apply(M, pts, nrm=None):
    p = pts @ M[:3, :3].T + M[:3, 3]
    if nrm is None:
        return p
    R = M[:3, :3] / np.cbrt(np.linalg.det(M[:3, :3]))
    return p, nrm @ R.T


def in_room(p, margin=0.05, top=H):
    return ((p[:, 0] > X0 - margin) & (p[:, 0] < X1 + margin) & (p[:, 2] > Z0 - margin) & (p[:, 2] < Z1 + margin)
            & (p[:, 1] > -margin) & (p[:, 1] < top + margin))


def floor_height(p, n):
    up = p[n[:, 1] > 0.9, 1]
    hist, edges = np.histogram(up, bins=np.arange(up.min(), up.max() + 0.02, 0.02))
    # The floor is the lowest strong peak (tables are higher).
    strong = np.nonzero(hist > 0.3 * hist.max())[0]
    i = strong[0]
    sel = up[(up > edges[i] - 0.03) & (up < edges[i + 1] + 0.03)]
    return float(np.median(sel))


def wall_yaw(n):
    """The walls' direction, mod 90°: rot_y of it turns them onto the axes."""
    v = n[np.abs(n[:, 1]) < 0.2]
    a = np.mod(np.arctan2(v[:, 2], v[:, 0]), np.pi / 2)
    # Circular mean on the 90° period.
    m = np.angle(np.mean(np.exp(4j * a))) / 4
    return float(m)


def occupancy(p, n, cell=0.05, lo=(-6, -9), size=(240, 360)):
    v = (np.abs(n[:, 1]) < 0.3) & (p[:, 1] > 0.3) & (p[:, 1] < 2.2)
    ix = ((p[v, 0] - lo[0]) / cell).astype(int)
    iz = ((p[v, 2] - lo[1]) / cell).astype(int)
    ok = (ix >= 0) & (ix < size[0]) & (iz >= 0) & (iz < size[1])
    img = np.zeros(size)
    np.add.at(img, (ix[ok], iz[ok]), 1)
    return np.minimum(img, 5)


def correlate(a, b):
    """Shift s maximizing sum a[x] b[x - s]."""
    fa, fb = np.fft.rfft2(a), np.fft.rfft2(b)
    c = np.fft.irfft2(fa * np.conj(fb), s=a.shape)
    i = np.unravel_index(np.argmax(c), c.shape)
    s = [i[0] if i[0] < a.shape[0] // 2 else i[0] - a.shape[0], i[1] if i[1] < a.shape[1] // 2 else i[1] - a.shape[1]]
    return s, float(c[i])


def icp(src, src_n, tree, tgt, tgt_n, M, dists=(0.3, 0.15, 0.08, 0.05, 0.03, 0.03, 0.02, 0.02), iters=6, scale=False, mask=None, planar=False):
    """Trimmed point-to-plane ICP. Returns the refined 4x4 M (rigid, or a similarity if scale; only yaw and
    x/z if planar)."""
    for d in dists:
        for _ in range(iters):
            p = apply(M, src)
            if mask is not None:
                keep = mask(p)
                p, s0 = p[keep], src[keep]
            else:
                s0 = src
            dd, j = tree.query(p, distance_upper_bound=d)
            ok = np.isfinite(dd)
            if ok.sum() < 100:
                break
            q, nq, pp = tgt[j[ok]], tgt_n[j[ok]], p[ok]
            # Linearized: (pp + w x pp + t - q) . n = 0, plus a scale term.
            A = np.concatenate([np.cross(pp, nq), nq] + ([np.sum(pp * nq, axis=1, keepdims=True)] if scale else []), axis=1)
            b = np.sum((q - pp) * nq, axis=1)
            if planar == 'xz':
                y = np.linalg.lstsq(A[:, [3, 5]], b, rcond=None)[0]
                x = np.array([0, 0, 0, y[0], 0, y[1]])
            elif planar:
                y = np.linalg.lstsq(A[:, [1, 3, 5]], b, rcond=None)[0]
                x = np.array([0, y[0], 0, y[1], 0, y[2]])
            else:
                x = np.linalg.lstsq(A, b, rcond=None)[0]
            w, t = x[:3], x[3:6]
            Rw = trimesh.transformations.euler_matrix(*w, 'sxyz')[:3, :3]
            D = np.eye(4)
            D[:3, :3] = Rw * (1 + x[6] if scale else 1)
            D[:3, 3] = t
            M = D @ M
    return M


def residual(M, src, tree, mask):
    p = apply(M, src)
    p = p[mask(p)]
    d, _ = tree.query(p)
    return {'points': int(len(p)), 'medianM': round(float(np.median(d)), 4),
            'inlierShareLt5cm': round(float(np.mean(d < 0.05)), 3),
            'medianInliersM': round(float(np.median(d[d < 0.05])), 4)}


def room_target():
    with open(os.path.join(V1, 'manifest.json')) as f:
        mt = json.load(f)['meshTransform']
    M = mat4(rot_y(mt['rotationY']), mt['position'])
    mesh = load(os.path.join(REAL, 'POLYCAM_ROOM_GLB_1.glb'))
    p, n = apply(M, *sample(mesh, 600000))
    keep = in_room(p, 0.1)
    return M, p[keep], n[keep]


def fit_room_mesh(name, tgt, tgt_n, tree, scale=False):
    mesh = load(os.path.join(REAL, name))
    p, n = sample(mesh, 300000)
    y0 = floor_height(p, n)
    yaw = wall_yaw(n)
    occ_t = occupancy(tgt, tgt_n)
    best = None
    for k in range(4):
        a = yaw + k * np.pi / 2
        M = mat4(rot_y(a), [0, -y0, 0])
        q, qn = apply(M, p, n)
        (sx, sz), score = correlate(occ_t, occupancy(q, qn))
        if best is None or score > best[0]:
            best = (score, a, sx, sz)
    _, a, sx, sz = best
    M = mat4(rot_y(a), [sx * 0.05, -y0, sz * 0.05])
    mask = lambda q: in_room(q, 0.15, H - 0.1)
    M = icp(p, n, tree, tgt, tgt_n, M, scale=scale, mask=mask)
    res = residual(M, p, tree, lambda q: in_room(q, 0.02, H - 0.1))
    print(name, 'coarse yaw', round(np.degrees(a), 2), 'shift', sx * 0.05, sz * 0.05, '→', res, flush=True)
    return M, res


# The floor grain's angle from +x in each Detail Capture's own frame (ortho.py with ORTHO_OWN_FRAME=1, then
# grain.py). The room's grain runs along x (KIRI 179.7°, GLB_1 2.5°), so it pins the chair's yaw to two choices.
GRAIN_DEG = {'POLYCAM_CHAIR_1.glb': 99.37, 'POLYCAM_CHAIR_2.glb': 70.65}
# The Detail Captures aren't to scale (room = SCALE x capture). CHAIR_1 also caught the East wall under the
# whiteboard: its outlet and switch plate are 0.198 m apart and 0.31 m up, against the Main Capture's 0.287 m and
# 0.46 m, and its chair is 0.59 m tall. CHAIR_2's chair is 0.804 m tall; the Layout's chairs are 0.835 m.
SCALE = {'POLYCAM_CHAIR_1.glb': 1.449, 'POLYCAM_CHAIR_2.glb': 1.039}


def fit_chair(name, tgt, tgt_n, tree, chairs):
    mesh = load(os.path.join(REAL, name))
    p, n = sample(mesh, 120000)
    # Level by the floor scraps and turn the grain onto the room's, then fit x/z. ICP alone can't find the
    # yaw: the floor scraps are flat and GLB_1's chairs are torn.
    y0 = floor_height(p, n)
    sc = SCALE[name]
    p = (p - [0, y0, 0]) * sc
    ps, ns = p[::6], n[::6]
    best = None
    # Start from each Layout chair, and from a grid over the room: CHAIR_1 was taken against the East wall.
    starts = list(chairs) + [(x, z) for x in np.arange(X0 + 0.4, X1 - 0.3, 0.4) for z in np.arange(Z0 + 0.4, Z1 - 0.3, 0.5)]
    for c in starts:
        for k in range(2):
            M0 = mat4(rot_y(np.radians(GRAIN_DEG[name]) + k * np.pi), [c[0], 0, c[1]])
            mask = lambda q: in_room(q, 0.1)
            M = icp(ps, ns, tree, tgt, tgt_n, M0, dists=(0.3, 0.15, 0.08, 0.04, 0.02), iters=4, mask=mask, planar='xz')
            r = residual(M, ps, tree, mask)
            score = r['inlierShareLt5cm'] - r['medianM']
            if best is None or score > best[0]:
                best = (score, M, r)
    _, M, r = best
    M = icp(p, n, tree, tgt, tgt_n, M, dists=(0.03, 0.02, 0.015), iters=8, mask=lambda q: in_room(q, 0.1), planar='xz')
    r = residual(M, p, tree, lambda q: in_room(q, 0.1))
    print(name, '→', r, flush=True)
    return M @ mat4(np.eye(3), [0, -y0 * sc, 0], sc), r


def entry(M, note, res=None, flip=np.eye(3)):
    e = {'matrix': [rounded(row, 6) for row in M], 'note': note}
    R = M[:3, :3]
    s = float(np.cbrt(np.linalg.det(R)))
    e['scale'] = round(s, 5)
    e['yawDeg'] = round(float(np.degrees(yaw_of(R @ flip / s))), 3)  # of the fit after any Y-down flip
    if res:
        e['residual'] = res
    return e


def main():
    os.makedirs(CACHE, exist_ok=True)
    M1, tgt, tgt_n = room_target()
    tree = cKDTree(tgt)
    if '--chairs' in sys.argv:
        return refit_chairs(tgt, tgt_n, tree)
    out = {
        'version': 1,
        'frame': "lounge-v1's room frame: meters, +Y up, floor at y = 0, walls on the axes (x -1.568..1.55, z -3.545..3.673)",
        'formula': 'room = matrix · [p_file, 1] (4x4, row-major). Splats: p_file is the raw PLY position (stored Y down).',
        'sources': {},
    }
    S = out['sources']
    S['POLYCAM_ROOM_GLB_1.glb'] = entry(M1, "Main Capture: lounge-v1's meshTransform")
    for name in ['POLYCAM_ROOM_GLB_2.glb', 'POLYCAM_ROOM_GLB_3.glb']:
        M, r = fit_room_mesh(name, tgt, tgt_n, tree)
        S[name] = entry(M, 'floor level, wall occupancy, then point-to-plane ICP to GLB_1', r)
    M, r = fit_room_mesh(os.path.join('KIRI_ENGINE_CHAIR_1', 'model.obj'), tgt, tgt_n, tree, scale='--kiri-scale' in sys.argv)
    S['KIRI_ENGINE_CHAIR_1/model.obj'] = entry(M, "KIRI's whole-room scene: floor level, wall occupancy, then point-to-plane ICP to GLB_1", r)

    for name in ['ROOM_1', 'ROOM_2']:
        R, s, t = splat_fit(name)
        S[f'SPLAT_{name}.ply'] = entry(mat4(R @ F, t, s), f'docs/research/lounge-compare/align-{name}.json full fit (room = t + s R F p_raw), tilt included', flip=F)

    layout_path = os.path.join(V2, 'layout.json')
    with open(layout_path) as f:
        layout = json.load(f)
    chairs = [it['box']['position'][::2] for it in layout['items'] if it['category'] == 'chair']
    for name in ['POLYCAM_CHAIR_1.glb', 'POLYCAM_CHAIR_2.glb']:
        M, r = fit_chair(name, tgt, tgt_n, tree, chairs)
        S[name] = entry(M, 'Detail Capture, not to scale (align.py SCALE): leveled by its floor, turned so its floor grain runs along x, then ICP (x/z) to GLB_1 from each Layout chair and a grid over the room, best fit', r)
    for name, M in layout['sourceTransforms'].items():
        S[name] = entry(np.array(M), 'KIRI Layout: its walls fitted to the room walls (layout.py)')
    write_json(os.path.join(V2, 'align.json'), out)


def refit_chairs(tgt, tgt_n, tree):
    path = os.path.join(V2, 'align.json')
    with open(path) as f:
        out = json.load(f)
    with open(os.path.join(V2, 'layout.json')) as f:
        layout = json.load(f)
    chairs = [it['box']['position'][::2] for it in layout['items'] if it['category'] == 'chair']
    for name in ['ROOM_1', 'ROOM_2']:
        R, s, t = splat_fit(name)
        out['sources'][f'SPLAT_{name}.ply'] = entry(mat4(R @ F, t, s), f'docs/research/lounge-compare/align-{name}.json full fit (room = t + s R F p_raw), tilt included', flip=F)
    for name in ['POLYCAM_CHAIR_1.glb', 'POLYCAM_CHAIR_2.glb']:
        M, r = fit_chair(name, tgt, tgt_n, tree, chairs)
        out['sources'][name] = entry(M, 'Detail Capture, not to scale (align.py SCALE): leveled by its floor, turned so its floor grain runs along x, then ICP (x/z) to GLB_1 from each Layout chair and a grid over the room, best fit', r)
    write_json(path, out)


if __name__ == '__main__':
    main()
