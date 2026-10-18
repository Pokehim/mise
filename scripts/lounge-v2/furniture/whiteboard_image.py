# Whiteboard image for models/whiteboard.glb: the board's face cut out of an orthographic, unlit render of
# POLYCAM_ROOM_GLB_1 looking at the East wall from just in front of the board (so nothing in the room
# hides it), 1 mm/px. The render: eye (1.47, 1.615, -0.4) looking +x, 6.6 x 1.63 m, 6600 x 1630 px.
# usage: python whiteboard_image.py <render.png> <out.jpg>
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Z0, Z1 = -3.565, 2.522      # board ends (room z), measured on the render's column brightness
Y0, Y1 = 0.845, 2.330       # bottom of the tray, top of the top trim
u = lambda z: round((z + 3.7) * 1000)
v = lambda y: round((2.43 - y) * 1000)
im = Image.open(sys.argv[1]).convert('RGB').crop((u(Z0), v(Y1), u(Z1), v(Y0)))
# holes in the mesh render as the black background: fill them from the nearest board pixels, then soften the fill
a = np.asarray(im).astype(float)
hole = ndi.binary_dilation(a.max(2) < 20, iterations=2)
idx = ndi.distance_transform_edt(hole, return_distances=False, return_indices=True)
filled = a[idx[0], idx[1]]
soft = np.stack([ndi.gaussian_filter(filled[..., k], 6) for k in range(3)], -1)
a[hole] = soft[hole]
im = Image.fromarray(a.round().astype(np.uint8))
print('filled hole pixels', int(hole.sum()))
im.save(sys.argv[2], quality=93)
print('board image', im.size)
