# Blender -b --python render.py -- spec.json  (orthographic or perspective views of glTF files, unlit texture color)
# spec: {"files":[{"path":..., "pos":[x,y,z] (room/glTF frame), "rotY":rad, "scale":s, "M": 4x4 glTF-frame matrix (optional)}],
#        "views":[{"name":..., "eye":[x,y,z], "target":[x,y,z], "ortho":size or null, "fov":deg, "up":[0,1,0]}], "res":[w,h], "out":prefix, "bg":[r,g,b]}
# All coordinates in glTF/room frame (Y up). Workbench, flat texture (unlit).
import bpy, sys, json, math, mathutils
spec = json.load(open(sys.argv[sys.argv.index('--')+1]))
bpy.ops.wm.read_factory_settings(use_empty=True)
G2B = mathutils.Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))  # glTF -> Blender
def g2b(p): return mathutils.Vector((p[0], -p[2], p[1]))
for f in spec['files']:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f['path'])
    new = [o for o in bpy.data.objects if o not in before]
    if 'M' in f:
        M = mathutils.Matrix(f['M'])
    else:
        a = f.get('rotY', 0.0); s = f.get('scale', 1.0); p = f.get('pos', [0,0,0])
        M = mathutils.Matrix.Translation(p) @ mathutils.Matrix.Rotation(a, 4, 'Y') @ mathutils.Matrix.Scale(s, 4)
    Mb = G2B @ M @ G2B.inverted()
    for o in new:
        if o.parent is None: o.matrix_world = Mb @ o.matrix_world
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.light = 'FLAT'; sh.color_type = 'TEXTURE'; sh.background_type = 'VIEWPORT'
if spec.get('geom'):
    sh.light = 'STUDIO'; sh.color_type = 'SINGLE'; sh.single_color = (0.8, 0.8, 0.8); sh.show_cavity = False
sh.background_color = tuple(spec.get('bg', [0.08, 0.08, 0.1]))
sc.render.film_transparent = False
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x, sc.render.resolution_y = spec.get('res', [900, 900])
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam); sc.camera = cam
cam.data.clip_start = 0.01; cam.data.clip_end = 100
for v in spec['views']:
    e, t = g2b(v['eye']), g2b(v['target'])
    up = g2b(v.get('up', [0,1,0]))
    fwd = (t - e).normalized(); right = fwd.cross(up).normalized(); u2 = right.cross(fwd)
    R = mathutils.Matrix((right, u2, -fwd)).transposed()
    cam.matrix_world = mathutils.Matrix.Translation(e) @ R.to_4x4()
    if v.get('ortho'):
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = v['ortho']
    else:
        cam.data.type = 'PERSP'; cam.data.angle = math.radians(v.get('fov', 50))
    if 'clip' in v: cam.data.clip_start, cam.data.clip_end = v['clip']
    sc.render.filepath = f"{spec['out']}_{v['name']}.png"
    bpy.ops.render.render(write_still=True)
