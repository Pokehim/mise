import numpy as np
from PIL import Image

def turbo(t):
    # Google's Turbo colormap, polynomial approximation
    t = np.clip(t, 0, 1)[..., None]
    r = np.array([0.13572138, 4.61539260, -42.66032258, 132.13108234, -152.94239396, 59.28637943])
    g = np.array([0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604])
    b = np.array([0.10667330, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973])
    p = np.concatenate([t**i for i in range(6)], -1)
    return np.clip(np.stack([p @ r, p @ g, p @ b], -1), 0, 1)

def camera(xyz, eye, target, fov_deg, W, H, f=None, cy=None):
    """f: focal length in px (else from fov_deg and H); cy: the principal point's row (else the middle)."""
    eye, target = np.asarray(eye, float), np.asarray(target, float)
    fwd = target - eye; fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    rel = xyz - eye
    xc, yc, zc = rel @ right, rel @ up, rel @ fwd
    if f is None: f = 0.5 * H / np.tan(np.radians(fov_deg) / 2)
    if cy is None: cy = H / 2
    with np.errstate(divide='ignore', invalid='ignore'):
        u = W / 2 + f * xc / zc
        v = cy - f * yc / zc
    return u, v, zc, f

def render_z(xyz, col, eye, target, fov, W, H, size=1.0, bg=(0, 0, 0), ss=2, alpha=None, f=None, cy=None):
    """Opaque points with a depth buffer. size: point radius in output px at 1 m."""
    Ws, Hs = W * ss, H * ss
    u, v, z, f = camera(xyz, eye, target, fov, Ws, Hs, None if f is None else f * ss, None if cy is None else cy * ss)
    m = (z > 0.1) & (u >= 0) & (u < Ws) & (v >= 0) & (v < Hs)
    u, v, z, c = u[m], v[m], z[m], col[m]
    a = None if alpha is None else alpha[m]
    order = np.argsort(-z)  # far first; near ones overwrite
    u, v, z, c = u[order], v[order], z[order], c[order]
    if a is not None: a = a[order]
    img = np.zeros((Hs, Ws, 3)); img[:] = bg
    r = np.clip(size * f / z, 0.5, 8 * ss)  # size: point radius in meters
    k = np.ceil(r).astype(int)
    for kk in np.unique(k):
        sel = k == kk
        uu, vv, cc = u[sel].astype(int), v[sel].astype(int), c[sel]
        rr = r[sel]
        for dy in range(-kk + 1, kk):
            for dx in range(-kk + 1, kk):
                if dx * dx + dy * dy > rr.max() ** 2: continue
                ok = (dx * dx + dy * dy <= rr ** 2)
                x2, y2 = uu[ok] + dx, vv[ok] + dy
                inb = (x2 >= 0) & (x2 < Ws) & (y2 >= 0) & (y2 < Hs)
                img[y2[inb], x2[inb]] = cc[ok][inb]
    # Note: buckets break strict depth order between sizes; sizes grow as z shrinks, so draw order still far->near by bucket
    return downsample(img, ss)

def render_glow(xyz, col, eye, target, fov, W, H, gain=1.0, ss=2, bg=(0, 0, 0), f=None, cy=None, weight=None):
    """Additive points: density reads as brightness, like a LiDAR viewer."""
    Ws, Hs = W * ss, H * ss
    u, v, z, f = camera(xyz, eye, target, fov, Ws, Hs, None if f is None else f * ss, None if cy is None else cy * ss)
    m = (z > 0.1) & (u >= 0) & (u < Ws - 1) & (v >= 0) & (v < Hs - 1)
    u, v, z, c = u[m], v[m], z[m], col[m]
    if weight is not None: c = c * weight[m][:, None]
    acc = np.zeros((Hs * Ws, 3))
    idx = v.astype(int) * Ws + u.astype(int)
    w = (1.0 / np.maximum(z, 0.5)) ** 0  # flat weight
    for ch in range(3):
        acc[:, ch] = np.bincount(idx, weights=c[:, ch] * w, minlength=Hs * Ws)
    acc = acc.reshape(Hs, Ws, 3)
    img = 1 - np.exp(-gain * acc)  # tone map
    img = np.asarray(bg) + img * (1 - np.asarray(bg))
    return downsample(img, ss)

def downsample(img, ss):
    if ss == 1: return img
    H, W = img.shape[0] // ss, img.shape[1] // ss
    return img[:H * ss, :W * ss].reshape(H, ss, W, ss, 3).mean((1, 3))

def save(img, path):
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)
