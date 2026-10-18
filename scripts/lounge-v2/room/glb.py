"""empty-room.glb (#77 part 2, spec §3): the Empty Room's hole-free mesh, in the room frame.

Flat walls, floor, and ceiling at the room's measured size, plus simple boxes where something sticks out: the
baseboard, the North window's sill, the South door's frame, and the frames and mullions of the glass wall and the
main door. Every face takes its image by projection onto its surface's texture (textures.py), so a box's front
shows what the Captures saw there. Materials are unlit (KHR_materials_unlit): the images carry the real light.

Nodes: floor, ceiling, wall-north, wall-east, wall-south, wall-west (a wall's boxes and frames are in its node).
Each wall is a grid of cells split at its Openings' edges, so the editor can sort it into its Wall and the Openings'
contents (spec §9.4). Panes, the South door, and the frames also have far sides, so the Dollhouse view, which fades
the wall nearest the camera, still shows them.
The window, glass-wall, and door frames (common.GLAZING) have their own material: dark bronze anodized aluminum,
its face beveled and grooved, with black gaskets at the glass, and darker sides.
"""
import io
import json
import os

import numpy as np
import pygltflib as gl
from PIL import Image

from common import GLAZING, H, V2, WX0, WX1, WZ0, WZ1, X0, X1, Z0, Z1

TEX = os.path.join(os.path.dirname(__file__), '..', '..', '.cache', 'lounge-v2', 'tex')
JPEG_QUALITY = 90

# Walls on lounge-v1's lines, where their images are laid out: start, end, and inward normal (x, z). Each is drawn
# on its fitted plane instead (SHIFT, along the inward normal), and its images are looked up where they are in the room.
WALLS = {
    'north': ((X0, Z0), (X1, Z0), (0, 1)),
    'east': ((X1, Z0), (X1, Z1), (-1, 0)),
    'south': ((X1, Z1), (X0, Z1), (0, -1)),
    'west': ((X0, Z1), (X0, Z0), (1, 0)),
}
SHIFT = {'north': WZ0 - Z0, 'east': X1 - WX1, 'south': Z1 - WZ1, 'west': WX0 - X0}
# Each fitted wall's ends, along its old line: it meets the fitted walls on either side.
ENDS = {'north': (WX0 - X0, WX1 - X0), 'east': (WZ0 - Z0, WZ1 - Z0), 'south': (X1 - WX1, X1 - WX0), 'west': (Z1 - WZ1, Z1 - WZ0)}
BASE_H, BASE_D = 0.072, 0.008   # baseboard height and how far it sticks out
# Boxes on each wall: (u0, u1, y0, y1, depth out of the wall), u along the wall from its start.
BOXES = {
    'north': [(None, None, 0, BASE_H, BASE_D),
              (0.50, 2.26, 0.85, 0.89, 0.05)],                              # the window sill
    'east': [(None, None, 0, BASE_H, BASE_D)],
    'south': [],
    'west': [(1.82, None, 0, BASE_H, BASE_D)],
}
# The frame material's image: across a member's face (and its sides) by along it, repeating every FRAME_REPEAT m.
FRAME_REPEAT = 0.5
BRONZE = np.array([110, 99, 80]) / 255          # the lit face, as the splat shows it
BRONZE_SIDE = np.array([62, 56, 45]) / 255      # its sides
GASKET = np.array([28, 27, 25]) / 255


def frame_image(path):
    """256 x 256: the face's profile across columns 0-127 (black gasket, bevel, face, a center groove, face,
    bevel, gasket), the sides in 128-191 (darker toward the wall), the ends in 192-255."""
    x = np.linspace(0, 1, 128)
    cols = []
    for xi in x:
        c = (GASKET if xi < 0.05 or xi >= 0.95 else BRONZE * 1.18 if xi < 0.12 else BRONZE if xi < 0.48
             else BRONZE * 0.72 if xi < 0.52 else BRONZE * 0.95 if xi < 0.88 else BRONZE * 0.78)
        cols.append(c)
    face = np.array(cols)
    side = BRONZE_SIDE[None] * np.linspace(0.75, 1.1, 64)[:, None]
    end = np.tile(BRONZE_SIDE * 1.2, (64, 1))
    row = np.concatenate([face, side, end])                                    # 256 x 3
    rng = np.random.default_rng(4)
    # Brushed anodizing: faint streaks along the member, and a slow change along it.
    streak = 1 + 0.025 * rng.standard_normal((1, 256, 1))
    streak[:, 128:] = 1   # not on the sides and ends: seen edge-on, streaks alias into dots
    slow = 1 + 0.03 * np.sin(np.linspace(0, 2 * np.pi, 256))[:, None, None]
    im = np.clip(row[None] * streak * slow, 0, 1)
    Image.fromarray((im * 255).astype(np.uint8)).save(path)


def frame_geometry(name):
    """Each frame member as a box standing out of the wall, with UVs into the frame image: the face across its
    width, the sides across its depth, both along its length."""
    start, along, inward, length = wall_frame(name)
    origin = start + inward * SHIFT[name]
    up = np.array([0, 1, 0])
    P = lambda u, y, d=0: origin + along * u + up * y + inward * d
    pts, uvs, tris = [], [], []

    def quad(corners, uv):
        base = len(pts)
        pts.extend(corners)
        uvs.extend(uv)
        tris.extend([(base, base + 1, base + 2), (base, base + 2, base + 3)])

    F0, F1, S0, S1, E0, E1 = 0.5 / 256, 127.5 / 256, 128.5 / 256, 191.5 / 256, 192.5 / 256, 255.5 / 256
    for u0, u1, y0, y1, dd in GLAZING[name]['frames']:
        vertical = (y1 - y0) >= (u1 - u0)
        L = (y1 - y0 if vertical else u1 - u0) / FRAME_REPEAT
        if vertical:   # across = u, along = y
            quad([P(u0, y0, dd), P(u1, y0, dd), P(u1, y1, dd), P(u0, y1, dd)], [(F0, 0), (F1, 0), (F1, L), (F0, L)])
            quad([P(u0, y0), P(u0, y0, dd), P(u0, y1, dd), P(u0, y1)], [(S0, 0), (S1, 0), (S1, L), (S0, L)])
            quad([P(u1, y0), P(u1, y1), P(u1, y1, dd), P(u1, y0, dd)], [(S0, 0), (S0, L), (S1, L), (S1, 0)])
            quad([P(u0, y1), P(u0, y1, dd), P(u1, y1, dd), P(u1, y1)], [(E0, 0), (E1, 0), (E1, 0.1), (E0, 0.1)])
            quad([P(u0, y0), P(u1, y0), P(u1, y0, dd), P(u0, y0, dd)], [(E0, 0), (E0, 0.1), (E1, 0.1), (E1, 0)])
        else:          # across = y, along = u
            quad([P(u0, y0, dd), P(u1, y0, dd), P(u1, y1, dd), P(u0, y1, dd)], [(F1, 0), (F1, L), (F0, L), (F0, 0)])
            quad([P(u0, y1), P(u0, y1, dd), P(u1, y1, dd), P(u1, y1)], [(S0, 0), (S1, 0), (S1, L), (S0, L)])
            quad([P(u0, y0), P(u1, y0), P(u1, y0, dd), P(u0, y0, dd)], [(S0, 0), (S0, L), (S1, L), (S1, 0)])
            quad([P(u0, y0), P(u0, y0, dd), P(u0, y1, dd), P(u0, y1)], [(E0, 0), (E1, 0), (E1, 0.1), (E0, 0.1)])
            quad([P(u1, y0), P(u1, y1), P(u1, y1, dd), P(u1, y0, dd)], [(E0, 0), (E0, 0.1), (E1, 0.1), (E1, 0)])
        # The back, facing out of the room, so the frame is solid from outside too (the Dollhouse view).
        quad([P(u0, y0), P(u0, y1), P(u1, y1), P(u1, y0)], [(S0, 0), (S0, L), (S1, L), (S1, 0)])
    if not pts:
        return None
    return np.array(pts, np.float32), np.array(uvs, np.float32), np.array(tris, np.uint32)


def wall_frame(name):
    (sx, sz), (ex, ez), (nx, nz) = WALLS[name]
    start, d = np.array([sx, 0, sz]), np.array([ex - sx, 0, ez - sz])
    length = np.linalg.norm(d)
    return start, d / length, np.array([nx, 0, nz], float), length


CELL = 0.3   # m: the largest wall cell


def cuts(edges):
    """The edges, with more between them so no gap is over CELL."""
    out = [edges[0]]
    for a, b in zip(edges, edges[1:]):
        if b - a < 1e-4:
            continue
        n = int(np.ceil((b - a) / CELL))
        out += [a + (b - a) * k / n for k in range(1, n + 1)]
    return out


def openings():
    """setup.json's Openings per wall, as (u0, u1, y0, y1) along lounge-v1's line (as the images are laid out)."""
    with open(os.path.join(V2, 'setup.json')) as f:
        setup = json.load(f)
    names = {'wl_1': 'north', 'wl_2': 'east', 'wl_3': 'south', 'wl_4': 'west'}
    out = {n: [] for n in names.values()}
    for o in setup['openings']:
        name = names[o['wallId']]
        u0 = ENDS[name][0] + o['offset']
        out[name].append((u0, u0 + o['width'], o['bottom'], o['bottom'] + o['height']))
    return out


OPENINGS = openings()


def wall_geometry(name):
    start, along, inward, length = wall_frame(name)
    up = np.array([0, 1, 0])
    pts, tris = [], []
    origin = start + inward * SHIFT[name]
    ua, ub = ENDS[name]
    P = lambda u, y, d=0: origin + along * u + up * y + inward * d

    def quad(a, b, c, d):
        """Counter-clockwise seen from its front. From inside the room, along is to the right of a wall."""
        base = len(pts)
        pts.extend([a, b, c, d])
        tris.extend([(base, base + 1, base + 2), (base, base + 2, base + 3)])

    # The wall, facing in, as a grid of cells no bigger than CELL and split at every Opening's edges: the editor
    # sorts each triangle by its center (inside an Opening or not), so each cell must be wholly one or the other.
    us, ys = {ua, ub}, {0.0, H}
    for o in OPENINGS[name]:
        us |= {o[0], o[1]}
        ys |= {o[2], o[3]}
    us = cuts(sorted(u for u in us if ua <= u <= ub))
    ys = cuts(sorted(y for y in ys if 0 <= y <= H))
    for u0, u1 in zip(us, us[1:]):
        for y0, y1 in zip(ys, ys[1:]):
            quad(P(u0, y0), P(u1, y0), P(u1, y1), P(u0, y1))
    for u0, u1, y0, y1, dd in BOXES[name]:
        u0, u1 = ua if u0 is None else u0, ub if u1 is None else u1
        quad(P(u0, y0, dd), P(u1, y0, dd), P(u1, y1, dd), P(u0, y1, dd))            # front
        quad(P(u0, y1), P(u0, y1, dd), P(u1, y1, dd), P(u1, y1))                    # top
        quad(P(u0, y0), P(u1, y0), P(u1, y0, dd), P(u0, y0, dd))                    # bottom
        quad(P(u0, y0), P(u0, y0, dd), P(u0, y1, dd), P(u0, y1))                    # left end
        quad(P(u1, y0), P(u1, y1), P(u1, y1, dd), P(u1, y0, dd))                    # right end
    pts = np.array(pts, np.float32)
    u = (pts - start) @ along
    uv = np.stack([u / length, (H - pts[:, 1]) / H], axis=1)
    return pts, uv.astype(np.float32), np.array(tris, np.uint32)



BACK = 0.002   # m outside the wall: the glass's and the door's far sides
DOOR = (0.03, 0.95, 0.0, 2.28)   # the South door's leaf (textures.DOOR)


def back_geometry(name):
    """The far sides of what's in the wall's Openings, facing out of the room, for a view from outside (the
    Dollhouse): each pane (translucent frosted glass) and the South door (its image, mirrored as seen from the
    hallway). From inside the room they face away and aren't drawn."""
    start, along, inward, length = wall_frame(name)
    origin = start + inward * (SHIFT[name] - BACK)
    up = np.array([0, 1, 0])
    P = lambda u, y: origin + along * u + up * y

    def quads(rects):
        pts, tris = [], []
        for u0, u1, y0, y1 in rects:
            b = len(pts)
            pts += [P(u0, y0), P(u0, y1), P(u1, y1), P(u1, y0)]   # counter-clockwise seen from outside
            tris += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
        pts = np.array(pts, np.float32).reshape(-1, 3)
        uv = np.stack([((pts - start) @ along) / length, (H - pts[:, 1]) / H], axis=1).astype(np.float32)
        return pts, uv, np.array(tris, np.uint32).reshape(-1, 3)

    glass = quads(GLAZING[name]['panes']) if GLAZING[name]['panes'] else None
    door = quads([DOOR]) if name == 'south' else None
    return glass, door


def flat(name):
    W, D = X1 - X0, Z1 - Z0
    if name == 'floor':
        pts = np.array([[WX0, 0, WZ0], [WX0, 0, WZ1], [WX1, 0, WZ1], [WX1, 0, WZ0]], np.float32)   # seen from above
        uv = np.array([[(p[0] - X0) / W, (p[2] - Z0) / D] for p in pts], np.float32)
    else:
        pts = np.array([[WX0, H, WZ0], [WX1, H, WZ0], [WX1, H, WZ1], [WX0, H, WZ1]], np.float32)   # seen from below
        uv = np.array([[(p[0] - X0) / W, (Z1 - p[2]) / D] for p in pts], np.float32)
    return pts, uv, np.array([(0, 1, 2), (0, 2, 3)], np.uint32)


class Builder:
    def __init__(self):
        self.g = gl.GLTF2(asset=gl.Asset(generator='scripts/lounge-v2/room/glb.py (#77)'), scene=0,
                          scenes=[gl.Scene(nodes=[])], extensionsUsed=['KHR_materials_unlit'])
        self.blob = bytearray()
        self.mats = {}

    def view(self, data, target=None):
        while len(self.blob) % 4:
            self.blob.append(0)
        off = len(self.blob)
        self.blob.extend(data)
        self.g.bufferViews.append(gl.BufferView(buffer=0, byteOffset=off, byteLength=len(data), target=target))
        return len(self.g.bufferViews) - 1

    def accessor(self, arr, kind, target):
        v = self.view(arr.tobytes(), target)
        ctype = gl.UNSIGNED_INT if arr.dtype == np.uint32 else gl.FLOAT
        acc = gl.Accessor(bufferView=v, componentType=ctype, count=len(arr) if kind != 'SCALAR' else arr.size, type=kind)
        if kind == 'VEC3':
            acc.min, acc.max = arr.min(0).tolist(), arr.max(0).tolist()
        self.g.accessors.append(acc)
        return len(self.g.accessors) - 1

    def material(self, name):
        if name in self.mats:
            return self.mats[name]
        if name.endswith('-door-back'):   # the wall's image, under a name of its own
            wall = self.g.materials[self.material(name.split('-')[0])]
            self.g.materials.append(gl.Material(name=name, doubleSided=False, pbrMetallicRoughness=wall.pbrMetallicRoughness,
                                                extensions={'KHR_materials_unlit': {}}))
            self.mats[name] = len(self.g.materials) - 1
            return self.mats[name]
        if name == 'glass-back':   # frosted glass seen from outside: light grey, partly see-through
            self.g.materials.append(gl.Material(
                name=name, doubleSided=False, alphaMode='BLEND',
                pbrMetallicRoughness=gl.PbrMetallicRoughness(baseColorFactor=[0.70, 0.72, 0.73, 0.45],
                                                             metallicFactor=0, roughnessFactor=1),
                extensions={'KHR_materials_unlit': {}}))
            self.mats[name] = len(self.g.materials) - 1
            return self.mats[name]
        hd = os.path.join(TEX, f'{name}.hd.png')   # a wall's finished image, when textures.py made one
        im = Image.open(hd if os.path.exists(hd) else os.path.join(TEX, f'{name}.png')).convert('RGB')
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=JPEG_QUALITY, subsampling=0)
        self.g.images.append(gl.Image(bufferView=self.view(buf.getvalue()), mimeType='image/jpeg', name=name))
        wrap = gl.REPEAT if name == 'frame' else gl.CLAMP_TO_EDGE
        self.g.samplers.append(gl.Sampler(magFilter=gl.LINEAR, minFilter=gl.LINEAR_MIPMAP_LINEAR, wrapS=gl.CLAMP_TO_EDGE, wrapT=wrap))
        self.g.textures.append(gl.Texture(source=len(self.g.images) - 1, sampler=len(self.g.samplers) - 1))
        self.g.materials.append(gl.Material(
            name=name, doubleSided=False,
            pbrMetallicRoughness=gl.PbrMetallicRoughness(baseColorTexture=gl.TextureInfo(index=len(self.g.textures) - 1),
                                                         metallicFactor=0, roughnessFactor=1),
            extensions={'KHR_materials_unlit': {}}))
        self.mats[name] = len(self.g.materials) - 1
        return self.mats[name]

    def node(self, name, *prims):
        """A node of one mesh: each prim is (points, uvs, triangles, material name)."""
        out = []
        for pts, uv, tris, mat in prims:
            out.append(gl.Primitive(attributes=gl.Attributes(POSITION=self.accessor(pts, 'VEC3', gl.ARRAY_BUFFER),
                                                             TEXCOORD_0=self.accessor(uv, 'VEC2', gl.ARRAY_BUFFER)),
                                    indices=self.accessor(tris.reshape(-1), 'SCALAR', gl.ELEMENT_ARRAY_BUFFER),
                                    material=self.material(mat)))
        self.g.meshes.append(gl.Mesh(name=name, primitives=out))
        self.g.nodes.append(gl.Node(name=name, mesh=len(self.g.meshes) - 1))
        self.g.scenes[0].nodes.append(len(self.g.nodes) - 1)

    def save(self, path):
        self.g.buffers = [gl.Buffer(byteLength=len(self.blob))]
        self.g.set_binary_blob(bytes(self.blob))
        self.g.save_binary(path)


def main():
    frame_image(os.path.join(TEX, 'frame.png'))
    b = Builder()
    for name in ['floor', 'ceiling']:
        b.node(name, (*flat(name), name))
    for name in WALLS:
        frames = frame_geometry(name)
        glass, door = back_geometry(name)
        prims = [(*wall_geometry(name), name)]
        prims += [(*frames, 'frame')] if frames else []
        prims += [(*door, f'{name}-door-back')] if door else []
        prims += [(*glass, 'glass-back')] if glass else []
        b.node(f'wall-{name}', *prims)
    path = os.path.join(V2, 'empty-room.glb')
    b.save(path)
    print('wrote', path, f'{os.path.getsize(path) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
