import os
import trimesh, numpy as np, json, pymeshlab
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation as Rot
SC=os.environ['WORK'] + '/cache/'
ic = json.load(open(SC+'icp12.json')); R1 = Rot.from_rotvec(ic['rotvec'])
legs = json.load(open(SC+'legs.json'))
def leg_dist(P):
    dmin = np.full(len(P), 9.0)
    for i in ('1','2'):
        for k, (x0, z0, dx, dz, r0, r1) in legs[i].items():
            a = np.array([x0, 0, z0]); d = np.array([dx, 1, dz]); d /= np.linalg.norm(d)
            v = P - a; perp = v - np.outer(v @ d, d)
            dmin = np.minimum(dmin, np.linalg.norm(perp, axis=1) - (r0 + r1*P[:,1]))
    return dmin
def samp(i, n):
    m = trimesh.load(SC+f'chair{i}_crop.glb', force='mesh')
    p, f = trimesh.sample.sample_surface_even(m, n, radius=0.0007, seed=i) if False else trimesh.sample.sample_surface(m, n, seed=i)
    q = m.face_normals[f]
    if i == 1: p = ic['s'] * R1.apply(p) + ic['t']; q = R1.apply(q)
    keep = (p[:,1] > 0.355) & ~((p[:,1] < 0.43) & (leg_dist(p) < 0.008))
    return p[keep], q[keep]
M = np.array([-1,1,1.])
p1, n1 = samp(1, 900000); p2, n2 = samp(2, 900000)
# symmetric primary: choose side with fewer holes per location: left half (x<0) primary
L = p1[:,0] <= 0; Rh = ~L
pl, nl = p1[L], n1[L]; pr, nr = p1[Rh]*M, n1[Rh]*M   # right half mirrored into left
tl = cKDTree(pl)
d, _ = tl.query(pr); fill = d > 0.010      # right-half data where left half has a hole
A = np.concatenate([pl, pr[fill]]); An = np.concatenate([nl, nr[fill]])
# chair-2 filler (mirrored to left too) where chair-1 has nothing within 10 mm
p2l = np.where(p2[:,[0]] > 0, p2*M, p2); n2l = np.where(p2[:,[0]] > 0, n2*M, n2)
d2, _ = cKDTree(A).query(p2l); f2 = d2 > 0.020
A = np.concatenate([A, p2l[f2]]); An = np.concatenate([An, n2l[f2]])
print('left primary', len(pl), 'filled from right', fill.sum(), 'from chair2', f2.sum())
A = A[A[:,0] <= 0.0]; An = An[:len(A)] if False else An[(np.concatenate([pl, pr[fill], p2l[f2]])[:,0] <= 0.0)]
P = np.concatenate([A, A*M]); N = np.concatenate([An, An*M])
ok = np.linalg.norm(N, axis=1) > 0.5
P, N = P[ok], N[ok] / np.linalg.norm(N[ok], axis=1, keepdims=True)
sel = np.random.default_rng(0).choice(len(P), min(900000, len(P)), replace=False)
ms = pymeshlab.MeshSet(); ms.add_mesh(pymeshlab.Mesh(vertex_matrix=P[sel], v_normals_matrix=N[sel]))
ms.generate_surface_reconstruction_screened_poisson(depth=9, scale=1.1, samplespernode=1.5, pointweight=4.0, preclean=False, threads=1)
m = ms.current_mesh(); q = m.vertex_scalar_array()
print('poisson', m.vertex_number(), 'q pct', np.percentile(q, [1,5,10,50]).round(3))
V = ms.current_mesh().vertex_matrix(); F = ms.current_mesh().face_matrix()
dd, _ = cKDTree(P).query(V)
keepv = dd < 0.006
F = F[keepv[F].all(1)]
used = np.unique(F); remap = -np.ones(len(V), int); remap[used] = np.arange(len(used))
ms2 = pymeshlab.MeshSet(); ms2.add_mesh(pymeshlab.Mesh(vertex_matrix=V[used], face_matrix=remap[F]))
ms2.meshing_remove_connected_component_by_face_number(mincomponentsize=20000)
ms2.save_current_mesh(SC+'shell4_poisson.ply')
print('kept faces', ms2.current_mesh().face_number())
