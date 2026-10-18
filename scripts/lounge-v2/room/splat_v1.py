"""lounge-v1's splat, right side up (#77 part 1).

SPLAT_ROOM_1.ply is stored Y down and tilted. This bakes the flip and the leftover tilt into the file, crops
it to the room box in the room frame, and leaves only yaw, scale, and position for manifest.splatTransform,
since the app can only turn a splat about Y.

    room = t + s R F p_raw = t + s RotY(yaw) (T F p_raw),  T = RotY(-yaw) R  (the tilt)
"""
import json
import os
import sys

import numpy as np

from common import CACHE, H, V1, X0, X1, Z0, Z1, F, read_ply, rot_y, rounded, splat_fit, to_spz, transform_splats, write_ply, yaw_of, REAL

MARGIN = 0.1  # m past the room box that's kept, so the splats on the walls stay whole

R, s, t = splat_fit('ROOM_1')
yaw = yaw_of(R)
T = rot_y(-yaw) @ R
print(f'yaw {np.degrees(yaw):.2f}°, tilt {np.degrees(np.arccos((np.trace(T) - 1) / 2)):.2f}°, scale {s}')

data = read_ply(os.path.join(REAL, 'SPLAT_ROOM_1.ply'))
up = transform_splats(data, T @ F)
p = np.stack([up['x'], up['y'], up['z']], axis=1) @ rot_y(yaw).T * s + t
inside = ((p[:, 0] > X0 - MARGIN) & (p[:, 0] < X1 + MARGIN) & (p[:, 2] > Z0 - MARGIN) & (p[:, 2] < Z1 + MARGIN)
          & (p[:, 1] > -MARGIN) & (p[:, 1] < H + MARGIN))
# The cleaning of d9bcc31: drop near-transparent and very large splats (floaters, smears).
opacity = 1 / (1 + np.exp(-up['opacity']))
size = np.exp(np.max([up[f'scale_{i}'] for i in range(3)], axis=0)) * s
inside &= (opacity >= 0.1) & (size <= 0.25)
print(f'kept {inside.sum()} of {len(up)} splats inside the room box')

os.makedirs(CACHE, exist_ok=True)
ply = os.path.join(CACHE, 'lounge-v1-upright.ply')
write_ply(ply, up[inside])
if '--no-spz' not in sys.argv:
    to_spz(ply, 'lounge-v1')

path = os.path.join(V1, 'manifest.json')
with open(path) as f:
    manifest = json.load(f)
manifest['splatTransform'] = {'position': rounded(t), 'rotationY': round(yaw, 6), 'scale': round(s, 4)}
with open(path, 'w') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
print('splatTransform', manifest['splatTransform'])
