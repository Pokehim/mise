"""Unlit orthographic views of one source, one per room surface, clipped to a thin slab at the surface (#77).

Run inside Blender:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P ortho.py -- <source> <out_dir> [mm_per_px] [views]

<source> is a key of align.json's `sources` (a mesh). Each view is a PNG whose alpha is 0 where the source has
nothing in the slab. Pixel (0, 0) is the surface's `origin` corner in VIEWS; +u runs right and +v down.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
X0, X1, Z0, Z1, H = -1.568, 1.55, -3.545, 3.673, 2.431

# Each view, as seen from inside the room: the top-left corner, the right (u) and down (v) directions and
# their lengths, and the direction into the room (the camera sits on that side, looking back at the surface).
VIEWS = {
    'north': dict(origin=(X0, H, Z0), u=(1, 0, 0), v=(0, -1, 0), w=X1 - X0, h=H, inward=(0, 0, 1)),
    'east': dict(origin=(X1, H, Z0), u=(0, 0, 1), v=(0, -1, 0), w=Z1 - Z0, h=H, inward=(-1, 0, 0)),
    'south': dict(origin=(X1, H, Z1), u=(-1, 0, 0), v=(0, -1, 0), w=X1 - X0, h=H, inward=(0, 0, -1)),
    'west': dict(origin=(X0, H, Z1), u=(0, 0, -1), v=(0, -1, 0), w=Z1 - Z0, h=H, inward=(1, 0, 0)),
    'floor': dict(origin=(X0, 0, Z0), u=(1, 0, 0), v=(0, 0, 1), w=X1 - X0, h=Z1 - Z0, inward=(0, 1, 0)),
    'ceiling': dict(origin=(X0, H, Z1), u=(1, 0, 0), v=(0, 0, -1), w=X1 - X0, h=Z1 - Z0, inward=(0, -1, 0)),
}
IN, OUT = 0.06, float(os.environ.get('ORTHO_OUT', 0.10))   # the slab: this far in front of the surface, and behind it
# (ORTHO_OUT=4 sees through the glass, to the hallway beyond it)
CAM = 1.0              # the camera's distance in front of the surface


def room_matrix(source):
    path = os.path.join(ROOT, 'data', 'scans', 'lounge-v2', 'align.json')
    if os.environ.get('ORTHO_OWN_FRAME'):  # the source in its own frame (align.py reads the chairs' floor grain this way)
        m = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    elif os.path.exists(path):
        with open(path) as f:
            m = json.load(f)['sources'][source]['matrix']
    else:  # before align.py has run: the Main Capture through lounge-v1's meshTransform
        assert source == 'POLYCAM_ROOM_GLB_1.glb'
        with open(os.path.join(ROOT, 'data', 'scans', 'lounge-v1', 'manifest.json')) as f:
            mt = json.load(f)['meshTransform']
        c, s = math.cos(mt['rotationY']), math.sin(mt['rotationY'])
        m = [[c, 0, s, mt['position'][0]], [0, 1, 0, mt['position'][1]], [-s, 0, c, mt['position'][2]], [0, 0, 0, 1]]
    # align.json is in the app's frame (+Y up); Blender's importers turn glTF/OBJ +Y up into +Z up.
    yup_to_zup = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    return yup_to_zup @ Matrix(m) @ yup_to_zup.inverted()


def zup(v):
    x, y, z = v
    return Vector((x, -z, y))


def load(source):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = os.path.join(ROOT, 'data', 'scans', 'real-scans', source)
    before = set(bpy.data.objects)
    if path.endswith('.obj'):
        bpy.ops.wm.obj_import(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    M = room_matrix(source)
    for o in set(bpy.data.objects) - before:
        if o.parent is None:
            o.matrix_world = M @ o.matrix_world
    for mat in bpy.data.materials:
        unlit(mat)


def unlit(mat):
    """The material's base color image, shown as-is."""
    if not mat.use_nodes:
        return
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    if not bsdf or not out:
        return
    emit = nt.nodes.new('ShaderNodeEmission')
    base = bsdf.inputs['Base Color']
    if base.is_linked:
        nt.links.new(base.links[0].from_socket, emit.inputs['Color'])
    else:
        emit.inputs['Color'].default_value = base.default_value
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    mat.blend_method = 'OPAQUE' if hasattr(mat, 'blend_method') else None


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.eevee.taa_render_samples = 16
    sc.render.film_transparent = True
    sc.render.filter_size = 0.75
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.resolution_percentage = 100
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0, 0, 0)


def render(name, out_dir, mm):
    v = VIEWS[name]
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new(name)
    cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new(name, cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    o, u, dv, n = (Vector(v[k]) for k in ('origin', 'u', 'v', 'inward'))
    center = o + u * (v['w'] / 2) + dv * (v['h'] / 2)
    pos = center + n * CAM
    # Camera axes in the app's frame: +X right (u), +Y up (-v), looking along -Z (= -inward, so +Z = inward).
    R = Matrix((zup(u), zup(-dv), zup(n))).transposed()
    cam.matrix_world = Matrix.Translation(zup(pos)) @ R.to_4x4()
    cam_data.clip_start = CAM - IN
    cam_data.clip_end = CAM + OUT
    rx, ry = round(v['w'] * 1000 / mm), round(v['h'] * 1000 / mm)
    sc.render.resolution_x, sc.render.resolution_y = rx, ry
    cam_data.ortho_scale = max(v['w'], v['h'])
    cam_data.sensor_fit = 'HORIZONTAL' if v['w'] >= v['h'] else 'VERTICAL'
    sc.render.filepath = os.path.join(out_dir, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath, rx, ry, flush=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    source, out_dir = argv[0], argv[1]
    mm = float(argv[2]) if len(argv) > 2 else 5
    views = argv[3].split(',') if len(argv) > 3 else list(VIEWS)
    os.makedirs(out_dir, exist_ok=True)
    load(source)
    setup_render()
    for name in views:
        render(name, out_dir, mm)


main()
