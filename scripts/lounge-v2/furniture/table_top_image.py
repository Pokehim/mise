# Tabletop image for models/table.glb: the three tables' tops seen straight down in POLYCAM_ROOM_GLB_1,
# resampled into the table's own frame, combined by per-pixel median (drops each table's clutter and
# mesh blotches), reduced to a smooth quadratic light falloff (no smudges), and scaled so
# its median color matches the tops' color in SPLAT_ROOM_1.
#
# usage: python table_top_image.py <renders dir with gtop_T1..3.png> <tpose.json> <out.png>
# The renders are orthographic top-down views of GLB_1 in the room frame, 1 mm/px, 2000 px square,
# centered at (x=-0.8, z=-1.6 / -0.2 / 1.8), image up = -z (see render specs in build_all.sh).
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi  # map_coordinates

renders, tpose_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
tp = json.load(open(tpose_path))
CENTERS = {'Table 1': ('T1', -0.8, -1.6), 'Table 2': ('T2', -0.8, -0.2), 'Table 3': ('T3', -0.8, 1.8)}
L, D = 1.515, 0.750          # top size, measured (see README)
EAST = 0.018                 # east edge, measured from the leg line
SPLAT_TOP = np.array([225, 206, 187]) / 255.0   # median top color in SPLAT_ROOM_1
RES = 0.001
W, H = int(round(L / RES)), int(round(D / RES))

stack = []
for name, (tag, cx, cz) in CENTERS.items():
    img = np.asarray(Image.open(f'{renders}/gtop_{tag}.png').convert('RGB')).astype(float) / 255
    t = tp[name]; yaw = t['yaw']; mx, mz = t['mid']; c, s = np.cos(yaw), np.sin(yaw)
    # pixel grid in the table frame: w (east, along x) and u (along the leg line, z)
    w = EAST - L + (np.arange(W) + 0.5) * RES
    u = -D / 2 + (np.arange(H) + 0.5) * RES
    ww, uu = np.meshgrid(w, u)
    x = mx + ww * c + uu * s
    z = mz - ww * s + uu * c
    col = (x - cx) / RES + 1000
    row = (z - cz) / RES + 1000
    sample = np.stack([ndi.map_coordinates(img[..., k], [row, col], order=1) for k in range(3)], -1)
    stack.append(sample)
stack = np.stack(stack)
# reject non-top pixels (chair backs, holes): too dark or too saturated
lum = stack.mean(-1); sat = stack.max(-1) - stack.min(-1)
bad = (lum < 0.6) | (sat > 0.25)
stack[bad] = np.nan
med = np.nanmedian(stack, 0)
hole = np.isnan(med).any(-1)
# keep only the light falloff: a quadratic surface per channel fitted to the valid pixels. The
# GLB_1 texture's patch-to-patch exposure jumps and the smudges are both finer than that.
yy, xx = np.mgrid[0:H, 0:W]; xn, yn = xx / W - 0.5, yy / H - 0.5
A = np.stack([np.ones_like(xn), xn, yn, xn*xn, yn*yn, xn*yn], -1)
ok = ~hole
low = np.stack([(A @ np.linalg.lstsq(A[ok], med[ok][:, k], rcond=None)[0]) for k in range(3)], -1)
low *= SPLAT_TOP / np.median(low.reshape(-1, 3), 0)
Image.fromarray((np.clip(low, 0, 1) * 255).round().astype(np.uint8)).resize((2048, 1024), Image.LANCZOS).save(out)
print('top image', out, 'median', (np.median(low.reshape(-1, 3), 0) * 255).round(), 'holes', round(hole.mean(), 3))
