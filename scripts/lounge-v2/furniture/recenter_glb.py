# Put a Master Copy's origin at the center of its footprint: shift every top-level node so the bounding box
# of all nodes except "shadow" is centered on x = z = 0 (y is untouched: the floor stays at y = 0). With --wall, for
# something hung on a wall, y = 0 is its bottom edge instead, so its Original's box starts there and not on the floor.
# usage: python recenter_glb.py <file.glb> [--wall]   (edits in place, prints the shift and the resulting size)
import json, struct, sys
import numpy as np

path = sys.argv[1]
b = open(path, 'rb').read()
n = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + n])
rest = b[20 + n:]
lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
for node in j['nodes']:
    if node.get('name') == 'shadow' or 'mesh' not in node:
        continue
    t = np.array(node.get('translation', [0, 0, 0]))
    for prim in j['meshes'][node['mesh']]['primitives']:
        acc = j['accessors'][prim['attributes']['POSITION']]
        lo = np.minimum(lo, np.array(acc['min']) + t); hi = np.maximum(hi, np.array(acc['max']) + t)
shift = -(lo + hi) / 2; shift[1] = -lo[1] if '--wall' in sys.argv else 0
roots = set(range(len(j['nodes']))) - {c for nd in j['nodes'] for c in nd.get('children', [])}
for i in roots:
    nd = j['nodes'][i]
    nd['translation'] = (np.array(nd.get('translation', [0, 0, 0])) + shift).round(6).tolist()
js = json.dumps(j, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
out = b[:12] + struct.pack('<I', len(js)) + b'JSON' + js + rest
out = out[:8] + struct.pack('<I', len(out)) + out[12:]
open(path, 'wb').write(out)
print(path, 'shift', shift.round(4).tolist(), 'size', (hi - lo).round(4).tolist(), 'y', (lo[1] + shift[1]).round(4), (hi[1] + shift[1]).round(4))
