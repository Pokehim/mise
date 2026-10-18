import os
import trimesh, numpy as np, json
from scipy.spatial import cKDTree
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation as Rot
SC=os.environ['WORK'] + '/cache/'
a = trimesh.load(SC+'chair1_crop.glb', force='mesh'); b = trimesh.load(SC+'chair2_crop.glb', force='mesh')
pa, _ = trimesh.sample.sample_surface(a, 60000, seed=1); pb, _ = trimesh.sample.sample_surface(b, 200000, seed=2)
tb = cKDTree(pb)
x = np.zeros(7); x[6] = 1.0  # rotvec(3), t(3), log-scale
def tf(x, p): return np.exp(x[6]-1) * Rot.from_rotvec(x[:3]).apply(p) + x[3:6] if False else x[6] * Rot.from_rotvec(x[:3]).apply(p) + x[3:6]
for it in range(30):
    q = tf(x, pa); d, i = tb.query(q)
    k = d < max(np.percentile(d, 80), 0.004)
    A, B = pa[k], pb[i[k]]
    x = least_squares(lambda y: (tf(y, A) - B).ravel(), x, loss='soft_l1', f_scale=0.005).x
q = tf(x, pa); d, _ = tb.query(q)
print('chair1->chair2: scale', round(x[6],5), 'rot deg', np.degrees(np.linalg.norm(x[:3])).round(3), 't mm', (x[3:6]*1000).round(1))
print('dist mm median %.2f p80 %.2f p95 %.2f' % tuple(np.percentile(d, [50,80,95])*1000))
d2, _ = cKDTree(q).query(pb); print('reverse (chair2->chair1) mm median %.2f p80 %.2f p95 %.2f' % tuple(np.percentile(d2, [50,80,95])*1000))
json.dump({'rotvec': x[:3].tolist(), 't': x[3:6].tolist(), 's': x[6]}, open(SC+'icp12.json','w'))
