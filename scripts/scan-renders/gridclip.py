# The landing page's scan clip: the lounge's point cloud building, 4:3, to play over the room grid.
import numpy as np, os, subprocess, json
from multiprocessing import Pool
from scene import *
from render import *
FPS, SECS = 30, 5
W, H = 1440, 1080
N = FPS * SECS
xyz, rgb, heat = room(1)
noceil = xyz[:, 1] < CEIL - 0.12
P, Hc = xyz[noceil], heat[noceil]
def smooth(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)
R, ELEV = 7.4, 4.8
az0, az1 = np.radians(-15), np.radians(-70)
SWEEP = (0.2, 3.0)   # seconds the scan plane takes, door to window
COLOR = (3.0, 4.2)   # seconds the true color fades in
def eye_at(i):
    a = az0 + (az1 - az0) * smooth(i / (N - 1) * 1.15)
    return C + np.array([R * np.sin(a) * 0.62, ELEV, R * np.cos(a)])
def zs_at(t):
    s = smooth((t - SWEEP[0]) / (SWEEP[1] - SWEEP[0]))
    return Z1 + 0.3 - s * (Z1 - Z0 + 0.6), s
def render_frame(i):
    t = i / FPS
    eye = eye_at(i)
    tgt, fov = frame(eye, W, H, fill=0.9)
    zs, s = zs_at(t)
    seen = P[:, 2] >= zs
    band = np.clip(1 - (P[:, 2] - zs) / 0.35, 0, 1) * (s < 1)
    col = Hc * (1 - band[:, None]) + np.array([0.85, 1.0, 1.0]) * band[:, None] * 1.6
    img = render_glow(P[seen], col[seen], eye, tgt, fov, W, H, gain=0.75, bg=BG)
    mix = smooth((t - COLOR[0]) / (COLOR[1] - COLOR[0]))
    if mix > 0:
        k = dollhouse(xyz, eye)
        img = img * (1 - mix) + render_z(xyz[k], rgb[k], eye, tgt, fov, W, H, size=0.0065, bg=BG) * mix
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
if __name__ == '__main__':
    import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../web/src/pages/landing/scan')
    raw = os.path.join(dest, 'grid.raw')
    with Pool(8) as pool, open(raw, 'wb') as f:
        for i, fr in enumerate(pool.imap(render_frame, range(N), chunksize=2)):
            f.write(fr.tobytes())
    # How many of the scan's points the plane has passed, ten times a second, for the page's counter.
    total = len(xyz)
    counts = [int(round(total * np.mean(xyz[:, 2] >= zs_at(t / 10)[0]))) for t in range(SECS * 10 + 1)]
    json.dump({'total': total, 'counts': counts}, open(os.path.join(dest, 'counts.json'), 'w'))
    src = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', raw]
    subprocess.run([ff, '-y', '-loglevel', 'error', *src, '-vf', 'gblur=sigma=0.7,scale=1200:900:flags=lanczos',
                    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '44', '-row-mt', '1', '-an', os.path.join(dest, 'scan.webm')], check=True)
    os.remove(raw)
    print('ok', total)
