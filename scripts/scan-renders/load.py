import numpy as np, sys
SH_C0 = 0.28209479177387814
def load(path):
    with open(path, 'rb') as f:
        n = None
        while True:
            line = f.readline().decode().strip()
            if line.startswith('element vertex'): n = int(line.split()[-1])
            if line == 'end_header': break
        a = np.frombuffer(f.read(n * 14 * 4), dtype='<f4').reshape(n, 14)
    xyz = a[:, :3].astype(np.float64)
    rgb = np.clip(0.5 + SH_C0 * a[:, 3:6], 0, 1)
    op = 1 / (1 + np.exp(-a[:, 6]))
    return xyz, rgb, op
if __name__ == '__main__':
    for p in sys.argv[1:]:
        xyz, rgb, op = load(p)
        print(p.split('/')[-1], len(xyz))
        print('  min', xyz.min(0).round(2), 'max', xyz.max(0).round(2))
        print('  p1', np.percentile(xyz, 1, 0).round(2), 'p99', np.percentile(xyz, 99, 0).round(2))
        print('  rgb mean', rgb.mean(0).round(2), 'opacity mean', op.mean().round(2))
