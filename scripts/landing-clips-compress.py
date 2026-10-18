# Encodes the landing page's room clips for the page after scripts/landing-clips.ts records them. The
# browser records near-lossless (8 Mb/s, in real time); the rooms show about 374 device pixels across on
# a Retina screen, so 480×360 at CRF 30, at VP9's own pace, is sharp there at about 120 kB a clip.
# Clips already 480 wide are left alone, so running it twice doesn't encode them twice.
#   uv run --with imageio-ffmpeg python scripts/landing-clips-compress.py
import glob, os, re, subprocess
import imageio_ffmpeg

ff = imageio_ffmpeg.get_ffmpeg_exe()
for clip in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "../web/src/pages/landing/ds_*.webm"))):
    probe = subprocess.run([ff, "-i", clip], capture_output=True, text=True).stderr
    if re.search(r"Video: .*\b480x360\b", probe):
        continue
    before = os.path.getsize(clip)
    out = clip + ".tmp.webm"
    subprocess.run([ff, "-y", "-loglevel", "error", "-i", clip, "-vf", "scale=480:360:flags=lanczos", "-r", "30",
                    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-pix_fmt", "yuv420p", "-row-mt", "1", "-deadline", "good", "-cpu-used", "1", "-an", out], check=True)
    os.replace(out, clip)
    print(f"{os.path.basename(clip)}: {before // 1000} kB → {os.path.getsize(clip) // 1000} kB")
