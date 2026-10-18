# Stills of the lounge's point cloud, for slides: OUT=dir python final.py lidar-dollhouse color-dollhouse lidar-depth-eye color-points-eye lidar-plan three-passes
import numpy as np, sys, os
from scene import *
from render import *
os.makedirs(OUT, exist_ok=True)
W, H = 1920, 1080
xyz, rgb, heat = room(1)
which = sys.argv[1:]
doll_lidar = [X1 + 3.4, CEIL + 3.8, Z1 + 2.8]
doll_rgb = [X0 - 3.0, CEIL + 3.6, Z1 + 2.4]
eye = np.array([0.55, FLOOR + 1.55, Z1 - 0.9]); tgt = [-0.25, FLOOR + 0.85, Z0]
far = np.linalg.norm(xyz - eye, axis=1) > 0.6
noceil = xyz[:, 1] < CEIL - 0.12
for s in which:
    if s == 'lidar-dollhouse':
        t, fov = frame(doll_lidar, W, H)
        img = render_glow(xyz[noceil], heat[noceil], doll_lidar, t, fov, W, H, gain=0.75, bg=BG)
    if s == 'color-dollhouse':
        k = dollhouse(xyz, doll_rgb)
        t, fov = frame(doll_rgb, W, H)
        img = render_z(xyz[k], rgb[k], doll_rgb, t, fov, W, H, size=0.0065, bg=BG)
    if s == 'lidar-depth-eye':
        d = np.linalg.norm(xyz - eye, axis=1)
        img = render_z(xyz[far], turbo(np.clip(d[far] / 7.5, 0, 1)), eye, tgt, 68, W, H, size=0.0022, bg=BG)
    if s == 'color-points-eye':
        img = render_z(xyz[far], rgb[far], eye, tgt, 68, W, H, size=0.0026, bg=BG)
    if s == 'lidar-plan':
        img = render_glow(xyz[noceil], heat[noceil], [C[0], 15, C[2] + 1e-4], [C[0], 0, C[2]], 33, 1080, 1440, gain=0.55, bg=BG)
    if s == 'three-passes':
        tiles = []
        for i in (1, 2, 3):
            x, r, h = room(i); k = x[:, 1] < CEIL - 0.12
            t, fov = frame(doll_lidar, 960, 600, fill=0.92)
            tiles.append(render_glow(x[k], h[k], doll_lidar, t, fov, 960, 600, gain=0.6, bg=BG))
        img = np.concatenate(tiles, 1)
    save(img, f"{OUT}/{s}.png"); print(s)
