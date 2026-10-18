# The PR's check images: each Master Copy from 4 sides beside its source scan, and the placed Originals over the
# room scan from above. Renders with render.py (Blender, unlit texture color), then labels and tiles them.
# usage: python pr_renders.py <repo root> <originals.json> <chair1_crop.glb> <chair2_crop.glb> <outdir>
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

root, originals_path, c1, c2, out = sys.argv[1:6]
HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
M = f'{root}/data/scans/lounge-v2/models'
GLB1 = {'path': f'{root}/data/scans/real-scans/POLYCAM_ROOM_GLB_1.glb', 'pos': [-0.044, 1.202, 0.029], 'rotY': -0.008005}
originals = json.load(open(originals_path))
os.makedirs(out, exist_ok=True)
font = ImageFont.load_default(size=28)
ONLY = os.environ.get('ONLY', 'chair,table,whiteboard,top').split(',')

def render(name, files, views, res=(800, 800), bg=(0.42, 0.40, 0.38)):
    spec = dict(files=files, views=views, res=list(res), out=f'{out}/{name}', bg=list(bg))
    p = f'{out}/{name}.json'
    json.dump(spec, open(p, 'w'))
    subprocess.run([BLENDER, '-b', '--python', f'{HERE}/render.py', '--', p], check=True, capture_output=True)
    return {v['name']: Image.open(f'{out}/{name}_{v["name"]}.png').convert('RGB') for v in views}

def sheet(rows, row_labels, col_labels, path):
    w, h = rows[0][0].size
    S = Image.new("RGB", (w * len(rows[0]) + 330, h * len(rows) + 50), (24, 24, 24))
    d = ImageDraw.Draw(S)
    for j, c in enumerate(col_labels):
        d.text((330 + j * w + 10, 10), c, fill=(230, 230, 230), font=font)
    for i, (row, lab) in enumerate(zip(rows, row_labels)):
        d.text((10, 50 + i * h + h // 2 - 30), lab, fill=(230, 230, 230), font=font)
        for j, im in enumerate(row):
            S.paste(im, (330 + j * w, 50 + i * h))
    S.save(path, quality=90)
    print('wrote', path)

def placed(o):
    p = o['box']['position']
    return {'path': f'{root}/data/scans/lounge-v2/{o["model"]}', 'pos': p, 'rotY': o['box']['rotationY']}

def sides(cx, cy, cz, yaw, dist, ortho):
    """front/back/left/right of an item turned by yaw (front = its +Z)"""
    out_ = []
    for name, a in (('front', 0), ('right', np.pi / 2), ('back', np.pi), ('left', -np.pi / 2)):
        d = np.array([np.sin(yaw + a), 0, np.cos(yaw + a)])
        out_.append(dict(name=name, eye=(np.array([cx, cy, cz]) + d * dist).tolist(), target=[cx, cy, cz], ortho=ortho, clip=[0.01, dist + 1.2]))
    return out_

# ---- chair: Master Copy vs the two Detail Captures (cut out and scaled to meters, same frame) ----
import struct
cols = ['front', 'right', 'back', 'left']
b = open(f'{M}/chair.glb', 'rb').read(); n = struct.unpack('<I', b[12:16])[0]
shift = next(nd for nd in json.loads(b[20:20 + n])['nodes'] if nd.get('name') == 'seat').get('translation', [0, 0, 0])
ic = json.load(open(os.environ['ICP12'])) if 'ICP12' in os.environ else None
if 'chair' in ONLY:
    views = sides(0, 0.43, 0, 0, 3, 0.95)
    mc = render('chair_mc', [{'path': f'{M}/chair.glb'}], views)
    s2 = render('chair_scan2', [{'path': c2, 'pos': shift}], views)
    files1 = [{'path': c1, 'pos': shift}]
    if ic is not None:
        from scipy.spatial.transform import Rotation as Rot
        R = Rot.from_rotvec(ic['rotvec']).as_matrix() * ic['s']
        Mx = np.eye(4); Mx[:3, :3] = R; Mx[:3, 3] = np.array(ic['t']) + shift
        files1 = [{'path': c1, 'M': Mx.tolist()}]
    s1 = render('chair_scan1', files1, views)
    sheet([[mc[c] for c in cols], [s1[c] for c in cols], [s2[c] for c in cols]],
          ['Master Copy', 'POLYCAM_CHAIR_1\n(scaled x1.452)', 'POLYCAM_CHAIR_2\n(scaled x1.170)'], cols, f'{out}/chair_4sides.jpg')

# ---- table: Master Copy at Table 2's pose vs GLB_1 there. Cameras stay inside the room, between the tables;
# the West end stands against the wall, so it is seen from under the top, looking West ----
t = next(o for o in originals if o['label'] == 'Table 2')
tx, _, tz = t['box']['position']
tviews = [dict(name='South (front)', eye=[tx, 0.4, tz + 0.95], target=[tx, 0.4, tz - 1], ortho=1.9, clip=[0.01, 3]),
          dict(name='North', eye=[tx, 0.4, tz - 0.95], target=[tx, 0.4, tz + 1], ortho=1.9, clip=[0.01, 3]),
          dict(name='East end (legs)', eye=[1.40, 0.4, tz], target=[tx, 0.4, tz], ortho=1.9, clip=[0.01, 4]),
          dict(name='West end, from under the top', eye=[-0.75, 0.22, tz + 0.05], target=[-1.6, 0.45, tz], fov=75, clip=[0.01, 3])]
if 'table' in ONLY:
    tm = render('table_mc', [placed(t)], tviews)
    tg = render('table_glb1', [GLB1], tviews)
    tc = [v['name'] for v in tviews]
    sheet([[tm[c] for c in tc], [tg[c] for c in tc]], ['Master Copy\n(Table 2 pose)', 'POLYCAM_ROOM\n_GLB_1'], tc, f'{out}/table_4sides.jpg')

# ---- whiteboard ----
w = next(o for o in originals if o['label'] == 'Whiteboard')
views = [dict(name='front', eye=[-0.5, 1.6, -0.52], target=[1.6, 1.6, -0.52], ortho=6.4, clip=[0.01, 2.2]),
         dict(name='end', eye=[1.15, 1.05, 2.75], target=[1.54, 0.86, 2.30], fov=50, clip=[0.01, 3]),
         dict(name='close', eye=[0.9, 1.6, -2.6], target=[1.55, 1.6, -2.6], fov=40, clip=[0.01, 2])]
if 'whiteboard' in ONLY:
  wm = render('wb_mc', [placed(w)], views, res=(1200, 600))
  wg = render('wb_glb1', [GLB1], views, res=(1200, 600))
  sheet([[wm[c] for c in ('front', 'end', 'close')], [wg[c] for c in ('front', 'end', 'close')]],
        ['Master Copy', 'POLYCAM_ROOM\n_GLB_1'], ['front', 'South end, tray', 'writing'], f'{out}/whiteboard_views.jpg')

# ---- the 16 Originals over the room scan, from above ----
top = [dict(name='top', eye=[0, 2.3, 0.05], target=[0, 0, 0.05], up=[0, 0, -1], ortho=7.6, clip=[0.01, 2.5])]
g = render('top_glb1', [GLB1], top, res=(1200, 1200), bg=(0, 0, 0))['top']
o = render('top_originals', [placed(x) for x in originals], top, res=(1200, 1200), bg=(0, 0, 0))['top']
ga, oa = np.asarray(g).astype(float), np.asarray(o).astype(float)
mask = oa.max(2) > 8
blend = ga.copy(); blend[mask] = 0.45 * ga[mask] + 0.55 * oa[mask]
edge = mask ^ np.pad(mask[1:-1, 1:-1] & mask[:-2, 1:-1] & mask[2:, 1:-1] & mask[1:-1, :-2] & mask[1:-1, 2:], 1)
blend[edge] = [255, 40, 200]
sheet([[g, Image.fromarray(oa.astype(np.uint8)), Image.fromarray(blend.astype(np.uint8))]], [''],
      ['POLYCAM_ROOM_GLB_1', 'the 16 Originals', 'overlay (outline magenta)'], f'{out}/originals_overlay.jpg')
