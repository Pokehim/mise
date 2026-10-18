import os
import numpy as np, json
from PIL import Image
SC=os.environ['WORK'] + '/'
a = np.asarray(Image.open(SC+'r/g1f_floorW.png').convert('RGB')).astype(float)/255
lum = a @ [0.2126, 0.7152, 0.0722]
def px(x, z): return int(1850 + (z-0)/0.002), int(1850 + (x+0.3)/0.002)   # 7.4 m / 3700 px = 2 mm/px
def reg(x0, x1, z0, z1):
    r0, c0 = px(x0, z0); r1, c1 = px(x1, z1); v = lum[r0:r1, c0:c1].ravel(); return np.median(v[v > 0.02])
tp = json.load(open(SC+'cache/tpose.json'))
for name, t in tp.items():
    zc = t['mid'][1]
    under = reg(-0.87, -0.73, zc-0.10, zc+0.10)
    under2 = reg(-0.30, -0.15, zc-0.10, zc+0.10)
    openf = reg(0.25, 0.55, zc-0.35, zc+0.35)
    print('%s floor lum under-table center %.3f, under east part %.3f, open floor east %.3f -> ratio %.2f / %.2f' % (name, under, under2, openf, under/openf, under2/openf))
# chair 2 Detail Capture floor (scan units, 1 mm/px, 2 m view centered at scan origin, image up=-z)
b = np.asarray(Image.open(SC+'r/c2_floor.png').convert('RGB')).astype(float)/255
lb = b @ [0.2126, 0.7152, 0.0722]
T = np.array(json.load(open(SC+'cache/canon.json'))['2']); Ti = np.linalg.inv(T)
def cpx(xc, zc):  # canonical (scan units) -> image
    p = Ti @ [xc, 0, zc, 1]; return int(1000 + p[2]/0.001), int(1000 + p[0]/0.001)
def creg(pts):
    v = np.array([lb[cpx(x, z)] for x, z in pts]); return np.median(v[v > 0.02])
g = np.linspace(-0.08, 0.08, 9)
center = creg([(x, z) for x in g for z in g])
ring = creg([(0.45*np.cos(t), 0.45*np.sin(t)) for t in np.linspace(0, 2*np.pi, 200)] + [(0.55*np.cos(t), 0.55*np.sin(t)) for t in np.linspace(0, 2*np.pi, 200)])
print('chair2 capture: under seat %.3f, ring 0.45-0.55 %.3f -> ratio %.2f' % (center, ring, center/ring))
for r in (0.10, 0.15, 0.20, 0.25, 0.30, 0.35):
    print('   radius %.2f lum ratio %.2f' % (r, creg([(r*np.cos(t), r*np.sin(t)) for t in np.linspace(0, 2*np.pi, 300)])/ring))
