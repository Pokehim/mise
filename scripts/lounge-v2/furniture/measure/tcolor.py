import os
import numpy as np, json
from PIL import Image
SC=os.environ['WORK'] + '/'
d = np.load(SC+'cache/splat_ROOM_1.npz'); xyz, rgb, op = d['xyz'].astype(float), d['rgb'], d['op']
k = op > 0.5; xyz, rgb = xyz[k], rgb[k]
tp = json.load(open(SC+'cache/tpose.json'))
def srgb(c): return np.round(c*255).astype(int).tolist()
for name, t in tp.items():
    yaw = t['yaw']; mx, mz = t['mid']; c, s_ = np.cos(yaw), np.sin(yaw)
    rel = xyz[:, [0,2]] - [mx, mz]; lu = rel[:,0]*s_ + rel[:,1]*c; lw = rel[:,0]*c - rel[:,1]*s_
    top = (xyz[:,1] > 0.695) & (xyz[:,1] < 0.725) & (lw > -1.4) & (lw < -0.1) & (np.abs(lu) < 0.33)
    legs = np.zeros(len(xyz), bool)
    for (lx, lz) in t['legs']: legs |= (np.hypot(xyz[:,0]-lx, xyz[:,2]-lz) < 0.025) & (xyz[:,1] > 0.15) & (xyz[:,1] < 0.6)
    print(name, 'splat top median rgb', srgb(np.median(rgb[top], 0)), 'n', top.sum(), '| legs', srgb(np.median(rgb[legs], 0)), 'n', legs.sum())
for T in ('T1','T2','T3'):
    a = np.asarray(Image.open(SC+f'r/gtop_{T}.png').convert('RGB')).astype(float)
    # center region of table approx: x -1.3..-0.3 -> cols 500..1500 ; z center +- 0.25 -> rows 750..1250 (approx)
    cen = {'T1': -1.592, 'T2': -0.183, 'T3': 1.798}[T]; base = {'T1': -1.6, 'T2': -0.2, 'T3': 1.8}[T]
    r0 = int(1000 + (cen - base - 0.25)*1000); r1 = int(1000 + (cen - base + 0.25)*1000)
    reg = a[r0:r1, 500:1500].reshape(-1, 3)
    print(T, 'GLB1 top median rgb', np.median(reg, 0).round().astype(int).tolist(), 'p10', np.percentile(reg, 10, 0).round().astype(int).tolist(), 'p90', np.percentile(reg, 90, 0).round().astype(int).tolist())
