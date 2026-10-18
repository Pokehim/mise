import os
import trimesh, numpy as np, json
from scipy.spatial import cKDTree
SC=os.environ['WORK'] + '/cache/'
R=os.environ.get('REPO', '.') + '/data/scans/real-scans/'
def roty(a): return np.array([[np.cos(a),0,np.sin(a)],[0,1,0],[-np.sin(a),0,np.cos(a)]])
CAN = json.load(open(SC+'canon.json'))
def canon_pts(i, n=600000):
    T = np.array(CAN[str(i)])
    m = trimesh.load(R+f'POLYCAM_CHAIR_{i}.glb', force='mesh')
    p, _ = trimesh.sample.sample_surface(m, n, seed=0)
    w = p @ T[:3,:3].T + T[:3,3]
    return w[(np.hypot(w[:,0], w[:,2]) < 0.45) & (w[:,1] > 0.005)]
def stats(w, s):
    # w in canonical frame, in meters-ish units of that source; s = scale of chair (1 for chair-2 units)
    cz = -0.01*s
    seat = w[(np.abs(w[:,0]) < 0.05*s) & (np.abs(w[:,2]-cz) < 0.05*s) & (w[:,1] > 0.3*s) & (w[:,1] < 0.5*s)]
    back = w[(np.abs(w[:,0]) < 0.12*s) & (w[:,2] < -0.1*s) & (w[:,1] > 0.6*s)]
    return dict(seat=np.percentile(seat[:,1], [10,50,90]) if len(seat) else None, nseat=len(seat), back=np.percentile(back[:,1], [95, 99, 99.9, 100]) if len(back) else None, nback=len(back))
for i in (1,2):
    w = canon_pts(i)
    print('scan', i, stats(w, 1.0 if i==2 else 0.81))
    # seat profile along z at x~0
    sl = w[(np.abs(w[:,0]) < 0.03)]
    for z0 in np.arange(-0.25, 0.25, 0.03):
        q = sl[(sl[:,2] >= z0) & (sl[:,2] < z0+0.03) & (sl[:,1] > 0.25)]
        if len(q): print('   z %.2f  y top %.3f  y n %d' % (z0, q[:,1].max(), len(q)))
