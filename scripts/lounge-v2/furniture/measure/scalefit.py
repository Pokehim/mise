import os
# Fit canonical chair-2 (free scale) into each splat chair. Room frame, y up, floor y=0.
import trimesh, numpy as np, json
from scipy.spatial import cKDTree
from scipy.optimize import least_squares
SC=os.environ['WORK'] + '/cache/'
R=os.environ.get('REPO', '.') + '/data/scans/real-scans/'
T = np.array(json.load(open(SC+'canon.json'))['2'])
m = trimesh.load(R+'POLYCAM_CHAIR_2.glb', force='mesh')
pts, _ = trimesh.sample.sample_surface(m, 400000, seed=0)
w = pts @ T[:3,:3].T + T[:3,3]
model = w[(np.hypot(w[:,0], w[:,2]) < 0.45) & (w[:,1] > 0.012)]
model = model[np.random.default_rng(0).choice(len(model), 30000, replace=False)]
d = np.load(SC+'splat_ROOM_1.npz'); xyz, op = d['xyz'], d['op']
xyz = xyz[(op > 0.3)]
# KIRI chairs (blender x,y) -> room (-x, y); facing: blender rotZ 0 -> ?, decide by table side
kiri = [(0.384,1.37),(0.416,-2.0),(1.182,2.221),(0.399,-1.268),(1.123,-0.551),(0.365,0.134),(0.367,2.221),(0.382,-0.551),(1.106,0.134),(1.138,-1.268),(1.155,-2.0),(1.199,1.37)]
tables_z = [-1.629, -0.213, 1.79]
def roty(a): return np.array([[np.cos(a),0,np.sin(a)],[0,1,0],[-np.sin(a),0,np.cos(a)]])
out = []
for (kx, ky) in kiri:
    cx, cz = -kx, ky
    tz = min(tables_z, key=lambda t: abs(t-cz))
    # front (+Z model) should point toward the table: if table is at larger z, yaw 0; else pi
    yaw0 = 0.0 if tz > cz else np.pi
    box = (np.abs(xyz[:,0]-cx) < 0.42) & (np.abs(xyz[:,2]-cz) < 0.42) & (xyz[:,1] > 0.03) & (xyz[:,1] < 1.0)
    P = xyz[box].astype(np.float64)
    # drop table-top points: inside any table footprint (x in [-1.65,-0.02], |z-tz|<0.42) and y > 0.6
    intab = (P[:,0] > -1.65) & (P[:,0] < -0.02) & (np.abs(P[:,2]-tz) < 0.42) & (P[:,1] > 0.6)
    P = P[~intab]
    x = np.array([yaw0, cx, cz, 1.17])
    if True:
        # coarse yaw/pos search at fixed scale
        best=None
        for dyaw in np.radians(np.arange(-12, 12.1, 3)):
            for dx_ in np.arange(-0.08, 0.081, 0.02):
                for dz_ in np.arange(-0.08, 0.081, 0.02):
                    M = (model[::10] * 1.17) @ roty(yaw0+dyaw).T + [cx+dx_, 0, cz+dz_]
                    dd,_ = cKDTree(M).query(P[::3]); sc_ = np.mean(np.minimum(dd, 0.05))
                    if best is None or sc_ < best[0]: best=(sc_, yaw0+dyaw, cx+dx_, cz+dz_)
        x = np.array([best[1], best[2], best[3], 1.17])
    for it in range(25):
        M = (model * x[3]) @ roty(x[0]).T + [x[1], 0, x[2]]
        tree = cKDTree(M)
        dd, ii = tree.query(P)
        thr = max(np.percentile(dd, 70), 0.01); keep = dd < min(thr, 0.05)
        Pk, mk = P[keep], model[ii[keep]]
        def r(p): return ((mk * p[3]) @ roty(p[0]).T + [p[1], 0, p[2]] - Pk).ravel()
        x = least_squares(r, x, loss='soft_l1', f_scale=0.01).x
    M = (model * x[3]) @ roty(x[0]).T + [x[1], 0, x[2]]
    dd, _ = cKDTree(M).query(P)
    # reverse: model->splat coverage
    out.append(dict(c=[round(cx,3), round(cz,3)], yaw=float(np.degrees(x[0]) % 360), pos=[float(x[1]), float(x[2])], s=float(x[3]), med=float(np.median(dd[dd<0.05])), inl=float((dd<0.03).mean()), n=len(P)))
    print('chair kiri(%.2f,%.2f) -> pos (%.3f, %.3f) yaw %.1f s %.4f  med %.1f mm inl %.2f n %d' % (cx, cz, x[1], x[2], np.degrees(x[0]) % 360, x[3], 1000*np.median(dd[dd<0.05]), (dd<0.03).mean(), len(P)))
s = np.array([o['s'] for o in out])
print('scale median %.4f mean %.4f std %.4f' % (np.median(s), s.mean(), s.std()))
json.dump(out, open(SC+'scalefit.json','w'), indent=1)
