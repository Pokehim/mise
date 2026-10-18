import os
import numpy as np, json
SC=os.environ['WORK'] + '/'
d = np.load(SC+'cache/splat_ROOM_1.npz'); xyz, rgb, op = d['xyz'].astype(float), d['rgb'], d['op']
k = op > 0.3; xyz, rgb = xyz[k], rgb[k]
tp = json.load(open(SC+'cache/tpose.json'))
def peak(v, lo, hi, step=0.002):
    h, e = np.histogram(v, bins=np.arange(lo, hi, step)); c = e[:-1] + step/2
    hs = np.convolve(h, [1,2,3,2,1], 'same')/9
    i = hs.argmax()
    # subbin: parabola fit
    if 0 < i < len(hs)-1:
        a, b, cc = hs[i-1], hs[i], hs[i+1]; off = 0.5*(a-cc)/(a-2*b+cc) if (a-2*b+cc) != 0 else 0
    else: off = 0
    return c[i] + off*step, hs.max(), np.median(hs)
res = {}
for name, t in tp.items():
    yaw = t['yaw']; mx, mz = t['mid']; c, s_ = np.cos(yaw), np.sin(yaw)
    rel = xyz[:, [0,2]] - [mx, mz]
    lu = rel[:,0]*s_ + rel[:,1]*c; lw = rel[:,0]*c - rel[:,1]*s_
    band = (xyz[:,1] > 0.675) & (xyz[:,1] < 0.735)
    mid_w = band & (lw > -1.45) & (lw < -0.12)
    mid_u = band & (np.abs(lu) < 0.30)
    zn = peak(lu[mid_w], -0.45, -0.32); zs = peak(lu[mid_w], 0.32, 0.45)
    xe = peak(lw[mid_u], -0.06, 0.08); xw = peak(lw[mid_u], -1.65, -1.45)
    # top height: points in mid region top band, mode with fine bins
    hy = xyz[band & (lw > -1.4) & (lw < -0.15) & (np.abs(lu) < 0.3), 1]
    print('%s north edge u %.4f (pk %.0f/med %.0f) south %.4f (%.0f/%.0f) -> D %.4f, center-u %.4f | east w %.4f (%.0f/%.0f) west %.4f (%.0f/%.0f) -> L %.4f' % (name, zn[0], zn[1], zn[2], zs[0], zs[1], zs[2], zs[0]-zn[0], (zs[0]+zn[0])/2, xe[0], xe[1], xe[2], xw[0], xw[1], xw[2], xe[0]-xw[0]))
    res[name] = dict(u=[zn[0], zs[0]], w=[xw[0], xe[0]])
json.dump(res, open(SC+'cache/tedges.json','w'), indent=1)
