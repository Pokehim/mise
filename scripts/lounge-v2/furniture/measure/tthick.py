import os
import numpy as np, json
SC=os.environ['WORK'] + '/'
d = np.load(SC+'cache/splat_ROOM_1.npz'); xyz, rgb, op = d['xyz'].astype(float), d['rgb'], d['op']
k = op > 0.3; xyz, rgb = xyz[k], rgb[k]
tp = json.load(open(SC+'cache/tpose.json')); te = json.load(open(SC+'cache/tedges.json'))
for name, t in tp.items():
    yaw = t['yaw']; mx, mz = t['mid']; c, s_ = np.cos(yaw), np.sin(yaw)
    rel = xyz[:, [0,2]] - [mx, mz]
    lu = rel[:,0]*s_ + rel[:,1]*c; lw = rel[:,0]*c - rel[:,1]*s_
    e = te[name]
    ef = (np.abs(lu - e['u'][1]) < 0.006) & (lw > -1.4) & (lw < -0.15) & (xyz[:,1] > 0.6) & (xyz[:,1] < 0.76)
    ef2 = (np.abs(lw - e['w'][1]) < 0.006) & (np.abs(lu) < 0.3) & (xyz[:,1] > 0.6) & (xyz[:,1] < 0.76)
    for nm, sel in (('south face', ef), ('east face', ef2)):
        y = xyz[sel, 1]; h, b = np.histogram(y, bins=np.arange(0.6, 0.76, 0.004))
        print(name, nm, 'n', sel.sum(), 'y p5/p50/p95 %.3f %.3f %.3f' % tuple(np.percentile(y, [5,50,95])), ' '.join('%.3f:%d' % (b[j], h[j]) for j in range(len(h)) if h[j] > 0.2*h.max()))
    # legs: y-profile of leg points (width) to find caster / apron
    for (lx, lz) in t['legs']:
        s = (np.hypot(xyz[:,0]-lx, xyz[:,2]-lz) < 0.05) & (xyz[:,1] < 0.72)
        q = xyz[s]
        prof = []
        for y0 in np.arange(0.0, 0.72, 0.04):
            m = (q[:,1] >= y0) & (q[:,1] < y0+0.04)
            if m.sum() > 5: prof.append('%.2f:%d/%.0fmm/L%.2f' % (y0, m.sum(), 1000*(np.percentile(np.hypot(q[m,0]-lx, q[m,2]-lz), 80)), rgb[s][m].mean()))
        print('   leg', ' '.join(prof))
    break
