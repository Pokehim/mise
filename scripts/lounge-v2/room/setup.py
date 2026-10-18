"""The lounge's setup.json and manifest.json (#77 part 1, spec §5).

The walls are the Main Capture's median planes (common.py), about 2 cm outside lounge-v1's; the ceiling is
lounge-v1's. The Openings are measured on
orthographic views of the Main Capture (ortho.py, 2 mm per pixel) and checked against the KIRI Layout
(layout.json). `originals` stays [] here: part B owns it, so an existing list is kept.

Until part 2 writes empty-room.glb, the editor draws its stand-in room from this setup.json.
"""
import json
import os

from common import H, SCAN, WX0, WX1, WZ0, WZ1, X0, X1, Z0, Z1, write_json

OPENINGS = [
    # North wall (wl_1, from x = -1.568): the one window, its frame as KIRI's scene shows it sharply (the Main
    # Capture's is fogged by glare; KIRI's Layout says offset 0.644, width 1.532). As common.GLAZING frames it.
    {'id': 'op_1', 'kind': 'window', 'wallId': 'wl_1', 'offset': 0.555, 'width': 1.65, 'bottom': 0.89, 'height': 1.47},
    # West wall (wl_4, from z = 3.673): the main door, a glass storefront with two mullions.
    {'id': 'op_2', 'kind': 'door', 'wallId': 'wl_4', 'offset': 0.03, 'width': 1.79, 'bottom': 0, 'height': 2.25, 'swing': 'none'},
    # South wall (wl_3, from x = 1.55): the wood door at the East end, then the glass wall to the West corner.
    # KIRI reads both as one 3.1 m door.
    {'id': 'op_3', 'kind': 'door', 'wallId': 'wl_3', 'offset': 0.03, 'width': 0.92, 'bottom': 0, 'height': 2.28, 'swing': 'none'},
    {'id': 'op_4', 'kind': 'window', 'wallId': 'wl_3', 'offset': 1.01, 'width': 2.1307, 'bottom': 0, 'height': 2.27},
]


# The walls on their fitted planes (common.py), each running from its start corner, in setup.json's order.
CORNERS = [(WX0, WZ0), (WX1, WZ0), (WX1, WZ1), (WX0, WZ1)]
WALLS = [('wl_1', 'North wall', 0, 1, (0, 1)), ('wl_2', 'East wall', 1, 2, (-1, 0)),
         ('wl_3', 'South wall', 2, 3, (0, -1)), ('wl_4', 'West wall', 3, 0, (1, 0))]
# How far each fitted wall's start is along its old line (OPENINGS' offsets are from the old start).
START_SHIFT = {'wl_1': WX0 - X0, 'wl_2': WZ0 - Z0, 'wl_3': X1 - WX1, 'wl_4': Z1 - WZ1}


def moved(o):
    """An Opening measured from its wall's old start, from the fitted wall's start (clipped to the wall)."""
    offset = o['offset'] - START_SHIFT[o['wallId']]
    return {**o, 'offset': round(max(offset, 0), 4), 'width': round(o['width'] + min(offset, 0), 4)}


def setup():
    path = os.path.join(SCAN, 'setup.json')
    originals = []
    if os.path.exists(path):
        with open(path) as f:
            originals = json.load(f).get('originals', [])
    return {
        'version': 1,
        'scanId': 'lounge',
        'ceilingHeight': H,
        'floor': {'polygon': [[round(x, 4), round(z, 4)] for x, z in CORNERS]},
        'walls': [{'id': i, 'name': n, 'start': [round(v, 4) for v in CORNERS[a]], 'end': [round(v, 4) for v in CORNERS[b]],
                   'normal': list(nrm), 'height': H} for i, n, a, b, nrm in WALLS],
        'openings': [moved(o) for o in OPENINGS],
        'originals': originals,
    }


MANIFEST = {
    'version': 1,
    'id': 'lounge',
    'name': 'Oliver Hall 6th Floor Study Lounge',
    'mine': True,
    'mesh': 'empty-room.glb',
    'meshTransform': {'position': [0, 0, 0], 'rotationY': 0},
    # No splat: on every surface the mesh looks more real than ROOM_1's or ROOM_2's splats (splat_empty.py).
}


def main():
    s = setup()
    write_json(os.path.join(SCAN, 'setup.json'), s)
    write_json(os.path.join(SCAN, 'manifest.json'), MANIFEST)
    print('wrote setup.json, manifest.json')


if __name__ == '__main__':
    main()
