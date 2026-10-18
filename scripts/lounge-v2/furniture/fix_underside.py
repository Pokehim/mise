# Rebuild the underside of the chair's seat pan. The Poisson shell under the seat was built from torn data (leg
# stubs, the bracket, hole patches) and hung below the seat as a lumpy blob. Everything under the cushion's lower
# rim is cut away and the hole is closed with a surface that follows CHAIR_1's own underside (smooth and almost
# flat, 0.39-0.41 m), measured as a height field.
# usage: python fix_underside.py <shell.ply> <chair1_crop.glb> <icp12.json> <out.ply>
import json, sys
import numpy as np
import trimesh, pymeshlab
from scipy import ndimage as ndi, sparse
from scipy.spatial.transform import Rotation as Rot

shell, c1, icp_path, out = sys.argv[1:5]
BOX = 0.27           # the seat's footprint, half size (x and z)
CUT_Y = 0.39         # anything lower than this under the seat goes
FLOOR_Y = 0.388      # the underside stays above the metal frame (0.375-0.385)

m = trimesh.load(shell, process=True)
c, n = m.triangles_center, m.face_normals
under = (np.abs(c[:, 0]) < BOX) & (np.abs(c[:, 2]) < BOX) & ((c[:, 1] < CUT_Y) | ((n[:, 1] < -0.25) & (c[:, 1] < 0.435)))
m.update_faces(~under); m.remove_unreferenced_vertices()
parts = m.split(only_watertight=False)
m = max(parts, key=lambda p: len(p.faces))
print('cut', int(under.sum()), 'faces; kept the main piece of', len(parts))

# CHAIR_1's underside as a height field y(x, z), and its mirror (the chair is symmetric)
ic = json.load(open(icp_path))
cm = trimesh.load(c1, force='mesh')
p, f = trimesh.sample.sample_surface(cm, 600000, seed=4)
R = Rot.from_rotvec(ic['rotvec'])
p = ic['s'] * R.apply(p) + ic['t']; q = R.apply(cm.face_normals[f])
down = (q[:, 1] < -0.5) & (np.abs(p[:, 0]) < BOX) & (np.abs(p[:, 2]) < BOX) & (p[:, 1] > 0.30) & (p[:, 1] < 0.45)
pts = np.concatenate([p[down], p[down] * [-1, 1, 1]])
G = 0.01
nx = int(2 * BOX / G)
ix = ((pts[:, 0] + BOX) / G).astype(int).clip(0, nx - 1); iz = ((pts[:, 2] + BOX) / G).astype(int).clip(0, nx - 1)
grid = np.full((nx, nx), np.nan)
order = np.lexsort((pts[:, 1], iz, ix))
cells = ix[order] * nx + iz[order]
starts = np.r_[0, np.flatnonzero(np.diff(cells)) + 1]; ends = np.r_[starts[1:], len(cells)]
for s, e in zip(starts, ends):
    grid.flat[cells[s]] = pts[order][(s + e) // 2, 1]          # median height in the cell
hole = np.isnan(grid)
idx = ndi.distance_transform_edt(hole, return_distances=False, return_indices=True)
grid = ndi.gaussian_filter(grid[idx[0], idx[1]], 2.0)
grid = np.maximum(grid, FLOOR_Y)
print('underside height field: %.3f..%.3f m (CHAIR_1 points %d)' % (grid.min(), grid.max(), down.sum()))
def height(x, z):
    return ndi.map_coordinates(grid, [(x + BOX) / G - 0.5, (z + BOX) / G - 0.5], order=1, mode='nearest')

ms = pymeshlab.MeshSet()
ms.add_mesh(pymeshlab.Mesh(vertex_matrix=m.vertices, face_matrix=m.faces))
ms.meshing_close_holes(maxholesize=4000, newfaceselected=True, selfintersection=False)
for _ in range(4):
    ms.meshing_surface_subdivision_midpoint(iterations=1, threshold=pymeshlab.PercentageValue(0.4), selected=True)
mm = ms.current_mesh()
V, F = mm.vertex_matrix().copy(), mm.face_matrix()
sel = mm.face_selection_array()
patch_v = np.unique(F[sel])
rim_v = np.unique(F[~sel])
inner = np.setdiff1d(patch_v, rim_v)
for _ in range(30):     # relax the patch in x/z, then lay it on the height field
    nb = np.zeros_like(V); cnt = np.zeros(len(V))
    for a, b in ((0, 1), (1, 2), (2, 0)):
        np.add.at(nb, F[sel][:, a], V[F[sel][:, b]]); np.add.at(cnt, F[sel][:, a], 1)
        np.add.at(nb, F[sel][:, b], V[F[sel][:, a]]); np.add.at(cnt, F[sel][:, b], 1)
    avg = nb[inner] / np.maximum(cnt[inner], 1)[:, None]
    V[inner, 0] = 0.5 * V[inner, 0] + 0.5 * avg[:, 0]
    V[inner, 2] = 0.5 * V[inner, 2] + 0.5 * avg[:, 2]
    V[inner, 1] = height(V[inner, 0], V[inner, 2])
out_m = trimesh.Trimesh(V, F, process=True)
out_m.fix_normals()

# The middle of the pan's rear wall is a flat hole patch, 2-3 mm inside the curve around it (CHAIR_1 has a hole
# there).
# The wall there is laid on a smooth surface z(x, y), symmetric in x, fitted to the outer side of the wall around
# it (a 70th-percentile fit outward: a patch cut across a convex wall only ever lies inside it), fading out at the
# wall's edges. (Before the smoothing below, which then irons out the slivers left at the patch's old edge.)
# (the facing used to pick vertices is averaged over a few rings, so a folded sliver doesn't drop out of the pick)
e = out_m.edges_unique
A = sparse.coo_matrix((np.ones(2 * len(e)), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(len(out_m.vertices),) * 2).tocsr()
A = sparse.diags(1 / np.asarray(A.sum(1)).ravel()) @ A
def facing(m):
    n = m.vertex_normals.copy()
    for _ in range(6):
        n = A @ n
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
V = out_m.vertices.copy()
nz = facing(out_m)[:, 2]
x, y, z = V[:, 0].copy(), V[:, 1].copy(), V[:, 2].copy()
def feats(x, y):
    xx, yy = x / 0.17, (y - 0.44) / 0.04
    return np.stack([np.ones_like(x), xx ** 2, xx ** 4, yy, yy ** 2, yy ** 3, xx ** 2 * yy, xx ** 2 * yy ** 2], 1)
wall = (z < -0.10) & (y > 0.40) & (y < 0.475) & (np.abs(x) < 0.17) & (nz < -0.3)
Xf, zw = feats(x[wall], y[wall]), z[wall]
b = np.linalg.lstsq(Xf, zw, rcond=None)[0]
for _ in range(15):
    r = zw - Xf @ b
    wt = np.where(r < 0, 0.7, 0.3) / np.maximum(np.abs(r), 0.0005)
    b = np.linalg.lstsq(Xf * np.sqrt(wt)[:, None], zw * np.sqrt(wt), rcond=None)[0]
fade = (np.clip((0.17 - np.abs(x)) / 0.04, 0, 1) * np.clip((y - 0.40) / 0.012, 0, 1) * np.clip((0.475 - y) / 0.015, 0, 1)
        * np.clip((-0.3 - nz) / 0.2, 0, 1) * (z < -0.10))
V[:, 2] = z + fade * (feats(x, y) @ b - z)
print('rear wall laid on a smooth surface: %d vertices, moved up to %.1f mm' % ((fade > 0).sum(), 1000 * np.abs(V[:, 2] - z).max()))
out_m = trimesh.Trimesh(V, out_m.faces, process=False)
out_m.fix_normals()

# The pan's lower walls, where the new underside meets the old shell, keep a jagged seam: Taubin smoothing (keeps the volume) over the walls below the cushion's rim, fading out above it and
# toward faces that look up (the cushion), so nothing steps
V = out_m.vertices.copy()
ny = facing(out_m)[:, 1]
w = np.clip((0.465 - V[:, 1]) / 0.03, 0, 1) * np.clip((0.6 - ny) / 0.3, 0, 1)
for _ in range(120):
    V += 0.5 * w[:, None] * (A @ V - V)
    V += -0.53 * w[:, None] * (A @ V - V)
V[:, 1] = np.maximum(V[:, 1], FLOOR_Y + 0.006)
print('smoothed the lower walls: %d vertices, moved up to %.1f mm' % ((w > 0).sum(), 1000 * np.abs(V - out_m.vertices).max()))
out_m = trimesh.Trimesh(V, out_m.faces, process=False)
out_m.fix_normals()
# Last, over the whole shell: folds (neighbouring faces turned more than 100 degrees, along the seat's rim, the
# backrest posts and the back's corners), the seat's crinkled lower edge, and spikes (a vertex more than 0.8 edge lengths off its neighbours'
# average) are relaxed with a few rings around them, so no sliver or point sticks out of the surface. No vertex moves
# more than 3 mm (the spikes are at most ~4 mm), 6 mm on the seat's lower edge: the backrest's thin rims are sharp
# too, and must keep their outline
V0 = out_m.vertices.copy()
for _ in range(3):
    fa = out_m.face_adjacency_angles
    bad = np.zeros(len(out_m.vertices), bool)
    bad[out_m.face_adjacency_edges[fa > np.radians(100)].ravel()] = True
    V = out_m.vertices.copy()
    el = out_m.edges_unique_length; e = out_m.edges_unique
    ml = np.bincount(e.ravel(), weights=np.r_[el, el], minlength=len(V)) / np.maximum(np.bincount(e.ravel(), minlength=len(V)), 1)
    bad |= np.linalg.norm(A @ V - V, axis=1) > 0.8 * ml
    bad |= V0[:, 1] < 0.445          # the seat's lower edge, all round: the captures left it crinkled (2-3 mm)
    sel = bad.astype(float)
    for _ in range(2):
        sel = np.maximum(sel, (A @ sel > 0) * 1.0)
    for _ in range(20):
        V += 0.6 * sel[:, None] * (A @ V - V)
    d = V - V0; n = np.linalg.norm(d, axis=1, keepdims=True)
    cap = np.where(V0[:, 1] < 0.445, 0.006, 0.003)[:, None]
    V = V0 + d * np.minimum(1, cap / np.maximum(n, 1e-12))
    print('relaxed %d folds/spikes (%d vertices with their rings), moved up to %.1f mm'
          % (bad.sum(), (sel > 0).sum(), 1000 * np.linalg.norm(V - V0, axis=1).max()))
    out_m = trimesh.Trimesh(V, out_m.faces, process=False)
    out_m.fix_normals()
print('watertight', out_m.is_watertight, 'faces', len(out_m.faces), 'y min', out_m.bounds[0][1].round(3))
out_m.export(out)
