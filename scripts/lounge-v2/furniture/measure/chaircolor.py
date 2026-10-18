import os
import numpy as np, json
SC=os.environ['WORK'] + '/'
d = np.load(SC+'cache/splat_ROOM_1.npz'); xyz, rgb, op = d['xyz'].astype(float), d['rgb'], d['op']
k = op > 0.5; xyz, rgb = xyz[k], rgb[k]
fits = [f for f in json.load(open(SC+'cache/scalefit.json')) if f['med'] < 0.008]
def roty(a): return np.array([[np.cos(a),0,np.sin(a)],[0,1,0],[-np.sin(a),0,np.cos(a)]])
back, seat, legs = [], [], []
for f in fits:
    a = np.radians(f['yaw']); q = (xyz - [f['pos'][0], 0, f['pos'][1]]) @ roty(a)
    c = rgb
    b = (np.abs(q[:,0]) < 0.17) & (q[:,2] < -0.12) & (q[:,2] > -0.32) & (q[:,1] > 0.58) & (q[:,1] < 0.84)
    s = (np.abs(q[:,0]) < 0.15) & (np.abs(q[:,2]) < 0.12) & (q[:,1] > 0.43) & (q[:,1] < 0.48)
    l = (np.abs(q[:,0]) < 0.26) & (np.abs(q[:,2]) < 0.26) & (q[:,1] > 0.02) & (q[:,1] < 0.36) & (c[:,0] - c[:,2] > 0.15)
    back.append(c[b]); seat.append(c[s]); legs.append(np.c_[q[l,1], c[l]])
back, seat, legs = np.concatenate(back), np.concatenate(seat), np.concatenate(legs)
s8 = lambda v: (np.round(v*255)).astype(int).tolist()
print('back (white shell) median', s8(np.median(back, 0)), len(back))
print('seat top median', s8(np.median(seat, 0)), len(seat), ' green-ish subset', s8(np.median(seat[seat[:,1] > seat[:,0]], 0)))
for y0 in np.arange(0.0, 0.36, 0.05):
    m = (legs[:,0] >= y0) & (legs[:,0] < y0 + 0.05)
    print('legs y %.2f-%.2f median %s n %d' % (y0, y0+0.05, s8(np.median(legs[m,1:], 0)), m.sum()))
