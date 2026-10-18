# Replace the base color image of named materials inside a .glb, in place (no Blender round trip).
# usage: python swap_textures.py <file.glb> <material>=<image.jpg> [<material>=<image.jpg> ...]
import json, struct, sys

path = sys.argv[1]
swaps = dict(a.split('=', 1) for a in sys.argv[2:])
b = open(path, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + jl])
bin_off = 20 + jl
bl = struct.unpack('<I', b[bin_off:bin_off + 4])[0]
blob = b[bin_off + 8:bin_off + 8 + bl]

new_data = {}
for mat in j['materials']:
    if mat['name'] in swaps:
        tex = j['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]
        img = j['images'][tex['source']]
        new_data[img['bufferView']] = open(swaps[mat['name']], 'rb').read()
        img['mimeType'] = 'image/jpeg'
        print('swap', mat['name'], '-> image', tex['source'])
missing = set(swaps) - {m['name'] for m in j['materials']}
assert not missing, f'no material named {missing}'

out = bytearray()
for i, bv in enumerate(j['bufferViews']):
    data = new_data.get(i, blob[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])
    while len(out) % 4:
        out += b'\0'
    bv['byteOffset'] = len(out); bv['byteLength'] = len(data)
    out += data
while len(out) % 4:
    out += b'\0'
j['buffers'][0]['byteLength'] = len(out)
js = json.dumps(j, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(out), b'BIN\0') + bytes(out)
open(path, 'wb').write(glb)
print(path, len(glb), 'bytes')
