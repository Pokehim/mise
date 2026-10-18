"""Shared bits for the lounge-v2 room scripts (issue #77). Hard-coded to the study lounge.

Run everything with scripts/lounge-v2/.venv/bin/python (numpy, scipy, usd-core, trimesh, pillow, opencv).
"""
import json
import os
import subprocess

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
REAL = os.path.join(ROOT, 'data', 'scans', 'real-scans')
V1 = os.path.join(ROOT, 'data', 'scans', 'lounge-v1')
V2 = os.path.join(ROOT, 'data', 'scans', 'lounge-v2')
COMPARE = os.path.join(ROOT, 'docs', 'research', 'lounge-compare')
CACHE = os.path.join(ROOT, 'scripts', '.cache', 'lounge-v2')  # gitignored

# lounge-v1's room frame: inner faces of the walls, floor at y = 0. Images (ortho.py, textures.py) are laid out on
# these lines.
X0, X1, Z0, Z1, H = -1.568, 1.55, -3.545, 3.673, 2.431
# The Empty Room's walls: each the median plane of the Main Capture's wall (#77), about 2 cm outside lounge-v1's
# lines. The South one is the plane of the door and the glass wall.
WX0, WX1, WZ0, WZ1 = -1.5907, 1.5759, -3.5652, 3.6244

F = np.diag([1.0, -1.0, -1.0])  # 180° about X: both Polycam splats are stored Y down


def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def yaw_of(R):
    """The yaw that best matches a near-upright rotation."""
    return float(np.arctan2(R[0, 2] - R[2, 0], R[0, 0] + R[2, 2]))


def mat4(R, t, s=1.0):
    M = np.eye(4)
    M[:3, :3] = s * np.asarray(R)
    M[:3, 3] = t
    return M


def splat_fit(name):
    """room = t + scale * R * F * p_raw, from the comparison's fit (docs/research/lounge-compare)."""
    with open(os.path.join(COMPARE, f'align-{name}.json')) as f:
        full = json.load(f)['full']
    return np.array(full['R']), float(full['scale']), np.array(full['t'])


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=2)
        f.write('\n')


def rounded(a, n=4):
    return [round(float(v), n) for v in np.asarray(a).ravel()]


# ───────── Splat PLY ─────────

def read_ply(path):
    """A 3DGS binary PLY (float properties only) as a structured numpy array."""
    with open(path, 'rb') as f:
        head = b''
        while not head.endswith(b'end_header\n'):
            head += f.readline()
        lines = head.decode('latin1').split('\n')
        count = next(int(l.split()[2]) for l in lines if l.startswith('element vertex'))
        names = [l.split()[2] for l in lines if l.startswith('property')]
        assert all(l.split()[1] == 'float' for l in lines if l.startswith('property'))
        data = np.fromfile(f, dtype=np.dtype([(n, '<f4') for n in names]), count=count)
    return data


def write_ply(path, data):
    names = data.dtype.names
    head = ['ply', 'format binary_little_endian 1.0', f'element vertex {len(data)}']
    head += [f'property float {n}' for n in names] + ['end_header', '']
    with open(path, 'wb') as f:
        f.write('\n'.join(head).encode('latin1'))
        data.astype(np.dtype([(n, '<f4') for n in names])).tofile(f)


def quat_from_mat(R):
    from scipy.spatial.transform import Rotation
    x, y, z, w = Rotation.from_matrix(R).as_quat()
    return np.array([w, x, y, z])


def quat_mul(a, b):
    """a * b for (w, x, y, z) quaternions; b may be an (n, 4) array."""
    aw, ax, ay, az = a
    bw, bx, by, bz = b[:, 0], b[:, 1], b[:, 2], b[:, 3]
    return np.stack([
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    ], axis=1)


def transform_splats(data, R, t=(0, 0, 0), s=1.0, keep_sh=False):
    """Moves splats by p -> t + s R p (R a proper rotation). Drops the normals, and the higher SH bands
    unless keep_sh (they'd need rotating too, and the app ships SH 0)."""
    p = np.stack([data['x'], data['y'], data['z']], axis=1).astype(np.float64)
    p = p @ np.asarray(R).T * s + np.asarray(t)
    q = np.stack([data[f'rot_{i}'] for i in range(4)], axis=1).astype(np.float64)
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    q = quat_mul(quat_from_mat(R), q)
    names = [n for n in data.dtype.names if n not in ('nx', 'ny', 'nz') and (keep_sh or not n.startswith('f_rest_'))]
    out = np.zeros(len(data), dtype=np.dtype([(n, '<f4') for n in names]))
    for n in names:
        out[n] = data[n]
    out['x'], out['y'], out['z'] = p.T
    for i in range(4):
        out[f'rot_{i}'] = q[:, i]
    if s != 1.0:
        for i in range(3):
            out[f'scale_{i}'] = data[f'scale_{i}'] + np.log(s)
    return out


def to_spz(ply, scan, max_splats=1500000, out_name='splat.spz'):
    """Runs scripts/splat.sh on an already-cropped PLY (no --box)."""
    env = dict(os.environ, SPLAT_MAX=str(max_splats))
    subprocess.run([os.path.join(ROOT, 'scripts', 'splat.sh'), ply, '--scan', scan, '--out', out_name], check=True, env=env)
