# Compose the chair's seat and back textures from the layers chair.py bakes (CHAIR_1, its mirror, CHAIR_2, its mirror;
# already matched in exposure to CHAIR_1), and clean them in 3D, using where each texel sits on the chair
# (chair_texel_geometry.py).
# usage: python chair_composite.py <layers dir> <out dir>   -> <out>/chair_seat.jpg, <out>/chair_back.jpg
#
# - White plastic shell: one plain material, but the captures cover it in patches with slightly different light, and
#   CHAIR_1's own image has grey-brown spots and holes. So it is replaced by the smooth light of its white texels,
#   averaged over ~6 cm of the same face (a 12 mm grid, faces told apart by their normals). The underside, facing
#   down, keeps its shadowed light: averaged the same way, then again without texels clearly darker than that.
# - Green fabric (texels with green at least their red, on the seat's top and sides): keeps its sharp pattern from the
#   first capture that has it (CHAIR_1, then its mirror, then CHAIR_2, then its mirror); a brown texel there takes
#   another capture's green one, or else the clean fabric around it.
# - Then one color gain per channel matches the shell's median to the real chairs in SPLAT_ROOM_1.
import sys
import numpy as np
from scipy import ndimage as ndi
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
SPLAT_SHELL = np.array([188, 173, 161]) / 255
CELL = 0.012
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
lin2s = lambda x: np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.clip(x, 0, 1), 1 / 2.4) - 0.055)

def pushpull(col, valid):
    w = valid.astype(np.float32)
    levels = [(col * w[..., None], w)]
    while levels[-1][1].shape[0] > 1:
        c, k = levels[-1]
        levels.append((c.reshape(c.shape[0] // 2, 2, c.shape[1] // 2, 2, 3).sum((1, 3)), k.reshape(k.shape[0] // 2, 2, k.shape[1] // 2, 2).sum((1, 3))))
    c, k = levels[-1]
    fill = c / np.maximum(k, 1e-6)[..., None]
    for c, k in reversed(levels[:-1]):
        up = np.repeat(np.repeat(fill, 2, 0), 2, 1)
        fill = np.where((k > 0)[..., None], c / np.maximum(k, 1e-6)[..., None], up)
    return np.where(valid[..., None], col, fill)

class Grid:
    """per-face 3D grid (12 mm cells, 6 face buckets by dominant normal axis and sign) for smoothing texel values"""
    def __init__(self, P, N):
        self.lo = P.min(0) - 2 * CELL
        self.shape = tuple(((P.max(0) + 2 * CELL - self.lo) / CELL).astype(int) + 1)
        ax = np.abs(N).argmax(1)
        self.bucket = ax * 2 + (N[np.arange(len(N)), ax] > 0)
        self.coord = (P - self.lo) / CELL - 0.5
        self.cell = np.floor(self.coord + 0.5).astype(int)
    def smooth(self, values, use, size):
        """mean of `values` (n x c) over texels `use`, smoothed over size^3 cells, sampled back at every texel"""
        out = np.zeros_like(values); have = np.zeros(len(values), bool)
        for b in range(6):
            sel = self.bucket == b
            if not sel.any(): continue
            idx = np.ravel_multi_index(self.cell[sel].T, self.shape)
            u = use[sel]
            cnt = ndi.uniform_filter(np.bincount(idx[u], minlength=np.prod(self.shape)).reshape(self.shape).astype(np.float32), size)
            for c in range(values.shape[1]):
                s = ndi.uniform_filter(np.bincount(idx[u], weights=values[sel][u, c], minlength=np.prod(self.shape)).reshape(self.shape).astype(np.float32), size)
                field = s / np.maximum(cnt, 1e-9)
                out[sel, c] = ndi.map_coordinates(field, self.coord[sel].T, order=1, mode='nearest')
            have[sel] = ndi.map_coordinates(cnt, self.coord[sel].T, order=1, mode='nearest') > 1e-6
        return out, have

results = {}
for part in ('back', 'seat'):
    L = [lin2s(np.load(f'{src}/{part}_layer{k}.npy').astype(np.float32)) for k in range(4)]
    M = [np.load(f'{src}/{part}_mask{k}.npy') for k in range(4)]
    pos, nrm = np.load(f'{src}/{part}_pos.npy'), np.load(f'{src}/{part}_nrm.npy')
    covered = np.any(M, 0)
    inside = np.abs(pos - np.array([-1, -1, 1], np.float32)).sum(-1) > 1e-4   # on the surface (not atlas gutter)
    def first_of(order):
        out = np.zeros_like(L[0]); took = np.zeros(covered.shape, bool)
        for k in order:
            t = M[k] & ~took; out[t] = L[k][t]; took |= t
        return out, took
    col, _ = first_of((0, 1, 2, 3))
    # every texel on the surface is handled in 3D, including the few no capture reached (`seen` False): they take
    # their color from their neighbours on the chair, never from whatever lies next to them in the atlas
    P, N, C, seen = pos[inside], nrm[inside], col[inside], covered[inside]
    g = Grid(P, N)
    # fabric: a texel whose green is at least its red (the white shell is pinkish, red above green); a brown texel
    # (red above green, dark) counts as a fabric blotch when most texels around it are fabric
    lum = C @ LUM
    # the cushion is a region: where at least 45% of the texels within ~6 cm are clearly fabric (not dark, and green at
    # least red - 0.03: one capture sees one side of the cushion a little warmer; the white shell is red + 0.06)
    f_tex = seen & (C[:, 1] >= C[:, 0] - 0.03) & (lum > 0.25) & (P[:, 1] > 0.38) if part == 'seat' else np.zeros(len(C), bool)
    frac, _ = g.smooth(f_tex[:, None].astype(np.float32), seen, 5)
    fabric = (frac[:, 0] > 0.45) & (P[:, 1] > 0.38) if part == 'seat' else np.zeros(len(C), bool)
    plain = ~fabric
    newC = C.copy()
    # the shell's top and sides: white plastic everywhere on the real chair, so its light comes from the white texels
    # only (a crevice every capture got wrong cannot stay brown); the underside, facing down, keeps its shadowed
    # light from a robust average (a second pass without texels clearly darker than the first)
    white = plain & seen & (lum > 0.50) & (C[:, 0] >= C[:, 1] - 0.01)
    up = plain & (N[:, 1] > -0.3)
    sw, havew = g.smooth(C, white, 5)
    sw9, havew9 = g.smooth(C, white, 9)
    newC[up & havew] = sw[up & havew]
    newC[up & ~havew & havew9] = sw9[up & ~havew & havew9]
    down = plain & ~up
    shell_col = down & seen & (C[:, 0] >= C[:, 1] - 0.01) & (lum > 0.08)    # not fabric or the far side seen through holes
    s1, _ = g.smooth(C, shell_col, 5)
    keep = shell_col & (lum > 0.92 * (s1 @ LUM))
    s2, have = g.smooth(C, keep, 5)
    s9, have9 = g.smooth(C, keep, 9)
    newC[down & have] = s2[down & have]
    newC[down & ~have & have9] = s9[down & ~have & have9]
    # fabric: inside the cushion, a texel that is brown or much darker than the fabric's light over ~11 cm is a
    # blotch: it takes the first capture whose texel there is clean, else the fabric's smooth color
    ref, haveref = g.smooth(C, f_tex, 9)
    ref_l = ref @ LUM
    def clean(c, l):
        return (l >= 0.65 * ref_l) & ~((c[:, 0] > c[:, 1] + 0.01) & (l < 0.45))
    blot = fabric & (~seen | ~clean(C, lum))
    print(part, 'cushion texels', round(float(fabric.mean()), 3), 'blotches among them', round(float(blot.sum() / max(fabric.sum(), 1)), 3), flush=True)
    still = blot.copy()
    for c, m in zip(L, M):
        cc, mm = c[inside], m[inside]
        ok = still & mm & clean(cc, cc @ LUM)
        newC[ok] = cc[ok]; still &= ~ok
    newC[still & haveref] = ref[still & haveref]
    print(part, 'blotches refilled from another capture', round(float((blot & ~still).sum() / max(blot.sum(), 1)), 3), flush=True)
    col[inside] = newC
    results[part] = (col, inside)

gain = SPLAT_SHELL / np.median(results['back'][0][results['back'][1]], 0)
print('color gain (sRGB)', gain.round(3))
for part, (col, valid) in results.items():
    img = pushpull(np.clip(col * gain, 0, 1), valid)
    Image.fromarray((img[::-1] * 255).round().astype(np.uint8)).save(f'{out}/chair_{part}.jpg', quality=92)
    print(part, 'median sRGB', (np.median(img[valid], 0) * 255).round())
