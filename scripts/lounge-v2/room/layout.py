"""layout.json (#77 part 1): the KIRI Layout's items in the room frame.

KIRI_ENGINE_ROOM_1/room.usdz is the Layout; KIRI_ENGINE_ROOM_2 (turned 90°, one window missing) is only a
cross-check. Each Layout is lined up by hand-picked turn (which wall has the North window) and by matching the
centers of its walls and the room's; its floor is the walls' bottom.

KIRI's labels don't all match the room: ROOM_1's 3.5 m "window" on the East wall is the whiteboard, and its 3.1 m
"door" on the South wall is the glass wall, which has a door in it. layout.json keeps KIRI's labels in `kiriKind`
and says what each one really is in `kind`.
"""
import os

import numpy as np
from pxr import Usd, UsdGeom

from common import REAL, V2, X0, X1, Z0, Z1, mat4, rot_y, rounded, write_json

# Which way each Layout is turned in the room (found from its windows and doors; see the docstring).
TURN = {'KIRI_ENGINE_ROOM_1': np.pi, 'KIRI_ENGINE_ROOM_2': -np.pi / 2}
WALL_NAMES = {(0, -1): 'North wall', (1, 0): 'East wall', (0, 1): 'South wall', (-1, 0): 'West wall'}


def items(name):
    st = Usd.Stage.Open(os.path.join(REAL, name, 'room.usdz'))
    xc = UsdGeom.XformCache()
    bc = UsdGeom.BBoxCache(Usd.TimeCode.Default(), ['default', 'render'])
    out = []
    for p in st.GetPrimAtPath('/room/Geom/Node_0/Node_1/Node_2').GetChildren():
        M = np.array(xc.GetLocalToWorldTransform(p)).T
        r = bc.ComputeUntransformedBound(p).ComputeAlignedRange()
        lo, hi = np.array(r.GetMin()), np.array(r.GetMax())
        center = M @ np.append((lo + hi) / 2, 1)
        axes = M[:3, :3]
        size = (hi - lo) * np.linalg.norm(axes, axis=0)
        x = axes[:, 0] / np.linalg.norm(axes[:, 0])
        out.append({'kiriKind': p.GetName().split('_')[0], 'prim': p.GetName(), 'center': center[:3], 'size': size,
                    'yaw': float(np.arctan2(-x[2], x[0]))})
    return out


def fit(name):
    its = items(name)
    walls = [i for i in its if i['kiriKind'] == 'wall']
    floor_y = min(w['center'][1] - w['size'][1] / 2 for w in walls)
    R = rot_y(TURN[name])
    cw = np.mean([w['center'] for w in walls], axis=0)
    # The Layout's wall center goes to the room's.
    t = np.array([(X0 + X1) / 2, -floor_y, (Z0 + Z1) / 2]) - R @ np.array([cw[0], 0, cw[2]])
    return its, mat4(R, t)


def layout(name):
    its, M = fit(name)
    turn = TURN[name]
    walls, openings, boxes = [], [], []
    for it in its:
        c = M[:3, :3] @ it['center'] + M[:3, 3]
        yaw = float(np.angle(np.exp(1j * (it['yaw'] + turn))))
        w, h, d = it['size']
        k = it['kiriKind']
        if k in ('wall', 'window', 'door'):
            # A wall-like item: its width runs along the local x axis.
            along = np.array([np.cos(yaw), -np.sin(yaw)])
            a, b = np.array([c[0], c[2]]) - along * w / 2, np.array([c[0], c[2]]) + along * w / 2
            side = (int(np.round(np.sign(c[0]))) if abs(c[0]) > 1 else 0, int(np.round(np.sign(c[2]))) if abs(c[2]) > 3 else 0)
            entry = {'kiriKind': k, 'wall': WALL_NAMES[side], 'start': rounded(a, 3), 'end': rounded(b, 3),
                     'bottom': round(float(c[1] - h / 2), 3), 'height': round(float(h), 3)}
            if k == 'wall':
                walls.append(entry)
            else:
                kind = k
                if k == 'window' and w > 3:
                    kind = 'whiteboard'      # KIRI read the whiteboard as a window
                elif k == 'door' and w > 2.5:
                    kind = 'glass wall'      # the South glass wall, with a door in it
                openings.append({'kind': kind, **entry})
        elif k in ('table', 'chair'):
            boxes.append({'category': k, 'box': {'position': rounded([c[0], c[1] - h / 2, c[2]], 3),
                                                 'size': rounded([w, h, d], 3), 'rotationY': round(yaw, 4)}})
    boxes.sort(key=lambda b: (b['category'] == 'chair', b['box']['position'][2], b['box']['position'][0]))
    return {'walls': walls, 'openings': openings, 'items': boxes}, M


def main():
    main_layout, M1 = layout('KIRI_ENGINE_ROOM_1')
    check, M2 = layout('KIRI_ENGINE_ROOM_2')
    # Cross-check: each ROOM_1 box against the nearest ROOM_2 box of its category.
    diffs = []
    for it in main_layout['items']:
        p = np.array(it['box']['position'])
        same = [np.array(o['box']['position']) for o in check['items'] if o['category'] == it['category']]
        diffs.append(min(np.linalg.norm((q - p)[::2]) for q in same))
    out = {
        'version': 1,
        'source': 'data/scans/real-scans/KIRI_ENGINE_ROOM_1/room.usdz',
        'frame': "lounge-v1's room frame (see align.json)",
        'note': "Boxes are bottom-center, [width, height, depth] in the box's own frame, as in shared/types.ts Box. "
                "`kiriKind` is KIRI's label; `kind` is what it really is.",
        **main_layout,
        'crossCheck': {
            'source': 'data/scans/real-scans/KIRI_ENGINE_ROOM_2/room.usdz',
            'boxCenterDistanceM': {'median': round(float(np.median(diffs)), 3), 'max': round(float(np.max(diffs)), 3)},
            **check,
        },
        'sourceTransforms': {
            'KIRI_ENGINE_ROOM_1/room.usdz': [rounded(r, 6) for r in M1],
            'KIRI_ENGINE_ROOM_2/room.usdz': [rounded(r, 6) for r in M2],
        },
    }
    write_json(os.path.join(V2, 'layout.json'), out)
    print('walls', [(w['wall'], w['start'], w['end']) for w in main_layout['walls']])
    print('openings', [(o['kind'], o['wall'], o['start'], o['end'], o['bottom'], o['height']) for o in main_layout['openings']])
    print('items', len(main_layout['items']), 'cross-check', out['crossCheck']['boxCenterDistanceM'])


if __name__ == '__main__':
    main()
