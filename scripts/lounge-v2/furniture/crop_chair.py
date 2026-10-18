# blender -b --python crop_chair.py -- scan.glb T(json 4x4, glTF frame) scale out.glb hx z0 z1
# Places the scan in canonical chair frame (scaled to meters), deletes everything outside the chair box, exports GLB.
import bpy, bmesh, sys, json, mathutils
a = sys.argv[sys.argv.index('--')+1:]
src, T, s, out = a[0], json.loads(a[1]), float(a[2]), a[3]
hx, z0, z1 = float(a[4]), float(a[5]), float(a[6])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
o = [x for x in bpy.data.objects if x.type == 'MESH'][0]
G2B = mathutils.Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
M = mathutils.Matrix.Scale(s, 4) @ mathutils.Matrix(T)
o.matrix_world = G2B @ M @ G2B.inverted() @ o.matrix_world
bpy.context.view_layer.objects.active = o; o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bm = bmesh.new(); bm.from_mesh(o.data)
# Blender coords: x = x, y = -z(glTF), z = y(glTF)
kill = [v for v in bm.verts if not (abs(v.co.x) < hx and z0 < -v.co.y < z1 and v.co.z > 0.004 and v.co.z < 1.0)]
bmesh.ops.delete(bm, geom=kill, context='VERTS')
# keep connected pieces with >= 200 faces
bm.faces.ensure_lookup_table()
seen = set(); keep = set()
for f in bm.faces:
    if f.index in seen: continue
    comp = []; stack = [f]; seen.add(f.index)
    while stack:
        g = stack.pop(); comp.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h.index not in seen: seen.add(h.index); stack.append(h)
    if len(comp) >= 200: keep.update(c.index for c in comp)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(o.data); bm.free()
print('faces', len(o.data.polygons))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_yup=True)
