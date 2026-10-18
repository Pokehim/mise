# Compose the chair's seat and back textures from the layers chair.py bakes (CHAIR_1, its mirror, CHAIR_2, its mirror;
# already matched in exposure to CHAIR_1), and clean them in 3D, using where each texel sits on the chair
# (chair_texel_geometry.py).
# usage: python chair_composite.py <layers dir> <out dir>   -> <out>/chair_seat.jpg, <out>/chair_back.jpg
#
# - White plastic shell and its underside: CHAIR_1's own texture (its sharpest, most head-on capture) wherever it is
#   clean. Its holes and grey spots take the mirror, then CHAIR_2, then CHAIR_2's mirror, each matched to CHAIR_1's
#   light there by the ratio of the two captures' smooth light over ~6 cm, so no patch shows; else CHAIR_1's smooth
#   light. "Smooth light" is a robust average over a 12 mm grid on each face (faces told apart by their normals).
#   The seat pan (all of the seat's shell) is the exception: CHAIR_1's texture is patchy there, so its color is a
#   lighting model fitted to the brighter part of CHAIR_1's own shell texels (by facing and height; spots only
#   darken), with a gentle correction that follows CHAIR_1's light across the pan where it faces up or sideways.
# - Green fabric (the cushion: where most texels within ~6 cm are clearly fabric, its edge cleaned by majority over
#   ~4 cm): keeps its sharp printed grid from the first capture that has it (CHAIR_1, then its mirror, then CHAIR_2,
#   then its mirror); a brown or dark blotch there takes the first capture that is clean there, or else the fabric's
#   smooth color.
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
    fabric &= ~((N[:, 2] < -0.2) & (N[:, 1] < 0.6) & (P[:, 2] < -0.12))   # behind the cushion, the pan's rear rim is shell
    # and at the cushion's edge (not deep inside it), a reddish texel is the shell's rim, lit or shadowed; only deep
    # inside the cushion is a brown texel a blotch on the fabric
    reddish = seen & (C[:, 0] > C[:, 1] + 0.035)
    fabric &= ~(reddish & ((frac[:, 0] < 0.8) | (lum > 0.45)))
    # the edge between cushion and shell is a clean line on the real chair: by majority over ~4 cm, so no streaks
    if part == 'seat':
        major, _ = g.smooth(fabric[:, None].astype(np.float32), np.ones(len(C), bool), 3)
        fabric = (major[:, 0] > 0.5) & (P[:, 1] > 0.38)
    plain = ~fabric
    newC = C.copy()
    # the shell (white plastic, and its shadowed underside): CHAIR_1's own texture, its sharpest and most head-on
    # capture, wherever it is clean. A texel it lacks, or one darker than 85% of CHAIR_1's light around it (its grey
    # spots), takes the mirror, then CHAIR_2, then CHAIR_2's mirror, each first matched to CHAIR_1's light there (the
    # ratio of the two captures' smooth light over ~6 cm), so no patch shows; else CHAIR_1's smooth light
    Ls = [l[inside] for l in L]; Ms = [mk[inside] for mk in M]
    shellish = lambda c: (c[:, 0] >= c[:, 1] - 0.02) & ((c @ LUM) > 0.12)
    def robust_light(k):
        use = plain & Ms[k] & shellish(Ls[k])
        s1, _ = g.smooth(Ls[k], use, 5)
        keep = use & ((Ls[k] @ LUM) > 0.88 * (s1 @ LUM))
        sm, have = g.smooth(Ls[k], keep, 5)
        s9, have9 = g.smooth(Ls[k], keep, 9)
        sm[~have & have9] = s9[~have & have9]
        return sm, have | have9
    light = [robust_light(k) for k in range(4)]
    ref0, have0 = light[0]
    ref0_l = ref0 @ LUM
    # where the shell faces up or sideways it is lit white plastic: a texel is clean only if it is near the light the
    # bright white texels around it show (over ~11 cm), so a region CHAIR_1 saw as mostly blotchy is not taken as
    # it is. The underside, facing down, is shadowed: there a texel is checked against its own capture's light
    upside = N[:, 1] > -0.3
    bright = plain & seen & shellish(C) & ((C @ LUM) > 0.5)
    white_l, have_w = g.smooth(C, bright, 9)
    expect_l = np.where(upside & have_w, 0.80 * (white_l @ LUM), 0.85 * ref0_l)
    def ok(c, k):
        return Ms[k] & shellish(c) & ((c @ LUM) >= expect_l)
    done = plain & have0 & ok(Ls[0], 0)
    newC[done] = Ls[0][done]
    from_k = [int(done.sum())]
    for k in (1, 2, 3):
        refk, havek = light[k]
        adj = np.clip(Ls[k] * (ref0 / np.maximum(refk, 1e-3)), 0, 1)
        t = plain & ~done & have0 & havek & ok(adj, k)
        newC[t] = adj[t]; done |= t; from_k.append(int(t.sum()))
    rest = plain & ~done
    fill = np.where((upside & have_w)[:, None] & ((white_l @ LUM) > ref0_l)[:, None], white_l, ref0)
    newC[rest & have0] = fill[rest & have0]
    far = rest & ~have0
    if far.any():
        sd, haved = g.smooth(newC, done, 9)
        newC[far & haved] = sd[far & haved]
        newC[far & ~haved] = np.median(newC[done], 0)     # nothing near at all: the shell's median color
    if part == 'seat':
        # the seat pan (everything but the cushion): CHAIR_1 sees it as a clean, smoothly lit white bowl, but its
        # texture there is patchy and the rebuilt underside picked up dark data. So the pan's color is a lighting
        # model fitted to CHAIR_1's own shell texels: color as a function of the surface's facing and height (lit
        # sides white, the underside darker), fitted to the upper part of the data so spots don't count, plus a gentle (+-10%) correction
        # over ~11 cm that follows CHAIR_1's real light across the pan where it faces up or sideways (facing down, its
        # data is mostly holes, so the correction fades out there)
        X = np.stack([np.ones(len(C)), N[:, 1], N[:, 1] ** 2, N[:, 2], np.abs(N[:, 0]), P[:, 1], P[:, 2]], 1).astype(np.float32)
        train = plain & Ms[0] & shellish(Ls[0]) & ((Ls[0] @ LUM) > 0.15)
        Xt, Yt = X[train], Ls[0][train]
        # spots and holes only ever darken, so the fit follows the upper part of the data: a 70th-percentile
        # regression (iteratively reweighted), per channel
        sub = np.random.default_rng(0).choice(len(Xt), min(len(Xt), 400000), replace=False)
        Xs, Ys = Xt[sub], Yt[sub]
        beta = np.zeros((X.shape[1], 3), np.float32)
        for k in range(3):
            b = np.linalg.lstsq(Xs, Ys[:, k], rcond=None)[0]
            for _ in range(12):
                r = Ys[:, k] - Xs @ b
                w = np.where(r > 0, 0.7, 0.3) / np.maximum(np.abs(r), 0.01)
                b = np.linalg.lstsq(Xs * np.sqrt(w)[:, None], Ys[:, k] * np.sqrt(w), rcond=None)[0]
            beta[:, k] = b
        pred = np.clip(X @ beta, 0, 1)
        close = train & (np.abs(Ls[0] - pred).sum(1) < 0.15)
        resid, haver = g.smooth(Ls[0] - pred, close, 9)
        pan = plain & ~fabric
        rw = np.where(haver, np.clip((N[:, 1] + 0.5) / 0.4, 0, 1), 0)[:, None]
        newC[pan] = np.clip(pred[pan] + rw[pan] * np.clip(resid[pan], -0.10, 0.10), 0, 1)
    n_plain = max(int(plain.sum()), 1)
    print(part, 'shell texels from CHAIR_1 %.3f, mirror %.3f, CHAIR_2 %.3f, its mirror %.3f, smooth light %.3f' % (*[x / n_plain for x in from_k], rest.sum() / n_plain), flush=True)
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
