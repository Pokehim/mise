# models/chair.glb: the lounge chair's Master Copy.
# usage: Blender -b --python chair.py -- <parts dir> <chair1_crop.glb> <chair2_crop.glb> <icp12.json> <out.glb> <tmpdir>
#
# - parts dir: seat.glb and back.glb from chair_parts.py, i.e. the seat+back shell rebuilt (chair_shell.py) from
#   POLYCAM_CHAIR_1 made symmetric, holes filled from its other half and then from POLYCAM_CHAIR_2, cut at
#   y = 0.50 and UV-unwrapped. Meters, +Y up, front +Z, chair-2 canonical frame.
# - chairN_crop.glb: each Detail Capture cut out and scaled to meters (crop_chair.py); chair 1 is moved onto
#   chair 2 by icp12.json.
# Parts: "seat" (shell below y = 0.50: pad and seat pan), "back" (above), "legs" (4 straight tapered legs,
# their glides and the metal frame under the seat), plus "shadow".
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh, mathutils
import numpy as np
from bl_util import reset, g2b, mesh_object, unlit_material, join, recalc_normals, soft_rect_alpha, shadow_plane, export, image_from_array, box

parts_dir, c1, c2, icp_path, out, tmp = sys.argv[sys.argv.index('--') + 1:][:6]
TEX = 4096
SPLAT_SHELL = np.array([188, 173, 161]) / 255   # chair back (white shell) median color in SPLAT_ROOM_1
# legs: symmetric fit of both scans (legs.py). foot = axis point at y=0; slope = d(x,z)/dy for the +x side
LEG_BACK = dict(foot=(0.2272, -0.2306), slope=(-np.tan(np.radians(13.26)), np.tan(np.radians(14.15))))
LEG_FRONT = dict(foot=(0.2280, 0.2230), slope=(-np.tan(np.radians(10.49)), -np.tan(np.radians(7.07))))
R0, R1 = 0.0120, (0.01815 - 0.0120) / 0.35      # radius(y) = R0 + R1*y
LEG_TOP = 0.40
LEG_RGB = [(0.00, (208, 123, 72)), (0.10, (197, 118, 66)), (0.20, (190, 118, 65)), (0.30, (171, 105, 60)), (0.40, (165, 100, 58))]
FRAME_RGB = (55, 45, 42)
GLIDE_RGB = (120, 118, 115)
G2B = mathutils.Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

reset()
sc = bpy.context.scene

# ---------- seat / back (split and UV-unwrapped by chair_parts.py) ----------
parts = {}
for name in ('back', 'seat'):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{parts_dir}/{name}.glb')
    ob = [o for o in bpy.data.objects if o not in before and o.type == 'MESH'][0]
    ob.parent = None
    ob.name = name; ob.data.name = name
    parts[name] = ob
for o in [o for o in bpy.data.objects if o.type == 'EMPTY']:
    bpy.data.objects.remove(o)
for ob in parts.values():
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    recalc_normals(ob)
    bpy.ops.object.shade_smooth()
    print(ob.name, 'bounds (Blender)', [tuple(round(c, 3) for c in v) for v in (ob.bound_box[0], ob.bound_box[6])])

# ---------- bake sources ----------
def import_glb(path, M=None):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    obs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in obs:
        if M is not None:
            o.matrix_world = G2B @ M @ G2B.inverted() @ o.matrix_world
    return obs
icp = json.load(open(icp_path))
R = mathutils.Matrix.Rotation(np.linalg.norm(icp['rotvec']), 4, mathutils.Vector(icp['rotvec']).normalized())
M1 = mathutils.Matrix.Translation(icp['t']) @ R @ mathutils.Matrix.Scale(icp['s'], 4)
src1 = import_glb(c1, M1)[0]
src2 = import_glb(c2)[0]
def mirrored(src):
    m = src.copy(); m.data = src.data.copy(); sc.collection.objects.link(m)
    m.matrix_world = mathutils.Matrix.Scale(-1, 4, (1, 0, 0)) @ src.matrix_world
    return m
src1m, src2m = mirrored(src1), mirrored(src2)
for o in (src1, src1m, src2, src2m):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
recalc_normals(src1m); recalc_normals(src2m)

def emission_from_texture(o):
    for slot in o.material_slots:
        m = slot.material; nt = m.node_tree
        tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(tex.outputs['Color'], em.inputs['Color'])
        nt.links.new(em.outputs[0], out.inputs['Surface'])
for o in (src1, src2):
    emission_from_texture(o)
for mo, so in ((src1m, src1), (src2m, src2)):
    mo.data.materials.clear()
    for m in so.data.materials:
        mo.data.materials.append(m)
white = bpy.data.materials.new('white'); white.use_nodes = True
nt = white.node_tree; [nt.nodes.remove(n) for n in list(nt.nodes)]
em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (1, 1, 1, 1)
o_ = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], o_.inputs['Surface'])

sc.render.engine = 'CYCLES'
sc.cycles.samples = 1
sc.cycles.device = 'CPU'
bk = sc.render.bake
bk.use_selected_to_active = True
# Rays look 6 mm either side of the surface. The shell is ~8 mm thick: a longer ray falls through a hole in a
# capture and picks up the inside of the far face, which baked as dark grey-brown spots.
bk.cage_extrusion = 0.006
bk.max_ray_distance = 0.012
bk.margin = 0
bk.use_clear = True

def bake(target, source, img, mask=False):
    saved = None
    if mask:
        saved = [s.material for s in source.material_slots]
        for s in source.material_slots: s.material = white
    tm = target.data.materials[0]
    node = next(n for n in tm.node_tree.nodes if n.type == 'TEX_IMAGE' and n.name == 'bake')
    node.image = img
    tm.node_tree.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    source.select_set(True); target.select_set(True); bpy.context.view_layer.objects.active = target
    bpy.ops.object.bake(type='EMIT')
    if saved:
        for s, m in zip(source.material_slots, saved): s.material = m
    a = np.empty(TEX * TEX * 4, np.float32); img.pixels.foreach_get(a)
    return a.reshape(TEX, TEX, 4)[..., :3]

def dilate_fill(col, valid):
    """Push-pull fill: every texel no source reached (and the gutter between UV islands) takes the average
    of the nearest reached texels, found on a pyramid of half-size images."""
    w = valid.astype(np.float32)
    levels = [(col * w[..., None], w)]
    while levels[-1][1].shape[0] > 1:
        c, k = levels[-1]
        c = c.reshape(c.shape[0] // 2, 2, c.shape[1] // 2, 2, 3).sum((1, 3))
        k = k.reshape(k.shape[0] // 2, 2, k.shape[1] // 2, 2).sum((1, 3))
        levels.append((c, k))
    c, k = levels[-1]
    fill = c / np.maximum(k, 1e-6)[..., None]
    for c, k in reversed(levels[:-1]):
        up = np.repeat(np.repeat(fill, 2, 0), 2, 1)
        fill = np.where((k > 0)[..., None], c / np.maximum(k, 1e-6)[..., None], up)
    return np.where(valid[..., None], col, fill)

baked = {}
for name, ob in parts.items():
    m = bpy.data.materials.new(name + '_bake'); m.use_nodes = True
    n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.name = 'bake'
    ob.data.materials.clear(); ob.data.materials.append(m)
    img = bpy.data.images.new(name + '_tmp', TEX, TEX, alpha=False, float_buffer=True)   # linear
    layers = []
    for src in (src1, src1m, src2, src2m):
        c = bake(ob, src, img).copy()
        k = bake(ob, src, img, mask=True)[..., 0] > 0.5
        layers.append((c, k))
    # the mirrors and CHAIR_2 were lit and exposed differently: match each to CHAIR_1 where both reached
    c0, k0 = layers[0]
    for j in (1, 2, 3):
        c, k = layers[j]; both = k & k0
        if both.sum() > 1000:
            g = np.median(c0[both], 0) / np.maximum(np.median(c[both], 0), 1e-4)
            layers[j] = (c * g, k)
            print(name, 'layer', j, 'gain to CHAIR_1', g.round(3), flush=True)
    col = np.zeros((TEX, TEX, 3), np.float32); valid = np.zeros((TEX, TEX), bool)
    for c, k in layers:
        take = k & ~valid
        col[take] = c[take]; valid |= take
    print(name, 'texels from chair1', layers[0][1].mean().round(3), 'any', valid.mean().round(3), flush=True)
    for j, (c, k) in enumerate(layers):
        np.save(f'{tmp}/{name}_layer{j}.npy', c.astype(np.float16)); np.save(f'{tmp}/{name}_mask{j}.npy', k)
    baked[name] = (col, valid)

# color: one gain per channel so the shell's median matches the real chairs (SPLAT_ROOM_1); same gain for the seat
lin2s = lambda x: np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.clip(x, 0, 1), 1 / 2.4) - 0.055)
s2lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
back_srgb = lin2s(baked['back'][0][baked['back'][1]])
gain = SPLAT_SHELL / np.median(back_srgb, 0)
print('color gain (sRGB)', gain.round(3), flush=True)
for name, ob in parts.items():
    col, valid = baked[name]
    srgb = np.clip(lin2s(col) * gain, 0, 1)
    srgb = dilate_fill(srgb, valid)
    img = image_from_array(name + '_tex', srgb[::-1], f'{tmp}/chair_{name}.png')   # image_from_array flips rows
    img.file_format = 'JPEG'; img.filepath_raw = f'{tmp}/chair_{name}.jpg'; img.save()
    print(name, 'median sRGB after gain', (np.median(srgb[valid], 0) * 255).round(), flush=True)
    ob.data.materials.clear(); ob.data.materials.append(unlit_material(name, image=img))

for o in (src1, src1m, src2, src2m):
    bpy.data.objects.remove(o)

# ---------- legs + frame ----------
H = 256
grad = np.zeros((H, 1, 3))
ys = np.linspace(LEG_TOP, 0, H)   # row 0 = top
for k in range(3):
    grad[:, :, k] = np.interp(ys, [p[0] for p in LEG_RGB], [p[1][k] / 255 for p in LEG_RGB])[:, None]
# wood grain: fine streaks along the leg (+-6% brightness), lighter on the side facing the room's lights
GW = 128
rng = np.random.default_rng(7)
streak = np.convolve(rng.normal(0, 1, GW * 3), np.ones(3) / 3, 'same')[GW:2 * GW]
streak = 1 + 0.06 * streak / np.abs(streak).max()
facing = 1 + 0.05 * np.cos(np.linspace(0, 2 * np.pi, GW, endpoint=False) - np.pi / 2)
along = 1 + 0.02 * np.sin(np.linspace(0, 9 * np.pi, H))[:, None]
grad = np.repeat(grad[:, :1], GW, 1) * (streak * facing)[None, :, None] * along[..., None]
grad = np.clip(grad, 0, 1)
m_wood = unlit_material('leg_wood', image=image_from_array('leg_grad', grad, f'{tmp}/leg_grad.png'))
m_frame = unlit_material('leg_frame', color=FRAME_RGB)
m_glide = unlit_material('leg_glide', color=GLIDE_RGB)
pieces = []
tops = {}
SEG = 32
for leg, spec in (('back', LEG_BACK), ('front', LEG_FRONT)):
    for sx in (-1, 1):
        fx, fz = spec['foot'][0] * sx, spec['foot'][1]
        kx, kz = spec['slope'][0] * sx, spec['slope'][1]
        rings = np.linspace(0.004, LEG_TOP, 12)
        verts, uvs_v, faces, uvs = [], [], [], []
        for y in rings:
            r = R0 + R1 * y
            for j in range(SEG + 1):
                t = 2 * np.pi * j / SEG
                verts.append(g2b(fx + kx * y + r * np.cos(t), y, fz + kz * y + r * np.sin(t)))
                uvs_v.append((j / SEG, y / LEG_TOP))
        for i in range(len(rings) - 1):
            for j in range(SEG):
                a = i * (SEG + 1) + j; b = a + 1; c = a + SEG + 1; d = c + 1
                faces.append((a, c, d, b)); uvs += [uvs_v[a], uvs_v[c], uvs_v[d], uvs_v[b]]
        # bottom cap
        base = len(verts); verts.append(g2b(fx + kx * 0.004, 0.004, fz + kz * 0.004)); uvs_v.append((0.5, 0.0))
        for j in range(SEG):
            faces.append((base, j + 1, j)); uvs += [uvs_v[base], uvs_v[j + 1], uvs_v[j]]
        pieces.append(mesh_object(f'leg_{leg}{sx}', verts, faces, uvs=uvs, mats=[m_wood]))
        # glide: thin grey disk under the foot
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=R0 + 0.001, depth=0.004, location=g2b(fx, 0.002, fz))
        gl = bpy.context.active_object; gl.data.materials.append(m_glide); pieces.append(gl)
        y = 0.385
        tops[(leg, sx)] = (fx + kx * y, fz + kz * y)
# frame: four flat bars joining the leg tops just under the seat pan
corners = [tops[('back', -1)], tops[('back', 1)], tops[('front', 1)], tops[('front', -1)]]
for i in range(4):
    (ax, az), (bx, bz) = corners[i], corners[(i + 1) % 4]
    L = np.hypot(bx - ax, bz - az); ang = np.arctan2(bz - az, bx - ax)
    v, f = box(-L / 2, L / 2, 0.375, 0.385, -0.0125, 0.0125)
    ob = mesh_object(f'bar{i}', v, f, mats=[m_frame])
    ob.matrix_world = mathutils.Matrix.Translation(g2b((ax + bx) / 2, 0, (az + bz) / 2)) @ mathutils.Matrix.Rotation(-ang, 4, 'Z')   # glTF z = Blender -y
    pieces.append(ob)
legs = join(pieces, 'legs')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
recalc_normals(legs)

# ---------- shadow ----------
# floor under a lone chair (POLYCAM_CHAIR_2): 48% of the surrounding brightness under the seat, ~78% at 0.29 m,
# ~90% at 0.35 m and back to the floor by ~0.41 m from the center
res = 0.004
feet = [(s * LEG_BACK['foot'][0], LEG_BACK['foot'][1]) for s in (-1, 1)] + [(s * LEG_FRONT['foot'][0], LEG_FRONT['foot'][1]) for s in (-1, 1)]
a = soft_rect_alpha(int(1.0 / res), int(1.0 / res), res, 0.19, 0.19, 0.085, 0.52, spots=[(x, z, 0.012, 0.35) for x, z in feet])
shadow_plane('shadow', a, res, (0.0, 0.0), 0.002, tmp)

export(out, ['seat', 'back', 'legs', 'shadow'])
print('exported', out)
