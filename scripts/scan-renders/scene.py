import numpy as np
from load import load
from render import turbo
import os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data/scans/real-scans")
OUT = os.environ.get("OUT", "scan-renders")
# The room's inside, from wall histograms (walls.py); all three passes share this frame.
X0, X1, Z0, Z1, FLOOR, CEIL = -1.6, 1.62, -3.68, 3.57, -1.27, 1.25
C = np.array([(X0 + X1) / 2, (FLOOR + CEIL) / 2 - 0.3, (Z0 + Z1) / 2])
BG = np.array([10, 12, 16]) / 255

def room(i):
    xyz, rgb, op = load(f"{D}/POLYCAM_ROOM_SPLAT_{i}.ply")
    m = (xyz[:, 0] > X0 - 0.12) & (xyz[:, 0] < X1 + 0.12) & (xyz[:, 2] > Z0 - 0.12) & (xyz[:, 2] < Z1 + 0.12)
    xyz, rgb = xyz[m], rgb[m]
    h = (xyz[:, 1] - FLOOR) / (CEIL - FLOOR)
    return xyz, rgb, turbo(0.08 + 0.84 * np.clip(h, 0, 1))

def dollhouse(xyz, eye, cut_ceiling=True):
    """Keep what a dollhouse view shows: no ceiling, and no wall between the camera and the room."""
    keep = np.ones(len(xyz), bool)
    if cut_ceiling: keep &= xyz[:, 1] < CEIL - 0.12
    e = np.asarray(eye)
    if e[0] > X1: keep &= xyz[:, 0] < X1 - 0.08
    if e[0] < X0: keep &= xyz[:, 0] > X0 + 0.08
    if e[2] > Z1: keep &= xyz[:, 2] < Z1 - 0.08
    if e[2] < Z0: keep &= xyz[:, 2] > Z0 + 0.08
    return keep

CORNERS = np.array([[x, y, z] for x in (X0, X1) for y in (FLOOR, CEIL - 0.12) for z in (Z0, Z1)])

def frame(eye, W, H, fill=0.86, look=None):
    """A target and field of view that center the room's box in the frame, filling `fill` of it."""
    from render import camera
    eye = np.asarray(eye, float)
    tgt = C.copy() if look is None else np.asarray(look, float)
    fov = 40.0
    for _ in range(8):
        u, v, z, f = camera(CORNERS, eye, tgt, fov, W, H)
        du, dv = (u.min() + u.max()) / 2 - W / 2, (v.min() + v.max()) / 2 - H / 2
        fwd = tgt - eye; dist = np.linalg.norm(fwd); fwd /= dist
        right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right); up = np.cross(right, fwd)
        tgt = tgt + (du * right - dv * up) * dist / f
        span = max((u.max() - u.min()) / W, (v.max() - v.min()) / H)
        fov = np.degrees(2 * np.arctan(np.tan(np.radians(fov) / 2) * span / fill))
    return tgt, fov
