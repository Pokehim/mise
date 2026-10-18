import os
import numpy as np, json
SC=os.environ['WORK'] + '/'
d = np.load(SC+'cache/splat_ROOM_1.npz'); xyz, rgb, op = d['xyz'].astype(float), d['rgb'], d['op']
k = op > 0.2; xyz, rgb = xyz[k], rgb[k]
orange = rgb[:,0] - rgb[:,2] > 0.15
def edge(v, lo, hi, side, step=0.002, frac=0.5):
    h, e = np.histogram(v, bins=np.arange(lo, hi, step)); hs = np.convolve(h, np.ones(3)/3, 'same')
    mid = (e[:-1] > lo + 0.3*(hi-lo)) & (e[:-1] < hi - 0.3*(hi-lo)); plat = np.median(hs[mid & (hs > 0)])
    idx = np.where(hs > frac*plat)[0]
    return (e[idx[0]] if side == 'lo' else e[idx[-1]+1])
rough = {'Table 1': [(-0.075,-1.945),(-0.060,-1.245)], 'Table 2': [(-0.055,-0.535),(-0.065,0.165)], 'Table 3': [(-0.060,1.445),(-0.080,2.145)]}
out = {}
for name, legs in rough.items():
    cents = []
    for (lx, lz) in legs:
        for r in (0.04, 0.025):
            s = (~orange) & (xyz[:,1] > 0.15) & (xyz[:,1] < 0.6) & (np.hypot(xyz[:,0]-lx, xyz[:,2]-lz) < r)
            lx, lz = np.median(xyz[s,0]), np.median(xyz[s,2])
        q = xyz[s]
        cents.append((lx, lz)); print('%s leg at x %.4f z %.4f  n %d  x-spread p10-90 %.3f z-spread %.3f' % (name, lx, lz, s.sum(), *(np.percentile(q[:,0],90)-np.percentile(q[:,0],10), np.percentile(q[:,2],90)-np.percentile(q[:,2],10))))
    (ax, az), (bx, bz) = cents
    yaw = np.arctan2(bx-ax, bz-az)  # angle of leg line from +z toward +x
    mx, mz = (ax+bx)/2, (az+bz)/2
    # local frame: u along leg line (z-ish), w perpendicular (x-ish)
    c, s_ = np.cos(yaw), np.sin(yaw)
    rel = xyz[:, [0,2]] - [mx, mz]
    lu = rel[:,0]*s_ + rel[:,1]*c        # along legs (local z)
    lw = rel[:,0]*c - rel[:,1]*s_        # local x (east-west)
    band = (xyz[:,1] > 0.69) & (xyz[:,1] < 0.72) & (op[k] > 0.3)
    gaps = (np.abs(lw+0.75) < 0.07) | ((lw > -0.12) & (lw < -0.05)) | ((lw > -1.48) & (lw < -1.40))
    uu = lu[band & gaps & (np.abs(lu) < 0.6)]
    u0, u1 = edge(uu, -0.6, 0.6, 'lo'), edge(uu, -0.6, 0.6, 'hi')
    ww = lw[band & (lu > u0+0.1) & (lu < u1-0.1) & (np.abs(lw+0.75) < 0.95)]
    w0, w1 = edge(ww, -1.70, 0.20, 'lo'), edge(ww, -1.70, 0.20, 'hi')
    print('%s yaw %.2f deg | legs mid (%.4f, %.4f) sep %.4f | top local z %.4f..%.4f (D %.4f) | local x %.4f..%.4f (L %.4f)' % (name, np.degrees(yaw), mx, mz, np.hypot(bx-ax, bz-az), u0, u1, u1-u0, w0, w1, w1-w0))
    out[name] = dict(legs=cents, yaw=float(yaw), mid=[mx, mz], top_u=[u0, u1], top_w=[w0, w1])
json.dump(out, open(SC+'cache/tpose.json','w'), indent=1)
