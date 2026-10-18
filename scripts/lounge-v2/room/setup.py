"""lounge-v2's setup.json and manifest.json (#77 part 1, spec §5).

The floor, walls, and ceiling are lounge-v1's (measured from the Main Capture). The Openings are measured on
orthographic views of the Main Capture (ortho.py, 2 mm per pixel) and checked against the KIRI Layout
(layout.json). `originals` stays [] here: part B owns it, so an existing list is kept.

Until part 2 writes empty-room.glb, the editor draws its stand-in room from this setup.json.
"""
import json
import os

from common import H, V1, V2, write_json

with open(os.path.join(V1, 'setup.json')) as f:
    v1 = json.load(f)

OPENINGS = [
    # North wall (wl_1, from x = -1.568): the one window. KIRI: offset 0.644, width 1.532.
    {'id': 'op_1', 'kind': 'window', 'wallId': 'wl_1', 'offset': 0.65, 'width': 1.55, 'bottom': 0.87, 'height': 1.46},
    # West wall (wl_4, from z = 3.673): the main door, a glass storefront with two mullions.
    {'id': 'op_2', 'kind': 'door', 'wallId': 'wl_4', 'offset': 0.03, 'width': 1.79, 'bottom': 0, 'height': 2.25, 'swing': 'none'},
    # South wall (wl_3, from x = 1.55): the wood door at the East end, then the glass wall to the West corner.
    # KIRI reads both as one 3.1 m door.
    {'id': 'op_3', 'kind': 'door', 'wallId': 'wl_3', 'offset': 0.02, 'width': 0.94, 'bottom': 0, 'height': 2.27, 'swing': 'none'},
    {'id': 'op_4', 'kind': 'window', 'wallId': 'wl_3', 'offset': 1.0, 'width': 2.113, 'bottom': 0, 'height': 2.26},
]


def setup():
    path = os.path.join(V2, 'setup.json')
    originals = []
    if os.path.exists(path):
        with open(path) as f:
            originals = json.load(f).get('originals', [])
    return {
        'version': 1,
        'scanId': 'lounge-v2',
        'ceilingHeight': H,
        'floor': v1['floor'],
        'walls': v1['walls'],
        'openings': OPENINGS,
        'originals': originals,
    }


MANIFEST = {
    'version': 1,
    'id': 'lounge-v2',
    'name': 'Study lounge v2',
    'mesh': 'empty-room.glb',
    'meshTransform': {'position': [0, 0, 0], 'rotationY': 0},
    'splat': 'empty-room.spz',
    'splatTransform': {'position': [0, 0, 0], 'rotationY': 0, 'scale': 1},
}


def main():
    s = setup()
    write_json(os.path.join(V2, 'setup.json'), s)
    write_json(os.path.join(V2, 'manifest.json'), MANIFEST)
    print('wrote setup.json, manifest.json')


if __name__ == '__main__':
    main()
