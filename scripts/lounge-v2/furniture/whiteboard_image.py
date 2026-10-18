# Whiteboard image for models/whiteboard.glb: the board's face cut out of an orthographic, unlit render of
# POLYCAM_ROOM_GLB_1 looking at the East wall from just in front of the board (so nothing in the room
# hides it), 1 mm/px. The render: eye (1.47, 1.615, -0.4) looking +x, 6.6 x 1.63 m, 6600 x 1630 px.
# The same renders of POLYCAM_ROOM_GLB_3 and _2 (their align.json matrices) repair the spots where GLB_1's mesh
# smeared over the board: the North end (GLB_3), and the top trim 2.0-2.35 m from it (GLB_2).
# usage: python whiteboard_image.py <GLB_1 render.png> <GLB_3 render.png> <GLB_2 render.png> <out.jpg>
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Z0, Z1 = -3.565, 2.522      # board ends (room z), measured on the render's column brightness
Y0, Y1 = 0.845, 2.330       # bottom of the tray, top of the top trim
u = lambda z: round((z + 3.7) * 1000)
v = lambda y: round((2.43 - y) * 1000)
crop = (u(Z0), v(Y1), u(Z1), v(Y0))
a = np.asarray(Image.open(sys.argv[1]).convert('RGB').crop(crop)).astype(float)
b3 = np.asarray(Image.open(sys.argv[2]).convert('RGB').crop(crop)).astype(float)
b2 = np.asarray(Image.open(sys.argv[3]).convert('RGB').crop(crop)).astype(float)
H, W = a.shape[:2]
xx, yy = np.meshgrid(np.arange(W), np.arange(H))
lum = lambda c: c @ [0.2126, 0.7152, 0.0722]

# holes in the mesh render as the black background: fill them from the nearest board pixels, then soften the fill
hole = ndi.binary_dilation(a.max(2) < 20, iterations=2)
idx = ndi.distance_transform_edt(hole, return_distances=False, return_indices=True)
filled = a[idx[0], idx[1]]
soft = np.stack([ndi.gaussian_filter(filled[..., k], 6) for k in range(3)], -1)
a[hole] = soft[hole]
print('filled hole pixels', int(hole.sum()))

# North end, top: GLB_1 has teal and white smears of the corner over the writing; GLB_3 sees it clean. GLB_3 is
# shifted onto GLB_1 by cross-correlating the writing (high-passed brightness) next to it, and matched in light
def hp(c):
    l = lum(c)
    return l - ndi.gaussian_filter(l, 8)
ha, hb = hp(a), hp(b3)
ref = ha[150:1000, 300:1100]
best = (-2, 0, 0)
for dy in range(-40, 41):
    for dx in range(-40, 41):
        c = np.corrcoef(ref.ravel(), hb[150 + dy:1000 + dy, 300 + dx:1100 + dx].ravel())[0, 1]
        if c > best[0]:
            best = (c, dx, dy)
_, dx, dy = best
g3 = np.roll(b3, (-dy, -dx), (0, 1))
top = (xx >= 30) & (xx < 400) & (yy < 760)       # above the Amine line; GLB_3's own edge strip is the teal wall
# light matched to GLB_1 just around the patch, as a smooth gain that varies down the board (the corner is darker
# at the top), so its edge doesn't show
ring = ((xx >= 400) & (xx < 520) & (yy < 760)) | ((xx >= 30) & (xx < 520) & (yy >= 760) & (yy < 860))
gain = np.ones((H, 3))
for y0 in range(0, 860, 20):
    band = ring & (yy >= y0 - 60) & (yy < y0 + 80)
    gain[y0:y0 + 20] = np.median(a[band], 0) / np.median(g3[band], 0)
gain[860:] = gain[859]
gain = ndi.gaussian_filter1d(gain, 30, axis=0)
g3 = g3 * gain[:, None, :]
w = np.clip(ndi.gaussian_filter(top.astype(float), 30), 0, 1) * top
a = a * (1 - w[..., None]) + g3 * w[..., None]
print('North end from GLB_3: shift (%d, %d) px, correlation %.2f' % (dx, dy, best[0]))

# Top trim, 2.0-2.35 m from the North end: a teal sheet of the wall hangs over the trim and the board's top 6 cm in
# GLB_1; GLB_2 sees it clean. Shifted onto GLB_1 by the panel seam and the trim's edge next to it, light matched
# around it
hb2 = hp(b2)
ref2 = ha[45:250, 2400:2900]
best2 = (-2, 0)
for dx in range(-40, 41):
    c = np.corrcoef(ref2.ravel(), hb2[45:250, 2400 + dx:2900 + dx].ravel())[0, 1]
    if c > best2[0]:
        best2 = (c, dx)
dx2 = best2[1]
# up and down by the trim's lower edge, on both sides of the sheet
cols = np.r_[1600:1900, 2500:2900]
prof = lambda c: np.gradient(ndi.gaussian_filter1d(lum(c)[:120, cols].mean(1), 2))
dy2 = int(np.argmax(prof(np.roll(b2, -dx2, 1))) - np.argmax(prof(a)))
g2 = np.roll(b2, (-dy2, -dx2), (0, 1))
patch = (xx >= 1900) & (xx < 2470) & (yy < 140)
ring2 = (((xx >= 1800) & (xx < 1900)) | ((xx >= 2470) & (xx < 2570))) & (yy < 140)
gain2 = np.ones((H, 3))
for y0 in range(0, 140, 10):
    band = ring2 & (yy >= y0 - 15) & (yy < y0 + 25)
    gain2[y0:y0 + 10] = np.median(a[band], 0) / np.median(g2[band], 0)
gain2[140:] = gain2[139]
g2 = g2 * ndi.gaussian_filter1d(gain2, 8, axis=0)[:, None, :]
w2 = np.clip(ndi.gaussian_filter(patch.astype(float), 20) * 2, 0, 1) * ndi.binary_dilation(patch, iterations=40)
w2 = np.maximum(w2, patch * 1.0) * (yy < 180)
a = a * (1 - w2[..., None]) + g2 * w2[..., None]
# the trim itself (the top 30 mm) runs on unchanged: GLB_1's own trim rows on either side, blended across, row by row
left, right = a[:30, 1800:1850].mean(1), a[:30, 2550:2600].mean(1)
t = np.linspace(0, 1, 700)[None, :, None]
a[:30, 1850:2550] = left[:, None] * (1 - t) + right[:, None] * t
print('top trim from GLB_2: shift (%d, %d) px, correlation %.2f' % (dx2, dy2, best2[0]))

# North end, bottom: every capture has the corner's mesh smeared over the board and the tray here (a beige post,
# grey and teal sheets, a white sliver, and teal streaks along the board's last 45 mm), outlined by hand (board pixels, x from the North end, y from the top). They
# are filled with the board's light around them, and the tray with the tray's own rows next to them
BLOTS = [(225, 335, 1255, H), (360, 1015, 1385, H), (695, 760, 1255, 1420), (0, 230, 1390, H), (0, 45, 0, H)]
blot = np.zeros((H, W), bool)
for x0, x1, y0, y1 in BLOTS:
    blot[y0:y1, x0:x1] = True
tray = yy >= H - 45
clean = ~blot & ~tray
num = np.stack([ndi.gaussian_filter(a[..., k] * clean, 25) for k in range(3)], -1)
den = ndi.gaussian_filter(clean.astype(float), 25)[..., None]
board = num / np.maximum(den, 1e-6)
a[blot & ~tray] = board[blot & ~tray]
tray_row = np.median(a[H - 45:, 1100:1250], 1)          # the tray's profile next to the blots, row by row
fill_tray = tray & (xx < 1030)
a[fill_tray] = tray_row[(yy - (H - 45))[fill_tray]]
print('North end bottom: %d smeared pixels refilled' % (blot | fill_tray).sum())

im = Image.fromarray(np.clip(a, 0, 255).round().astype(np.uint8))
im.save(sys.argv[4], quality=93)
print('board image', im.size)
