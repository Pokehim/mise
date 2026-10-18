# The 10-second scan video, for slides: the cloud building in LiDAR colors, then in true color (OUT=dir python anim.py).
import numpy as np, os, sys, subprocess
from multiprocessing import Pool
from scene import *
from render import *
FPS, SECS = 30, 10
W, H = 1920, 1080
N = FPS * SECS
xyz, rgb, heat = room(1)
noceil = xyz[:, 1] < CEIL - 0.12
P, Hc, Rc = xyz[noceil], heat[noceil], rgb[noceil]

def smooth(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)
# The orbit: around the room's middle, from the door corner round toward the long side.
R, ELEV = 7.4, 4.6
az0, az1 = np.radians(35), np.radians(-70)
def eye_at(i):
    a = az0 + (az1 - az0) * smooth(i / (N - 1))
    return C + np.array([R * np.sin(a) * 0.62, ELEV, R * np.cos(a)])

def render_frame(i):
    t = i / FPS
    eye = eye_at(i)
    tgt, FOV = frame(eye, W, H, fill=0.84)
    # The sweep: a scan plane from the door (+z) to the window (-z); points behind it are seen.
    s = smooth((t - 0.3) / 4.2)
    zs = Z1 + 0.3 - s * (Z1 - Z0 + 0.6)
    seen = P[:, 2] >= zs
    col = Hc.copy()
    band = np.clip(1 - (P[:, 2] - zs) / 0.35, 0, 1) * (s < 1)
    col = col * (1 - band[:, None]) + np.array([0.85, 1.0, 1.0]) * band[:, None] * 1.6
    img = render_glow(P[seen], col[seen], eye, tgt, FOV, W, H, gain=0.75, bg=BG)
    # Then the true color, as a dollhouse.
    mix = smooth((t - 7.0) / 2.0)
    if mix > 0:
        k = dollhouse(xyz, eye)
        img2 = render_z(xyz[k], rgb[k], eye, tgt, FOV, W, H, size=0.0065, bg=BG)
        img = img * (1 - mix) + img2 * mix
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)

if __name__ == '__main__':
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    os.makedirs(OUT, exist_ok=True)
    raw = f'{OUT}/frames.raw'
    with Pool(8) as pool, open(raw, 'wb') as f:
        for i, fr in enumerate(pool.imap(render_frame, range(N), chunksize=2)):
            f.write(fr.tobytes())
            if i % 30 == 0: print('frame', i, flush=True)
            if i == N - 1: from PIL import Image; Image.fromarray(fr).save(f'{OUT}/scan-sweep-poster.png')
            if i == int(5.5 * FPS): from PIL import Image; Image.fromarray(fr).save(f'{OUT}/scan-sweep-mid.png')
    src = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', raw]
    subprocess.run([ff, '-y', '-loglevel', 'error', *src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', f'{OUT}/scan-sweep-1080p.mp4'], check=True)
    subprocess.run([ff, '-y', '-loglevel', 'error', *src, '-vf', 'scale=1280:-2', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-an', f'{OUT}/scan-sweep-720p.webm'], check=True)
    os.remove(raw)
    print('encoded')
