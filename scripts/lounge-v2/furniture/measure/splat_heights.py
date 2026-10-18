import os
import numpy as np, json
SC=os.environ['WORK'] + '/cache/'
def roty(a): return np.array([[np.cos(a),0,np.sin(a)],[0,1,0],[-np.sin(a),0,np.cos(a)]])
d = np.load(SC+'splat_ROOM_1.npz'); xyz, op = d['xyz'], d['op']; k = op > 0.3; xyz = xyz[k].astype(np.float64); sc = d['sc'][k]
fits = json.load(open(SC+'scalefit.json'))
S0 = 1.165
rows = []
for f in fits:
    a = np.radians(f['yaw']); px, pz = f['pos']
    q = (xyz - [px, 0, pz]) @ roty(a)  # inverse rotation: canonical = R^T (p - t)
    near = (np.abs(q[:,0]) < 0.3) & (np.abs(q[:,2]) < 0.35) & (q[:,1] < 1.0)
    q = q[near]
    seat = q[(np.abs(q[:,0]) < 0.06) & (np.abs(q[:,2] + 0.01*S0) < 0.06) & (q[:,1] > 0.38) & (q[:,1] < 0.6)]
    back = q[(np.abs(q[:,0]) < 0.12) & (q[:,2] < -0.1) & (q[:,1] > 0.7)]
    hs = np.histogram(seat[:,1], bins=np.arange(0.38, 0.6, 0.01))[0] if len(seat) else []
    print('chair (%.2f,%.2f) seat n=%d med %.3f p75 %.3f | back n=%d p95 %.3f p99 %.3f max %.3f | fit s %.3f med %.1fmm' % (px, pz, len(seat), np.median(seat[:,1]) if len(seat) else 0, np.percentile(seat[:,1],75) if len(seat) else 0, len(back), *(np.percentile(back[:,1],[95,99,100]) if len(back) else (0,0,0)), f['s'], f['med']*1000))
    print('    seat hist 0.38..: ', list(hs))
