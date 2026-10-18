"""empty-room.spz (#77 part 2, spec §3): the Empty Room's surface splats, upright, in meters, in the room frame.

Keeps only splats within a few centimeters of a wall or the floor, from the source chosen for that surface
(SOURCE; None means the mesh alone). Drops: anything in an Original's box (layout.json, grown 10 cm), the
whiteboard, the floor under and around the furniture (its shadows), glass, the ceiling, anything outside the
walls, splats under 5% opacity, and splats over 0.3 m across.

    ../.venv/bin/python splat_empty.py [surface=ROOM_1|ROOM_2|none ...]
"""
import json
import os
import sys

import numpy as np

from common import CACHE, F, H, REAL, V2, X0, X1, Z0, Z1, read_ply, splat_fit, to_spz, transform_splats, write_ply
from textures import FLOOR_MASK, GLASS, MASKS

# Chosen from the 8 shots of spec §6 (#77's second PR): with ROOM_1 on every surface, the walls get smeared
# blotches and the floor a reddish, speckled patch with a hard edge against the mesh, so the mesh alone looks more
# real everywhere. ROOM_2 is worse than ROOM_1 everywhere (docs/research/lounge-compare). So lounge-v2 ships no
# splat; run with e.g. floor=ROOM_1 to try one again.
SOURCE = {'floor': None, 'north': None, 'east': None, 'south': None, 'west': None}
NEAR = 0.03         # m from the surface
MIN_OPACITY = 0.05
MAX_SIZE = 0.3      # m


def room_splats(name):
    R, s, t = splat_fit(name)
    return transform_splats(read_ply(os.path.join(REAL, f'SPLAT_{name}.ply')), R @ F, t, s)


def in_rects(u, y, rects):
    m = np.zeros(len(u), bool)
    for u0, u1, y0, y1 in rects:
        m |= (u >= u0) & (u <= u1) & (y >= y0) & (y <= y1)
    return m


def select(d, surface):
    x, y, z = d['x'], d['y'], d['z']
    opacity = 1 / (1 + np.exp(-d['opacity']))
    size = np.exp(np.max([d[f'scale_{i}'] for i in range(3)], axis=0))
    keep = (opacity >= MIN_OPACITY) & (size <= MAX_SIZE)
    inside = (x > X0 - NEAR) & (x < X1 + NEAR) & (z > Z0 - NEAR) & (z < Z1 + NEAR) & (y > -NEAR) & (y < H - 0.05)
    keep &= inside
    if surface == 'floor':
        keep &= np.abs(y) < NEAR
        for x0, x1, z0, z1 in FLOOR_MASK:
            keep &= ~((x > x0 - 0.05) & (x < x1 + 0.05) & (z > z0 - 0.05) & (z < z1 + 0.05))
        return keep
    # Walls: u along the wall from its start (as in textures.py), and distance from its plane.
    u, dist = {
        'north': (x - X0, z - Z0), 'south': (X1 - x, Z1 - z),
        'east': (z - Z0, X1 - x), 'west': (Z1 - z, x - X0),
    }[surface]
    keep &= np.abs(dist) < NEAR
    keep &= y > 0.02                                   # the floor's own
    keep &= ~in_rects(u, y, MASKS.get(surface, []))
    g = GLASS.get(surface, {})
    keep &= ~in_rects(u, y, g.get('glass', []) + g.get('bars', []))
    return keep


def main():
    choice = dict(SOURCE)
    for arg in sys.argv[1:]:
        k, v = arg.split('=')
        choice[k] = None if v == 'none' else v
    with open(os.path.join(V2, 'layout.json')) as f:
        boxes = [it['box'] for it in json.load(f)['items']]
    parts = []
    cache = {}
    for surface, name in choice.items():
        if not name:
            continue
        if name not in cache:
            cache[name] = room_splats(name)
        d = cache[name]
        keep = select(d, surface)
        for b in boxes:   # inside an Original's box, grown 10 cm
            c, (w, h, dd), a = np.array(b['position']), b['size'], b['rotationY']
            lx = (d['x'] - c[0]) * np.cos(a) - (d['z'] - c[2]) * np.sin(a)
            lz = (d['x'] - c[0]) * np.sin(a) + (d['z'] - c[2]) * np.cos(a)
            keep &= ~((np.abs(lx) < w / 2 + 0.1) & (np.abs(lz) < dd / 2 + 0.1) & (d['y'] < h + 0.1))
        print(f'{surface}: {keep.sum()} splats from {name}', flush=True)
        parts.append(d[keep])
    out = np.concatenate(parts) if parts else None
    if out is None or not len(out):
        sys.exit('no splats chosen')
    os.makedirs(CACHE, exist_ok=True)
    ply = os.path.join(CACHE, 'empty-room.ply')
    write_ply(ply, out)
    to_spz(ply, 'lounge-v2', out_name='empty-room.spz')


if __name__ == '__main__':
    main()
