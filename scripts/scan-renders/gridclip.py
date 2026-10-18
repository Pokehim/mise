# The landing page's scan clip, 4:3, played over the room grid before the rooms assemble: the lounge's
# point cloud builds from the door to the window in LiDAR colors, the camera comes down to the door, the
# furniture's points clear away, and the points turn, near to far, into the lounge's Empty Room from the
# door: the first frame of every room clip (empty.webp). Run it with the app up (docs/landing/README.md):
# it opens the editor at ?shot=door&empty=1 for that frame and its camera.
import json, os, subprocess, sys
from multiprocessing import Pool
import numpy as np
from PIL import Image
from scene import *
from render import *

FPS = 30
W, H = 1440, 1080
SWEEP = (0.2, 2.8)  # the scan plane, door to window, while the camera turns overhead
FLY = (2.8, 4.4)    # down to the door
CLEAR = (4.2, 5.0)  # the furniture's points go
SOLID = (5.0, 6.0)  # the points turn into the Empty Room, near to far
END = 6.6
N = round(END * FPS)
DEST = os.path.join(ROOT, "web/src/pages/landing/scan")
os.makedirs(OUT, exist_ok=True)
DOOR = os.path.join(OUT, "door.json")  # the door shot's camera and its Empty Room, from door.mjs

xyz, rgb, heat = room(1)
# The furniture: whatever stands clear of the floor, the ceiling and every wall.
inside = (xyz[:, 0] > X0 + 0.12) & (xyz[:, 0] < X1 - 0.12) & (xyz[:, 2] > Z0 + 0.12) & (xyz[:, 2] < Z1 - 0.12) \
    & (xyz[:, 1] > FLOOR + 0.04) & (xyz[:, 1] < CEIL - 0.1)
# Each furniture point's moment to go, so they thin out rather than vanish at once.
leave = np.random.default_rng(1).random(len(xyz))

def smooth(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)
def phase(t, span): return smooth((t - span[0]) / (span[1] - span[0]))

R, ELEV = 7.4, 4.8
az0, az1 = np.radians(-25), np.radians(-70)
def orbit(t):
    a = az0 + (az1 - az0) * phase(t, (0, FLY[0]))
    eye = C + np.array([R * np.sin(a) * 0.62, ELEV, R * np.cos(a)])
    tgt, fov = frame(eye, W, H, fill=0.9)
    return eye, tgt, 0.5 * H / np.tan(np.radians(fov) / 2), H / 2

if not os.path.exists(DOOR) or "--door" in sys.argv:
    subprocess.run(["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "door.mjs"), os.path.abspath(OUT)], check=True, cwd=ROOT)
cam = json.load(open(DOOR))
k = W / cam["canvas"][0]
door_eye = np.array(cam["position"])
door_tgt = door_eye + 3 * np.array(cam["dir"])
door_f = 0.5 * cam["canvas"][1] / np.tan(np.radians(cam["fov"] / 2)) * k
# The landing clips keep a 4:3 band of the view from 16% down, so the band's center sits below the view's.
door_cy = (cam["canvas"][1] / 2 - cam["canvas"][1] * 0.16) * k

def pose(t):
    if t <= FLY[0]: return orbit(t)
    s = phase(t, FLY)
    e0, t0, f0, c0 = orbit(FLY[0])
    return e0 + (door_eye - e0) * s, t0 + (door_tgt - t0) * s, f0 + (door_f - f0) * s, c0 + (door_cy - c0) * s

def sweep_z(t):
    s = phase(t, SWEEP)
    return Z1 + 0.3 - s * (Z1 - Z0 + 0.6), s

def soften(img):
    """A 3×3 binomial blur: the points' speckle costs the WebM more than it shows."""
    p = np.pad(img, ((1, 1), (1, 1), (0, 0)), mode="edge")
    rows = p[:-2] + 2 * p[1:-1] + p[2:]
    return (rows[:, :-2] + 2 * rows[:, 1:-1] + rows[:, 2:])[:, :, :] / 16

def depth_map(points, eye, tgt, f, cy, cell=8):
    """How far the nearest point is, per pixel: taken on a coarse grid, which spans the gaps between points, then smoothed up."""
    u, v, z, _ = camera(points, eye, tgt, 55, W, H, f, cy)
    m = (z > 0.1) & (u >= 0) & (u < W) & (v >= 0) & (v < H)
    w, h = W // cell, H // cell
    d = np.full(h * w, 12.0)
    np.minimum.at(d, (v[m] // cell).astype(int) * w + (u[m] // cell).astype(int), np.minimum(z[m], 12))
    img = Image.fromarray(d.reshape(h, w).astype(np.float32), mode="F")
    return np.asarray(img.resize((w // 2, h // 2), Image.BILINEAR).resize((W, H), Image.BILINEAR))

EMPTY = None
def render_frame(i):
    global EMPTY
    if EMPTY is None:
        EMPTY = np.asarray(Image.open(os.path.join(OUT, "door.png")).convert("RGB").resize((W, H), Image.LANCZOS)) / 255
    t = i / FPS
    eye, tgt, f, cy = pose(t)
    zs, s = sweep_z(t)
    seen = xyz[:, 2] >= zs
    band = np.clip(1 - (xyz[:, 2] - zs) / 0.35, 0, 1) * (s < 1)
    col = heat * (1 - band[:, None]) + np.array([0.85, 1.0, 1.0]) * band[:, None] * 1.6
    near = np.linalg.norm(xyz - eye, axis=1) > 0.5
    # Overhead, the points glow through each other; at the door they stand solid, ceiling and all.
    solid = phase(t, (FLY[0] + 0.3, FLY[1]))
    img = 0
    if solid < 1:
        k = seen & (xyz[:, 1] < CEIL - 0.12) & near
        img = render_glow(xyz[k], col[k], eye, tgt, 55, W, H, gain=0.75, bg=BG, f=f, cy=cy) * (1 - solid)
    if solid > 0:
        gone = inside & (leave < phase(t, CLEAR))
        k = seen & dollhouse(xyz, eye, cut_ceiling=eye[1] > CEIL) & near & ~gone
        img = img + render_z(xyz[k], col[k], eye, tgt, 55, W, H, size=0.0028, bg=BG, f=f, cy=cy) * solid
        img = soften(img)
        wipe = phase(t, SOLID)
        if wipe > 0:
            # Near to far: a pixel turns once the wipe passes the nearest point there.
            depth = depth_map(xyz[k & ~inside], eye, tgt, f, cy)
            reach = 0.5 + wipe * 9.0
            m = np.clip((reach - depth) / 1.2, 0, 1)[..., None]
            m = np.maximum(m, phase(t, (SOLID[1] - 0.25, SOLID[1])))
            img = img * (1 - m) + EMPTY * m
    else:
        img = soften(img)
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)

if __name__ == "__main__":
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    raw = os.path.join(OUT, "scan.raw")
    with Pool(8) as pool, open(raw, "wb") as out:
        for i, fr in enumerate(pool.imap(render_frame, range(N), chunksize=2)):
            out.write(fr.tobytes())
            if "--frames" in sys.argv and i % 15 == 0: Image.fromarray(fr).save(os.path.join(OUT, f"grid-{i:03}.png"))
    # The page's slip: how many of the scan's points the plane has passed, ten times a second, and when
    # the scan stops being the scan and becomes the Empty Room.
    total = len(xyz)
    counts = [int(round(total * np.mean(xyz[:, 2] >= sweep_z(t / 10)[0]))) for t in range(int(END * 10) + 1)]
    json.dump({"total": total, "counts": counts, "empty": SOLID[0]}, open(os.path.join(DEST, "counts.json"), "w"))
    # Two sizes: phones (the grid under 800 px wide) get the small one.
    for name, size, crf in (("scan.webm", "1200:900", 52), ("scan-small.webm", "800:600", 56)):
        subprocess.run([ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", raw,
                        "-vf", f"scale={size}:flags=lanczos", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", str(crf), "-row-mt", "1", "-an",
                        os.path.join(DEST, name)], check=True)
    os.remove(raw)
    print("ok", total)
