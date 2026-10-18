import os
# Load a Polycam splat PLY, move into the room frame (full fit incl. tilt), cache as npz.
import numpy as np, json, sys
D=os.environ.get('REPO', '.') + '/'
name = sys.argv[1]  # ROOM_1
path = D+f'data/scans/real-scans/SPLAT_{name}.ply'
al = json.load(open(D+f'docs/research/lounge-compare/align-{name}.json'))['full']
with open(path,'rb') as f:
    hdr = b''
    while not hdr.endswith(b'end_header\n'): hdr += f.readline()
    props = [l.split()[-1].decode() for l in hdr.split(b'\n') if l.startswith(b'property')]
    n = int([l for l in hdr.split(b'\n') if l.startswith(b'element vertex')][0].split()[-1])
    a = np.fromfile(f, dtype=np.float32, count=n*len(props)).reshape(n, len(props))
P = {p:i for i,p in enumerate(props)}
raw = a[:, [P['x'],P['y'],P['z']]].astype(np.float64)
F = np.diag([1,-1,-1.])
R = np.array(al['R']); s = al['scale']; t = np.array(al['t'])
xyz = t + s * (raw @ F.T @ R.T)
C0 = 0.28209479177387814
rgb = np.clip(0.5 + C0 * a[:, [P['f_dc_0'],P['f_dc_1'],P['f_dc_2']]], 0, 1)
op = 1/(1+np.exp(-a[:, P['opacity']]))
sc = np.exp(a[:, [P['scale_0'],P['scale_1'],P['scale_2']]]) * s
np.savez(f'{sys.argv[2]}/splat_{name}.npz', xyz=xyz.astype(np.float32), rgb=rgb.astype(np.float32), op=op.astype(np.float32), sc=sc.astype(np.float32))
print(name, n, xyz.min(0).round(2), xyz.max(0).round(2))
