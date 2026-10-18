# models/whiteboard.glb: the East wall's whiteboard, rebuilt as a flat board plus its trim and tray, carrying
# POLYCAM_ROOM_GLB_1's image of it (whiteboard_image.py) so the writing stays readable.
# usage: Blender -b --python whiteboard.py -- <board.jpg> <out.glb> <tmpdir>
# Frame: meters, +Y up, front +Z (into the room), +X along the board (room +z when placed with rotationY = -pi/2).
# Origin: center of the footprint on the floor; the back of the board is at z = -DEPTH/2, against the wall.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from bl_util import reset, box, mesh_object, unlit_material, join, recalc_normals, soft_rect_alpha, shadow_plane, export

board_jpg, out, tmp = sys.argv[sys.argv.index('--') + 1:][:3]
W = 2.522 + 3.565           # 6.087 m, end to end
Y0, Y1 = 0.845, 2.330       # tray bottom, top trim top
DEPTH = 0.033               # tray front, from the wall (GLB_1 profile)
BOARD_T = 0.012             # board face, from the wall
TRIM = 0.012                # end trims' width
TOP_TRIM = 0.018
TRAY_TOP = 0.885
ZB = -DEPTH / 2             # wall plane

reset()
img = bpy.data.images.load(board_jpg)
mat = unlit_material('whiteboard', image=img)

def projected(name, x0, x1, y0, y1, z0, z1):
    """Box whose every face samples the board image by planar projection onto the wall."""
    v, f = box(x0, x1, y0, y1, z0, z1)
    uvs = []
    for face in f:
        for i in face:
            x, y = v[i][0], v[i][2]          # Blender (x, -z, y)
            uvs.append(((x + W / 2) / W, (y - Y0) / (Y1 - Y0)))
    return mesh_object(name, v, f, uvs=uvs, mats=[mat])

board = projected('board', -W / 2 + TRIM, W / 2 - TRIM, TRAY_TOP, Y1 - TOP_TRIM, ZB, ZB + BOARD_T)
recalc_normals(board)
pieces = [
    projected('trim_top', -W / 2, W / 2, Y1 - TOP_TRIM, Y1, ZB, ZB + BOARD_T + 0.004),
    projected('trim_l', -W / 2, -W / 2 + TRIM, TRAY_TOP, Y1 - TOP_TRIM, ZB, ZB + BOARD_T + 0.004),
    projected('trim_r', W / 2 - TRIM, W / 2, TRAY_TOP, Y1 - TOP_TRIM, ZB, ZB + BOARD_T + 0.004),
    projected('tray', -W / 2, W / 2, Y0, TRAY_TOP - 0.020, ZB, ZB + DEPTH),            # tray bottom
    projected('tray_lip', -W / 2, W / 2, TRAY_TOP - 0.020, TRAY_TOP, ZB + DEPTH - 0.006, ZB + DEPTH),
    projected('tray_back', -W / 2, W / 2, TRAY_TOP - 0.020, TRAY_TOP, ZB, ZB + BOARD_T + 0.004),
]
frame = join(pieces, 'frame')
recalc_normals(frame)

# shadow on the wall: a soft dark band under the tray and a thin halo around the board's edges
res = 0.004
w_px, h_px = int((W + 0.12) / res), int((Y1 - Y0 + 0.20) / res)
ys = Y1 + 0.10 - (np.arange(h_px) + 0.5) * res          # row 0 = top
xs = (np.arange(w_px) - w_px / 2 + 0.5) * res
X, Yg = np.meshgrid(xs, ys)
inside_x = np.clip((W / 2 - np.abs(X)) / 0.01 + 0.5, 0, 1)
band = 0.35 * np.exp(-((Y0 - Yg).clip(0)) / 0.025) * (Yg < Y0) * inside_x
dx = np.maximum(np.abs(X) - W / 2, 0); dy = np.maximum(Yg - Y1, 0) + np.maximum(Y0 - Yg, 0)
halo = 0.15 * np.exp(-np.hypot(dx, dy) / 0.012) * ((np.abs(X) > W / 2) | (Yg > Y1))
alpha = 1 - (1 - band) * (1 - halo)

shadow_plane('shadow', alpha, res, (0.0, 0.0), 0.0, tmp, vertical_wall=(ZB + 0.001, Y0 - 0.10))

export(out, ['board', 'frame', 'shadow'])
print('exported', out)
