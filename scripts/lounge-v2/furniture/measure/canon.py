import os
# Canonicalize each chair scan: floor plane -> y=0, footprint center -> origin, back toward -Z (front +Z), symmetry plane x=0.
import trimesh, numpy as np, json
from scipy.cluster.vq import kmeans2
from scipy.spatial import cKDTree
R=os.environ.get('REPO', '.') + '/data/scans/real-scans/'
OUT=os.environ['WORK'] + '/cache/'
C = {1: (-0.107, -0.24), 2: (-0.013, -0.08)}
def roty(a): return np.array([[np.cos(a),0,np.sin(a)],[0,1,0],[-np.sin(a),0,np.cos(a)]])
def apply(T, v): return v @ T[:3,:3].T + T[:3,3]
def feet_of(w):
    f = w[(np.hypot(w[:,0], w[:,2]) < 0.5) & (w[:,1] > 0.012) & (w[:,1] < 0.05)]
    cen, lab = kmeans2(f[:,[0,2]], 4, minit='++', seed=3)
    return cen[np.argsort(np.arctan2(cen[:,1], cen[:,0]))]
res = {}
for i in (1,2):
    m = trimesh.load(R+f'POLYCAM_CHAIR_{i}.glb', force='mesh')
    v = m.vertices.copy()
    cx, cz = C[i]
    d = np.hypot(v[:,0]-cx, v[:,2]-cz)
    fl = (d > 0.45) & (d < 0.9) & (v[:,1] < 0.06)
    A = np.c_[v[fl][:,0], v[fl][:,2], np.ones(fl.sum())]; b = v[fl][:,1]
    coef, *_ = np.linalg.lstsq(A, b, rcond=None)
    for it in range(4):
        k = np.abs(b - A@coef) < 0.006
        coef, *_ = np.linalg.lstsq(A[k], b[k], rcond=None)
    n = np.array([-coef[0], 1, -coef[1]]); n /= np.linalg.norm(n)
    ax = np.cross(n, [0,1,0]); s = np.linalg.norm(ax); c = n[1]
    K = np.array([[0,-ax[2],ax[1]],[ax[2],0,-ax[0]],[-ax[1],ax[0],0]])
    Rl = np.eye(3) + K + K@K*((1-c)/s**2)
    p0 = np.array([cx, coef[0]*cx+coef[1]*cz+coef[2], cz])
    T = np.eye(4); T[:3,:3] = Rl; T[:3,3] = -Rl@p0
    w = apply(T, v)
    ft = feet_of(w)
    # rectangle orientation from 4 edges (mod 90deg)
    angs = []
    for j in range(4):
        e = ft[(j+1)%4] - ft[j]; angs.append(np.arctan2(e[1], e[0]) % (np.pi/2))
    angs = np.array(angs); ref = angs[0]
    angs = ref + ((angs - ref + np.pi/4) % (np.pi/2) - np.pi/4)
    th = angs.mean()  # edges at angle th; rotate by -th about Y (in xz plane)
    fc = ft.mean(0)
    # rotation in xz by -th: x' = cos x + sin z ... roty(a) maps (x,z)->(c x + s z, -s x + c z) which rotates by -a in (x,z) angle
    Ry = roty(th)
    T2 = np.eye(4); T2[:3,:3] = Ry; T2[:3,3] = -Ry @ np.array([fc[0],0,fc[1]])
    T = T2 @ T; w = apply(T, v)
    near = np.hypot(w[:,0], w[:,2]) < 0.5
    hm = w[near & (w[:,1] > 0.012), 1].max(); hi = w[near & (w[:,1] > 0.85*hm)]
    bd = hi[:,[0,2]].mean(0)
    # rotate by multiple of 90 so back -> -Z
    best = max(range(4), key=lambda q: -(roty(q*np.pi/2) @ np.array([bd[0],0,bd[1]]))[2])
    T3 = np.eye(4); T3[:3,:3] = roty(best*np.pi/2)
    T = T3 @ T; w = apply(T, v)
    ch = w[(np.hypot(w[:,0], w[:,2]) < 0.45) & (w[:,1] > 0.02)]
    ch = ch[np.random.default_rng(0).choice(len(ch), min(30000, len(ch)), replace=False)]
    def score(a, dx):
        q = ch @ roty(a).T; q[:,0] -= dx
        dd, _ = cKDTree(q).query(q * [-1,1,1]); return np.median(dd)
    a0, d0 = 0.0, 0.0
    for step_a, step_d, n_ in ((np.radians(1.0), 0.004, 4), (np.radians(0.25), 0.001, 4), (np.radians(0.06), 0.0003, 3)):
        cand = [(score(a0+ia*step_a, d0+id_*step_d), a0+ia*step_a, d0+id_*step_d) for ia in range(-n_, n_+1) for id_ in range(-n_, n_+1)]
        sc_, a0, d0 = min(cand)
    T4 = np.eye(4); T4[:3,:3] = roty(a0); T5 = np.eye(4); T5[0,3] = -d0
    T = T5 @ T4 @ T; w = apply(T, v)
    ft = feet_of(w)
    chm = w[(np.hypot(w[:,0], w[:,2]) < 0.5) & (w[:,1] > 0.012)]
    print(i, 'floor tilt', np.degrees(np.arccos(n[1])).round(2), 'sym median', round(sc_*1000,2), 'mm')
    print('  feet', np.round(ft, 4).tolist())
    print('  chair extents x', chm[:,0].min().round(3), chm[:,0].max().round(3), 'z', chm[:,2].min().round(3), chm[:,2].max().round(3), 'h', chm[:,1].max().round(3))
    res[i] = T.tolist()
json.dump(res, open(OUT+'canon.json','w'))
