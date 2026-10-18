import os
import trimesh, numpy as np, json
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation as Rot
SC=os.environ['WORK'] + '/cache/'
ic = json.load(open(SC+'icp12.json'))
def load(i):
    m = trimesh.load(SC+f'chair{i}_crop.glb', force='mesh')
    p, _ = trimesh.sample.sample_surface(m, 400000, seed=i)
    if i == 1: p = ic['s'] * Rot.from_rotvec(ic['rotvec']).apply(p) + ic['t']
    return p
def fit_leg(P):
    # axis: x = x0 + dx*y, z = z0 + dz*y ; r = r0 + r1*y
    c = P.mean(0)
    x = np.array([c[0], c[2], 0, 0, 0.015, 0.0])
    def res(q):
        x0, z0, dx, dz, r0, r1 = q
        a = np.array([x0, 0, z0]); d = np.array([dx, 1, dz]); d = d/np.linalg.norm(d)
        v = P - a; perp = v - np.outer(v @ d, d)
        return np.linalg.norm(perp, axis=1) - (r0 + r1*P[:,1])
    for it in range(3):
        r = least_squares(res, x, loss='soft_l1', f_scale=0.002)
        x = r.x
    rr = res(x)
    return x, np.median(np.abs(rr))
out = {}
for i in (1, 2):
    P = load(i)
    L = P[(P[:,1] > 0.03) & (P[:,1] < 0.30)]
    print('scan', i)
    out[i] = {}
    for sx in (-1, 1):
        for sz in (-1, 1):
            Q = L[(np.sign(L[:,0]) == sx) & (np.sign(L[:,2]) == sz)]
            x, med = fit_leg(Q)
            x0, z0, dx, dz, r0, r1 = x
            key = ('R' if sx < 0 else 'L') + ('B' if sz < 0 else 'F')
            out[i][key] = x.tolist()
            print('  %s n=%6d foot(y=0) x %.4f z %.4f | at y=0.35 x %.4f z %.4f | tilt x %.2fdeg z %.2fdeg | r(0)=%.4f r(.35)=%.4f | resid med %.1fmm' % (key, len(Q), x0, z0, x0+dx*0.35, z0+dz*0.35, np.degrees(np.arctan(dx)), np.degrees(np.arctan(dz)), r0, r0+r1*0.35, med*1000))
json.dump(out, open(SC+'legs.json','w'), indent=1)
