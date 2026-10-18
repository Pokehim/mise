"""A contact sheet of the 8 shots: python sheet.py <shots dir> <src> <out.jpg> (#77)."""
import glob
import os
import sys

from PIL import Image, ImageDraw

d, src, out = sys.argv[1:4]
files = sorted(glob.glob(os.path.join(d, f'*_{src}.png')))
w, h = 720, 450
sheet = Image.new('RGB', (2 * w, 4 * h), 'white')
draw = ImageDraw.Draw(sheet)
for i, f in enumerate(files[:8]):
    x, y = (i % 2) * w, (i // 2) * h
    sheet.paste(Image.open(f).convert('RGB').resize((w, h), Image.LANCZOS), (x, y))
    draw.rectangle([x, y, x + 200, y + 18], fill='black')
    draw.text((x + 4, y + 3), os.path.basename(f).split('_')[0], fill='white')
sheet.save(out, quality=88)
