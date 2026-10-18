# Shrinks the landing page's room clips after scripts/landing-clips.ts records them. The browser's
# recorder encodes in real time and spends about 400 kb/s; the rooms show at about 180 px across, so
# 480×360 at VP9's own pace looks the same at about a third of the bytes. Clips already 480 wide are
# left alone, so running it twice doesn't encode them twice.
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
                    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1", "-deadline", "good", "-cpu-used", "1", "-an", out], check=True)
    os.replace(out, clip)
    print(f"{os.path.basename(clip)}: {before // 1000} kB → {os.path.getsize(clip) // 1000} kB")
