"""The Empty Room's images (#77 part 2, spec §3): one per wall, the floor, and the ceiling, at 2.5 mm per texel.

Input: ortho.py's views of each source (scripts/.cache/lounge-v2/ortho/<source>/<view>.png). For each surface:
1. The base: the Main Capture (GLB_1) for the East and West walls and the ceiling, as lounge-v1 shows them;
   KIRI's scene for the North and South walls (sharpest there) and the floor, color-matched to the Main Capture.
   Its holes are filled from the other sources, color-matched to it.
2. Originals, clutter, and furniture shadows are masked out and filled by extending the pattern: fine detail
   (the image over its local mean) is copied along the row from clean pixels nearby, which carries horizontal
   bands like the baseboard; plain paint tiles one clean patch's detail. The light (the local mean) is a smooth
   fill from around the hole. The floor under the tables is the clean half mirrored about x = 0 (mirror_floor).
3. Behind the whiteboard, the East wall is the West wall at the same z (fill_east), and the South door's leaf is
   rebuilt smooth from its clean middle (clean_door).
4. Glass is painted as an opaque frosted pane with a black gasket around it (common.GLAZING; glb.py builds the
   frames).

Output: scripts/.cache/lounge-v2/tex/<view>.png, and debug masks.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

from common import CACHE, GLAZING, H, X0, X1, Z0, Z1

P = 0.0025  # m per texel
ORTHO = os.path.join(CACHE, 'ortho')
OUT = os.path.join(CACHE, 'tex')
SIZE = {'north': (X1 - X0, H), 'south': (X1 - X0, H), 'east': (Z1 - Z0, H), 'west': (Z1 - Z0, H),
        'floor': (X1 - X0, Z1 - Z0), 'ceiling': (X1 - X0, Z1 - Z0)}
# The East wall's base is the Main Capture: along it, the Captures drift up to 10-15 cm apart (its outlets), and
# Originals are fitted to the Main Capture.
BASE = {'north': 'KIRI', 'east': 'GLB_1', 'south': 'KIRI', 'west': 'GLB_1', 'floor': 'KIRI', 'ceiling': 'GLB_1'}
# The walls keep the Main Capture's look: its paint, and the cones of light each ceiling light throws down the wall.
# The North and South walls (from KIRI) are color-matched to it.
REF = 'GLB_1'
FILL = ['GLB_1', 'GLB_2', 'KIRI', 'GLB_3']

# Wall views: u runs along the wall from setup.json's wall start (so an Opening's offset is u), v down from the
# ceiling. Rectangles are (u0, u1, y0, y1) in meters, y up from the floor.
TABLE_Z = [(-2.0, -1.14), (-0.55, 0.26), (1.37, 2.35)]   # layout.json's tables along the West wall
MASKS = {
    # The whiteboard, its tray, and the tray's shadow (to 0.61 m, 0.53 m at the North end); the corner strip.
    # (to 6.24 m along: the board's edge left marks; the sign and sensor there are put back, FIXTURES)
    'east': [(0.0, 6.24, 0.59, 2.40), (0.0, 1.3, 0.53, 0.62), (0.0, 0.10, 0.072, 2.431), (6.15, 6.45, 0.70, 0.95)],
    # Table ends, chair backs, and their shadows (one band from the South table to past the North one's chair);
    # the main door frame's old edge and the wall above it; and the North end's last 27 cm, which the Main
    # Capture made a different surface.
    'west': [(Z1 - TABLE_Z[2][1] - 0.40, 6.27, 0.0, 1.0),
             (1.82, 1.97, 0.072, 2.431), (0.0, 1.97, 2.25, 2.431), (6.93, Z1 - Z0, 0.072, 2.431)],
    'north': [], 'south': [], 'ceiling': [],
}
# The floor under and around the tables and chairs, shadows included: (x0, x1, z0, z1).
FLOOR_MASK = [(X0, 0.32, -3.15, 2.85)]   # to -3.15: a dark stick lies in the North-West corner

BASEBOARD = 0.072  # m: the dark rubber base along the walls
# Plain paint with nothing on it, per wall: (u0, u1, y0, y1). A wall's fills above the baseboard tile its detail.
EXEMPLAR = {'east': (2.3, 5.5, 0.22, 0.52), 'west': (2.5, 5.5, 1.2, 2.0)}
CORNERS = ('north', 'east', 'west')
# Where a wall's bottom is an opening (doors and the glass wall), along u: no baseboard there.
NO_BASE = {'south': [(0, 3.118)], 'west': [(0, 1.82)]}
CLEAN_TO = {'north': 0.12, 'east': 0.20, 'west': 0.16, 'south': 0.12}   # m: how high the floor smears up
GLASS_COLOR = np.array([214, 217, 218], np.float32) / 255
# Opening glass and its frame bars, per wall: glass (u0, u1, y0, y1), then bars (u0, u1, y0, y1).
# Panes, and the frames around them (painted dark here; glb.py builds them as bronze boxes), from common.GLAZING.
GLASS = {k: {'glass': v['panes'], 'bars': [f[:4] for f in v['frames']]} for k, v in GLAZING.items()}
GASKET_W = 0.006   # m: the black rubber where each pane meets its frame


def load(src, view):
    path = os.path.join(ORTHO, src, f'{view}.png')
    if not os.path.exists(path):
        return None, None
    im = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32) / 255
    known = cv2.erode((im[..., 3] > 0.98).astype(np.uint8), np.ones((5, 5))) > 0
    return im[..., :3].copy(), known


def blur(img, sigma, axis=None):
    """Gaussian blur; big sigmas run on a smaller copy. axis='u' blurs along rows only."""
    if img.ndim == 3 and img.shape[2] == 1:  # cv2 drops a single channel
        return _blur(img[..., 0], sigma, axis)[..., None]
    return _blur(img, sigma, axis)


def _blur(img, sigma, axis):
    if axis == 'u':
        if sigma <= 16:
            return cv2.GaussianBlur(img, (0, 0), sigmaX=sigma, sigmaY=1e-3)
        f = sigma / 8
        small = cv2.resize(img, (max(1, int(img.shape[1] / f)), img.shape[0]), interpolation=cv2.INTER_AREA)
        return cv2.resize(cv2.GaussianBlur(small, (0, 0), sigmaX=8, sigmaY=1e-3), (img.shape[1], img.shape[0]))
    if sigma <= 16:
        return cv2.GaussianBlur(img, (0, 0), sigma)
    f = sigma / 8
    small = cv2.resize(img, (max(1, int(img.shape[1] / f)), max(1, int(img.shape[0] / f))), interpolation=cv2.INTER_AREA)
    return cv2.resize(cv2.GaussianBlur(small, (0, 0), 8), (img.shape[1], img.shape[0]))


def nc(img, known, sigma, axis=None):
    """Normalized convolution: the blur of img over the known pixels only."""
    k = known.astype(np.float32)
    num = blur(img * k[..., None], sigma, axis)
    den = blur(k, sigma, axis)[..., None]
    return num / np.maximum(den, 1e-6), den[..., 0]


def extrapolate(img, known, axis=None, sigmas=(4, 8, 16, 32, 64, 128, 256, 512, 1024)):
    """Fills the unknown pixels of a smooth image from the nearest known ones, coarser and coarser."""
    out, have = img.copy(), known.copy()
    for s in sigmas:
        m, den = nc(out, have, s, axis)
        new = ~have & (den > 0.05)
        out[new] = m[new]
        have |= new
    if not have.all() and axis:
        rest, _ = extrapolate(out, have)[0], None
        out[~have] = rest[~have]
        have[:] = True
    return out, have


def membrane(img, known, domain=None):
    """A smooth (Laplace) fill of the unknown pixels from the known ones around them, on an image pyramid.
    Outside the domain doesn't count, so a band can be filled on its own."""
    if domain is None:
        domain = np.ones(known.shape, bool)
    levels = [(img * known[..., None], known & domain, domain)]
    while min(levels[-1][0].shape[:2]) > 48:
        a, k, d = levels[-1]
        kf = cv2.resize(k.astype(np.float32), (a.shape[1] // 2, a.shape[0] // 2), interpolation=cv2.INTER_AREA)
        df = cv2.resize(d.astype(np.float32), (a.shape[1] // 2, a.shape[0] // 2), interpolation=cv2.INTER_AREA)
        av = cv2.resize(a, (a.shape[1] // 2, a.shape[0] // 2), interpolation=cv2.INTER_AREA)
        av = av / np.maximum(kf, 1e-6)[..., None]
        levels.append((av * (kf > 0.5)[..., None], kf > 0.5, df > 0.5))
    x = None
    for a, k, d in reversed(levels):
        if x is None:
            x = np.where(k[..., None], a, a[k].mean(axis=0) if k.any() else 0.5)
        else:
            x = cv2.resize(x, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_LINEAR)
            x = np.where(k[..., None], a, x)
        dm = d.astype(np.float32)
        free = d & ~k
        for _ in range(60 if a.shape[0] > 200 else 300):
            xs = x * dm[..., None]
            num = (np.roll(xs, 1, 0) + np.roll(xs, -1, 0) + np.roll(xs, 1, 1) + np.roll(xs, -1, 1))
            den = (np.roll(dm, 1, 0) + np.roll(dm, -1, 0) + np.roll(dm, 1, 1) + np.roll(dm, -1, 1))[..., None]
            x = np.where(free[..., None], num / np.maximum(den, 1e-6), x)
    return x


def match_color(src, src_known, ref, ref_known):
    """Per-channel gain that matches src to ref where both are known."""
    both = src_known & ref_known
    if both.sum() < 1000:
        return src
    a, b = blur(src, 8), blur(ref, 8)
    gain = np.median(b[both] / np.maximum(a[both], 1e-3), axis=0)
    return np.clip(src * gain, 0, 1)


def rect_mask(shape, rects, view):
    m = np.zeros(shape[:2], bool)
    for u0, u1, y0, y1 in rects:
        if view in ('floor', 'ceiling'):
            x0, x1, z0, z1 = u0, u1, y0, y1
            c0, c1 = (x0 - X0) / P, (x1 - X0) / P
            r0, r1 = ((z0 - Z0) / P, (z1 - Z0) / P) if view == 'floor' else ((Z1 - z1) / P, (Z1 - z0) / P)
        else:
            c0, c1, r0, r1 = u0 / P, u1 / P, (H - y1) / P, (H - y0) / P
        m[max(0, int(r0)):int(np.ceil(r1)), max(0, int(c0)):int(np.ceil(c1))] = True
    return m


def outliers(img, known):
    """Fixtures and blemishes (outlets, signs, scuffs): far from the row's local color. They stay where they are,
    but aren't copied into a fill."""
    lum = img.mean(axis=2, keepdims=True)
    m, _ = nc(lum, known, 60, axis='u')
    off = np.abs(lum[..., 0] - m[..., 0]) > 0.12 * np.maximum(m[..., 0], 0.05)
    return cv2.dilate(off.astype(np.uint8), np.ones((9, 9))) > 0


def pingpong(i, n):
    i = np.mod(i, 2 * n)
    return np.where(i < n, i, 2 * n - 1 - i)


def row_fill(D, hole, source):
    """Fills D in the hole, row by row, by mirroring the source pixels on each side of each gap in the row
    back and forth; the two sides meet halfway with a short crossfade."""
    out = D.copy()
    W = D.shape[1]
    cols = np.arange(W)
    for r in np.nonzero(hole.any(axis=1))[0]:
        h, s = hole[r], source[r]
        E = cols[s]
        if len(E) < 8:
            continue
        edges = np.diff(np.concatenate([[0], h.astype(np.int8), [0]]))
        for a, b in zip(np.nonzero(edges == 1)[0], np.nonzero(edges == -1)[0]):
            i = np.arange(a, b)
            left, right = E[E < a][::-1], E[E >= b]
            fills, weights = [], []
            if len(left) >= 8:
                fills.append(D[r, left[pingpong(i - a, len(left))]])
                weights.append(np.clip((b - i) / max(b - a, 1), 0, 1) if len(right) >= 8 else np.ones(len(i)))
            if len(right) >= 8:
                fills.append(D[r, right[pingpong(b - 1 - i, len(right))]])
                weights.append(np.clip((i - a) / max(b - a, 1), 0, 1) if len(left) >= 8 else np.ones(len(i)))
            if not fills:
                continue
            if len(fills) == 1:
                out[r, i] = fills[0]
            else:
                # Mostly one side or the other: a 24-texel crossfade at the middle keeps the grain sharp.
                w = np.clip((weights[0] - 0.5) * (b - a) / 24 + 0.5, 0, 1)[:, None]
                out[r, i] = w * fills[0] + (1 - w) * fills[1]
    return out


def build(view, guide_fn=None):
    img, known = load(BASE[view], view)
    if BASE[view] != REF and view != 'floor':
        r, rk = load(REF, view)
        img = match_color(img, known, r, rk)
    if view in ('east', 'west'):
        # The Main Capture's walls have black drips near the ceiling (bad geometry): holes, filled from the others.
        lum = img.mean(axis=2, keepdims=True)
        loc, _ = nc(lum, known, 40)
        rows = H - (np.arange(img.shape[0]) + 0.5) * P
        drip = known & (lum[..., 0] < 0.62 * loc[..., 0]) & (rows > BASEBOARD + 0.15)[:, None]
        drip &= ~rect_mask(img.shape, FIXTURES.get(view, []), view)
        known &= ~(cv2.dilate(drip.astype(np.uint8), np.ones((15, 15))) > 0)
    hole0 = ~known
    # 1. Holes from the other sources, color-matched to the base.
    for src in FILL:
        if src == BASE[view]:
            continue
        s, sk = load(src, view)
        if s is None:
            continue
        s = match_color(s, sk, img, known)
        # And locally: a smooth gain field from where both saw the surface.
        both = known & sk
        if both.sum() > 1000:
            ms, _ = nc(s, both, 16)
            mb, _ = nc(img, both, 16)
            small = lambda a: cv2.resize(a, (a.shape[1] // 8, a.shape[0] // 8), interpolation=cv2.INTER_AREA)
            g = membrane(small(mb / np.maximum(ms, 1e-3)), small(both.astype(np.float32)) > 0.5)
            s = np.clip(s * cv2.resize(g, (s.shape[1], s.shape[0])), 0, 1)
        take = ~known & sk
        img[take] = s[take]
        known |= take
    if view == 'floor':
        # Edges cleaned before the mirror too: the East wall's base shadow would land 5-10 cm off the West wall.
        out = fine_floor(clean_floor_edges(mirror_floor(clean_floor_edges(img, 0.10))))
        return save(view, out, np.zeros(out.shape[:2], bool), np.zeros(out.shape[:2], bool))
    # 2. Masked Originals, clutter, and shadows, plus holes no source saw; and each corner's 6 cm strip, where a
    # Capture smears the next wall in.
    mask = rect_mask(img.shape, MASKS.get(view, []), view)
    if view in CORNERS:
        L = SIZE[view][0]
        mask |= rect_mask(img.shape, [(0, 0.06, BASEBOARD, H), (L - 0.06, L, BASEBOARD, H)], view)
    glass = rect_mask(img.shape, GLASS.get(view, {}).get('glass', []), view)
    hole = (~known | mask) & ~glass
    # Frames are painted over later; what the Captures show there (bright edges, the hallway) mustn't steer fills.
    frames = cv2.dilate(rect_mask(img.shape, GLASS.get(view, {}).get('bars', []), view).astype(np.uint8), np.ones((9, 9))) > 0
    good = known & ~mask & ~glass & ~frames
    # The local mean, as light and shading: 4 cm on walls; 10 cm on the floor, so its planks' tone is detail.
    M, _ = nc(img, good, 40 if view == 'floor' else 16)
    D = img / np.maximum(M, 1e-3)                 # fine detail
    # Copy from clean pixels at least 3 cm from any hole, so edges of what was masked don't spread.
    near = cv2.distanceTransform((~hole).astype(np.uint8), cv2.DIST_L2, 5) < 12
    source = good & ~outliers(img, good) & ~near
    Dfill = row_fill(np.where(hole[..., None], 1.0, D), hole, source)   # rows with no clean pixel stay plain
    tiled = None
    if view in EXEMPLAR:
        rows = H - (np.arange(img.shape[0]) + 0.5) * P
        paint = (rows > BASEBOARD + 0.01)[:, None] & np.ones(hole.shape, bool)
        # Only the paint's fine texture (1.5 cm): coarser detail repeats visibly as mirrored chevrons.
        Mfine, _ = nc(img, good, 6)
        tiled = tile(img / np.maximum(Mfine, 1e-3), EXEMPLAR[view], img.shape)
        Dfill[hole & paint] = tiled[hole & paint]
    # Light in the hole: a smooth fill from around it, times the guide where there is one. On walls the
    # baseboard band is filled on its own, so it stays dark.
    if guide_fn is not None:
        G = guide_fn(M, good)
        Mfill = G * membrane(M / np.maximum(G, 1e-3), good)
    elif view in ('floor', 'ceiling'):
        Mfill = membrane(M, good)
    else:
        rows = H - (np.arange(img.shape[0]) + 0.5) * P
        band = np.broadcast_to((rows < BASEBOARD)[:, None], hole.shape)
        Mfill = np.where(band[..., None], membrane(M, good, band), membrane(M, good, ~band))
    out = img.copy()
    fill = np.clip(Dfill * Mfill, 0, 1)
    # Feather the fill into the known image over ~1.5 cm.
    dist = cv2.distanceTransform((~hole).astype(np.uint8), cv2.DIST_L2, 5)
    w = np.clip(dist / 6, 0, 1)[..., None]
    out = np.where(hole[..., None], fill, w * img + (1 - w) * fill)
    if tiled is not None:  # feather tiled paint into the known wall over 2 cm
        near = paint & ~hole & (dist < 8)
        wk = np.clip(dist / 8, 0, 1)[..., None]
        out = np.where(near[..., None], wk * img + (1 - wk) * np.clip(tiled * Mfill, 0, 1), out)
    if view != 'ceiling':
        out = clean_bottom(out, view)
    if view == 'south':
        out = clean_door(out)
    if view == 'east':
        out = fill_east(out, mask & (H - (np.arange(out.shape[0]) + 0.5) * P > BASEBOARD)[:, None])
    if view == 'west':
        out = restore_fixtures(out, img, 'west')
    # 3. Glass and frame bars.
    g = GLASS.get(view, {})
    if g.get('glass'):
        out = paint_glass(out, glass, view)
        bars = rect_mask(out.shape, g['bars'], view)
        out[bars] = 0.11   # behind glb.py's frame boxes
    return save(view, out, glass, hole)


# Dark fixtures that aren't blemishes: the East wall's sign and sensor.
FIXTURES = {'east': [(6.215, 6.325, 1.44, 1.57), (6.265, 6.35, 2.04, 2.18)],
            # The West wall's two outlets behind the tables: put back after the fill (restore_fixtures).
            'west': [(2.655, 2.745, 0.375, 0.51), (5.995, 6.085, 0.375, 0.51)]}
# The whiteboard tray's end cap, past the board: removed, and kept out of the copy of the wall beside it.
TRAY_END = (6.15, 6.45, 0.70, 0.95)


def restore_fixtures(out, img, view):
    """A wall's fixtures (FIXTURES) back from the base image, only where they differ from the filled wall."""
    box = rect_mask(out.shape, FIXTURES[view], view)
    differs = np.abs(img.mean(axis=2) - out.mean(axis=2)) > 0.12 * out.mean(axis=2)
    own = cv2.dilate((box & differs).astype(np.uint8), np.ones((5, 5))).astype(bool) & box
    keep = cv2.GaussianBlur(own.astype(np.float32), (0, 0), 1.2)[..., None]
    return keep * img + (1 - keep) * out


def fill_east(out, hole):
    """Behind the whiteboard, the East wall as the West wall shows it at the same z: the ceiling lights are in two
    rows at the same z, so the cones of light fall in the same places on both walls. The West wall's main door is
    across from the East wall's last metre, so there it is the East wall's own cone of light by the South end
    (its sign and sensor smoothed away), mirrored about the cone's middle and stretched to meet the West copy; the
    two blend in the dim gap between cones. The West copy is matched to the East wall around the whiteboard by a
    smooth gain, and the sign and sensor are put back."""
    west = np.asarray(Image.open(os.path.join(OUT, 'west.png')).convert('RGB')).astype(np.float32) / 255
    n_rows, n_cols = out.shape[:2]
    u = (np.arange(n_cols) + 0.5) * P
    col = lambda v: np.clip(np.round(v / P - 0.5).astype(int), 0, n_cols - 1)
    src_west = west[:, np.clip(np.round((Z1 - Z0 - u) / P - 0.5).astype(int), 0, west.shape[1] - 1)]
    # The paint's fine texture, tiled, for anything smoothed.
    e0, e1, f0, f1 = EXEMPLAR['east']
    ex = out[int((H - f1) / P):int((H - f0) / P), int(e0 / P):int(e1 / P)]
    detail = ex / np.maximum(cv2.GaussianBlur(ex, (0, 0), 6), 1e-3)
    tiled = detail[pingpong(np.arange(n_rows), len(detail))][:, pingpong(np.arange(n_cols), detail.shape[1])]
    # The East wall itself past the whiteboard, with its sign, sensor, and the tray's end cap smoothed away.
    original = out.copy()
    own = out.copy()
    smoothed = cv2.dilate(rect_mask(out.shape, FIXTURES['east'] + [TRAY_END], 'east').astype(np.uint8), np.ones((9, 9))) > 0
    mean, _ = nc(own, ~smoothed & ~hole, 16)
    own[smoothed] = (mean * tiled)[smoothed]
    # Mirrored about the cone's middle (6.25 m) and stretched, so its clean part (6.26-7.03 m) reaches back to
    # where the West copy ends; right of the board (the tray's end cap), the wall itself.
    edge = 6.24
    src_own = own[:, col(np.where(u <= edge, 6.26 + (edge - u) * (0.77 / 1.19), u))]
    # The West copy's gain, from the East wall where the copy is the real West wall: up to 5 m along (before the
    # West door), outside the West wall's own fills.
    west_fill = cv2.dilate(rect_mask(out.shape, MASKS['west'], 'west')[:, ::-1].astype(np.uint8), np.ones((49, 49))) > 0
    good = ~hole & ~west_fill & (u < 5.0)[None, :]
    a, _ = nc(out, good, 32)
    b, _ = nc(src_west, good, 32)
    small = lambda x: cv2.resize(x, (n_cols // 8, n_rows // 8), interpolation=cv2.INTER_AREA)
    g = membrane(small(a / np.maximum(b, 1e-3)), small(good.astype(np.float32)) > 0.5)
    west_copy = src_west * cv2.GaussianBlur(cv2.resize(g, (n_cols, n_rows)), (0, 0), 8)
    w = np.clip((u - 4.85) / 0.40, 0, 1)
    w = (w * w * (3 - 2 * w))[None, :, None]
    fill = np.clip((1 - w) * west_copy + w * src_own, 0, 1)
    # Where the West wall was itself a fill (behind the tables, below 0.97 m), its copy isn't the wall: there,
    # a smooth light from the copy above and the East wall's own band below, times the paint's fine texture.
    bad = hole & west_fill & (w[0, :, 0] < 0.99)[None, :]
    values = np.where(hole[..., None], fill, out)
    mean, _ = nc(values, ~bad, 16)
    light = membrane(mean, ~bad)
    soft_bad = cv2.GaussianBlur(bad.astype(np.float32), (0, 0), 24)[..., None]
    fill = np.clip(soft_bad * light * tiled + (1 - soft_bad) * fill, 0, 1)
    # Into the wall below over 4 cm: the fill's light matched to it at the edge first (a smooth gain along the row).
    r_edge = int((H - 0.59) / P)
    ratio = out[r_edge + 2:r_edge + 10].mean(axis=0) / np.maximum(fill[r_edge - 10:r_edge - 2].mean(axis=0), 1e-3)
    ratio = cv2.GaussianBlur(ratio[None], (0, 0), sigmaX=40, sigmaY=1e-3)[0]
    rows = H - (np.arange(n_rows) + 0.5) * P
    fade = np.clip((0.75 - rows) / 0.16, 0, 1)[:, None, None]    # 1 at 0.59 m, 0 at 0.75 m
    fill = np.clip(fill * (1 + fade * (ratio[None] - 1)), 0, 1)
    soft = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 6)[..., None]
    result = soft * fill + (1 - soft) * out
    # The sign and sensor: only what differs from the wall, so none of the old wall around them comes back.
    box = rect_mask(out.shape, FIXTURES['east'], 'east')
    differs = np.abs(original.mean(axis=2) - result.mean(axis=2)) > 0.12 * result.mean(axis=2)
    own_px = cv2.dilate((box & differs).astype(np.uint8), np.ones((5, 5))).astype(bool) & box
    keep = cv2.GaussianBlur(own_px.astype(np.float32), (0, 0), 1.2)[..., None]
    return keep * original + (1 - keep) * result


# The South door's leaf (u0, u1, y0, y1); its clean, sharp middle (no door closer, hinge-side smear, glare, or
# kick marks); and what stays as the Captures saw it (the handle).
DOOR = (0.03, 0.95, 0.0, 2.28)
DOOR_CLEAN = (0.15, 0.89, 0.32, 1.90)
DOOR_KEEP = [(0.77, 0.94, 0.85, 1.06)]


def clean_door(out):
    """The door leaf, smooth: the light is a smooth fit over the leaf's clean middle, and the wood's grain
    (finer than 3 cm) is mirrored out from there to the leaf's edges. The handle is kept."""
    rc = lambda u0, u1, y0, y1: (int((H - y1) / P), min(int(np.ceil((H - y0) / P)), out.shape[0]), int(u0 / P), int(np.ceil(u1 / P)))
    r0, r1, c0, c1 = rc(*DOOR)
    q0, q1, d0, d1 = rc(*DOOR_CLEAN)
    I = out.copy()
    C = I[q0:q1, d0:d1]
    detail = C / np.maximum(cv2.GaussianBlur(C, (0, 0), 12), 1e-3)
    # The light: a quadratic in (u, v) fitted to the clean part's log color, held constant past its edges.
    vv, uu = np.mgrid[q0:q1, d0:d1]
    feats = lambda u, v: np.stack([np.ones_like(u), u, v, u * u, u * v, v * v], -1).reshape(-1, 6)
    norm = lambda u, v: ((u - d0) / (d1 - d0), (v - q0) / (q1 - q0))
    A = feats(*norm(uu, vv))[::7]
    coef = np.linalg.lstsq(A, np.log(np.maximum(C.reshape(-1, 3), 1e-3))[::7], rcond=None)[0]
    lv, lu = np.mgrid[r0:r1, c0:c1]
    nu, nv = norm(np.clip(lu, d0, d1 - 1), np.clip(lv, q0, q1 - 1))
    light = np.exp(feats(nu, nv) @ coef).reshape(r1 - r0, c1 - c0, 3)
    # Past the clean part's edges, the grain is a copy from further in (a mirror would make symmetric figures),
    # shifted so it skips the handle: 0.6 m down at the top, 0.5 m up at the bottom, 0.3 m in on the hinge side.
    # Right at the edge it blends in from a mirror over 2.5 cm, so there's no seam.
    def index(lo, hi, a, b, before, after):
        i = np.arange(a, b) - lo
        n = hi - lo
        mirror = pingpong(i, n)
        shift = np.where(i < 0, i + before, np.where(i >= n, i - after, i))
        dist = np.maximum(-i, i - (n - 1)).clip(0)
        return mirror, np.clip(shift, 0, n - 1), np.clip(dist / 10, 0, 1)
    rm, rs, rw = index(q0, q1, r0, r1, int(0.6 / P), int(0.5 / P))
    cm, cs, cw = index(d0, d1, c0, c1, int(0.3 / P), int(0.3 / P))
    w = np.maximum(rw[:, None], cw[None, :])[..., None]
    grain = (1 - w) * detail[rm][:, cm] + w * detail[rs][:, cs]
    leaf = np.clip(light * grain, 0, 1)
    # The handle, feathered in over 1 cm.
    keep = np.zeros(leaf.shape[:2], np.float32)
    for u0, u1, y0, y1 in DOOR_KEEP:
        k0, k1, e0, e1 = rc(u0, u1, y0, y1)
        keep[k0 - r0:k1 - r0, e0 - c0:e1 - c0] = 1
    keep = cv2.GaussianBlur(keep, (0, 0), 2)[..., None]
    leaf = keep * I[r0:r1, c0:c1] + (1 - keep) * leaf
    # The gap around the leaf reads as a thin dark line.
    leaf[:, :2] *= 0.55
    leaf[:, -2:] *= 0.55
    leaf[:2] *= 0.55
    out = out.copy()
    out[r0:r1, c0:c1] = leaf
    return out


def save(view, out, glass, hole):
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'{view}.png'))
    dbg = (np.stack([hole, ~hole & ~glass, glass], -1) * 255).astype(np.uint8)
    Image.fromarray(dbg).save(os.path.join(OUT, f'{view}.mask.png'))
    print(view, out.shape, f'filled {hole.mean():.1%}', f'glass {glass.mean():.1%}', flush=True)
    return out


def clean_bottom(out, view):
    """The Captures smear the floor into the wall's bottom: a clean baseboard band (its median color, with the
    wall's light along it), and above it to 0.20 m, the wall from just higher up, mirrored down."""
    rows = H - (np.arange(out.shape[0]) + 0.5) * P
    cols = np.ones(out.shape[1], bool)
    for u0, u1 in NO_BASE.get(view, []):
        cols[int(u0 / P):int(np.ceil(u1 / P))] = False
    if not cols.any():
        return out
    out = out.copy()
    r_top = int((H - CLEAN_TO[view]) / P)                        # first row above the smeared bottom
    r_base = int(np.ceil((H - BASEBOARD) / P))                   # first row of the baseboard
    rr = np.arange(r_top, r_base)
    src = 2 * r_top - 1 - rr                                     # the rows just above 0.12 m, mirrored down
    out[np.ix_(rr, np.nonzero(cols)[0])] = out[np.ix_(src, np.nonzero(cols)[0])]
    band = out[r_base:]
    dark = band[:, cols].mean(axis=2) < 0.3
    color = np.median(band[:, cols][dark], axis=0) if dark.sum() > 100 else np.array([0.12, 0.12, 0.12])
    light = cv2.GaussianBlur(out[int((H - 0.3) / P):int((H - 0.15) / P)].mean(axis=(0, 2))[None, :], (0, 0), sigmaX=120, sigmaY=1e-3)[0]
    light = light / np.median(light[cols])
    noise = 1 + 0.03 * cv2.GaussianBlur(np.random.default_rng(3).standard_normal(band.shape[:2]).astype(np.float32), (0, 0), 1.5)
    band[:, cols] = np.clip(color[None, None, :] * light[None, cols, None] * noise[:, cols, None], 0, 1)
    return out


# The floor's fine grain comes from a chair Detail Capture (spec §3: "the closest, sharpest sample"): ortho.py's
# floor view of POLYCAM_CHAIR_1 at 1 mm per pixel (scripts/.cache/lounge-v2/ortho1mm/CHAIR_1), at true scale
# (align.py SCALE), in this clean, sharp patch away from the chair and its shadow: x0, x1, z0, z1.
FINE_SRC = os.path.join(CACHE, 'ortho1mm', 'CHAIR_1', 'floor.png')
FINE_RECT = (-1.10, 1.30, -3.45, -3.06)   # no holes in the capture here
FINE_P = 0.0015   # the floor image's m per texel


def fine_floor(base):
    """The room's floor (light, plank tones, and coarse grain, from the room Captures) times the Detail
    Capture's fine grain (finer than 1 cm), tiled with a random offset per 19 cm band of planks."""
    ex = np.asarray(Image.open(FINE_SRC).convert('RGB')).astype(np.float32) / 255
    x0, x1, z0, z1 = FINE_RECT
    ex = ex[int((z0 - Z0) / 0.001):int((z1 - Z0) / 0.001), int((x0 - X0) / 0.001):int((x1 - X0) / 0.001)]
    D = ex / np.maximum(cv2.GaussianBlur(ex, (0, 0), 10), 1e-3)
    D = cv2.resize(D, (int(D.shape[1] * 0.001 / FINE_P), int(D.shape[0] * 0.001 / FINE_P)), interpolation=cv2.INTER_AREA)
    D = D / D.reshape(-1, 3).mean(axis=0)
    # Make it wrap along the grain (x): its last 10 cm crossfade into its first, so repeats show no mirrored chevrons.
    n = int(0.10 / FINE_P)
    t = np.linspace(0, 1, n)[None, :, None]
    D = np.concatenate([(1 - t) * D[:, -n:] + t * D[:, :n], D[:, n:-n]], axis=1)
    W, Hh = round((X1 - X0) / FINE_P), round((Z1 - Z0) / FINE_P)
    up = cv2.GaussianBlur(cv2.resize(base, (W, Hh), interpolation=cv2.INTER_CUBIC), (0, 0), 4)
    # KIRI's photos differ in tint from chart to chart: keep the floor's brightness, but its color from 30 cm away.
    lum = up.mean(axis=2, keepdims=True)
    tint = blur(up / np.maximum(lum, 1e-3), 200)
    up = tint * lum
    zs = (np.arange(Hh) + 0.5) * FINE_P
    band = (zs // 0.19).astype(int)
    rng = np.random.default_rng(9)
    offx = rng.integers(0, 10000, band.max() + 1)[band]
    offz = rng.integers(0, 10000, band.max() + 1)[band]
    rr = pingpong(np.arange(Hh) + offz, D.shape[0])
    cc = np.mod(np.arange(W)[None, :] + offx[:, None], D.shape[1])
    return np.clip(up * D[rr[:, None], cc], 0, 1)


def clean_floor_edges(img, width=0.05):
    """The floor's outer 5 cm, where the Captures smear the baseboard in: the 5 cm inside it, mirrored out."""
    n = int(width / P)
    out = img.copy()
    out[:n] = img[n:2 * n][::-1]
    out[-n:] = img[-2 * n:-n][::-1]
    out[:, :n] = out[:, n:2 * n][:, ::-1]
    out[:, -n:] = out[:, -2 * n:-n][:, ::-1]
    return out


def mirror_floor(img):
    """The floor under and around the tables, from the clean East half mirrored about x = 0 (the planks run along
    x). The strip near x = 0 mirrors about an axis just past the mask instead. Both the joint between the two and
    that axis move per 19 cm band of planks, so they read as staggered plank ends rather than lines down the room.
    The light across x is the North and South ends' (clean on both halves), so the copies are evened to it."""
    (x0, x1, z0, z1), = FLOOR_MASK
    nz, nx = img.shape[:2]
    xs = X0 + (np.arange(nx) + 0.5) * P
    zs = Z0 + (np.arange(nz) + 0.5) * P
    rng = np.random.default_rng(5)
    band = ((zs - z0) // 0.19).astype(int)
    nb = band.max() - band.min() + 1
    xb = rng.uniform(-0.62, -x1, nb)[band - band.min()]          # mirror about 0 below this
    xc = rng.uniform(x1, 0.47, nb)[band - band.min()]            # else mirror about this
    # Mirror about 0 below xb, else about xc; crossfaded over 15 cm along the grain, so the joint doesn't cut.
    srcA, srcB = -xs[None, :] + 0 * xb[:, None], 2 * xc[:, None] - xs[None, :]
    wA = np.clip((xb[:, None] - xs[None, :]) / 0.15 + 0.5, 0, 1)[..., None]
    wA = wA * wA * (3 - 2 * wA)
    col = lambda src: np.clip(np.round((src - X0) / P - 0.5).astype(int), 0, nx - 1)
    rows = np.arange(nz)[:, None]
    cols = col(np.where(wA[..., 0] > 0.5, srcA, srcB))
    ends = (zs < z0 - 0.1) | (zs > z1 + 0.1)
    S = cv2.GaussianBlur(img[ends].mean(axis=0, keepdims=True), (0, 0), sigmaX=60, sigmaY=1e-3)[0]
    # Clamped: right at the walls the ends are darker than the room's middle, and the gain would overshoot.
    m = ((zs > z0) & (zs < z1))[:, None] & (xs[None, :] < xc[:, None])
    out = img.copy()
    S_ = lambda src: S[col(src)]
    copy = wA * img[rows, col(srcA)] * (S[None] / np.maximum(S_(srcA), 1e-3)).clip(0.85, 1.2) \
        + (1 - wA) * img[rows, col(srcB)] * (S[None] / np.maximum(S_(srcB), 1e-3)).clip(0.85, 1.2)
    out[m] = np.clip(copy, 0, 1)[m]
    # The mirrored pieces differ in tone, which shows the joints from above: even out the 15-40 cm tone (70%) in
    # the filled part, feathered over 10 cm.
    lum = out.mean(axis=2, keepdims=True)
    g = np.clip((blur(lum, 160) / np.maximum(blur(lum, 60), 1e-3)) ** 0.7, 0.8, 1.25)
    w = blur(m.astype(np.float32)[..., None], 40)
    return np.clip(out * (1 + w * (g - 1)), 0, 1)


def paint_glass(out, glass, view):
    """An opaque frosted pane: neutral light grey, a little brighter at the top, with a faint grain."""
    hgt = out.shape[0]
    y = H - (np.arange(hgt) + 0.5) * P
    shade = (0.88 + 0.11 * np.clip(y / 2.3, 0, 1) ** 0.7)[:, None, None]
    rng = np.random.default_rng(2)
    grain = cv2.GaussianBlur(rng.standard_normal(out.shape[:2]).astype(np.float32), (0, 0), 1.2)[..., None] * 0.012
    pane = np.clip(GLASS_COLOR * shade * (1 + grain), 0, 1)
    out = np.where(glass[..., None], pane, out)
    g = int(round(GASKET_W / P))
    for u0, u1, y0, y1 in GLASS[view]['glass']:
        c0, c1, r0, r1 = int(u0 / P), int(np.ceil(u1 / P)), int((H - y1) / P), int(np.ceil((H - y0) / P))
        for sl in [(slice(r0, r0 + g), slice(c0, c1)), (slice(r1 - g, r1), slice(c0, c1)),
                   (slice(r0, r1), slice(c0, c0 + g)), (slice(r0, r1), slice(c1 - g, c1))]:
            out[sl] = 0.11
    return out


def tile(D, rect, shape):
    """The detail of one clean patch, tiled over the whole image, mirrored at each repeat so it has no seams."""
    u0, u1, y0, y1 = rect
    c0, c1, r0, r1 = int(u0 / P), int(u1 / P), int((H - y1) / P), int((H - y0) / P)
    E = D[r0:r1, c0:c1]
    rr = pingpong(np.arange(shape[0]), r1 - r0)
    cc = pingpong(np.arange(shape[1]), c1 - c0)
    return E[rr][:, cc]


def wall_light(view):
    """A wall's light (local mean) with its holes filled smoothly, the baseboard band on its own."""
    img, known = load(BASE[view], view)
    opening = rect_mask(img.shape, GLASS[view]['glass'] + GLASS[view]['bars'], view)
    opening = cv2.dilate(opening.astype(np.uint8), np.ones((25, 25))) > 0   # and the frame's edge
    if view == 'west':
        opening[:, :int(1.95 / P)] = True   # and the header above the door
    good = known & ~rect_mask(img.shape, MASKS[view], view) & ~opening
    M, _ = nc(img, good, 16)
    rows = H - (np.arange(img.shape[0]) + 0.5) * P
    band = np.broadcast_to((rows < BASEBOARD)[:, None], good.shape)
    return np.where(band[..., None], membrane(M, good, band), membrane(M, good, ~band))


def main():
    views = sys.argv[1:] or ['north', 'south', 'west', 'east', 'floor', 'ceiling']
    for view in views:
        build(view)


if __name__ == '__main__':
    main()
