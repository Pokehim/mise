# models/table.glb: the lounge table, rebuilt from measurements (see README.md for where each number comes from).
# usage: Blender -b --python table.py -- <table_top.png> <out.glb> <tmpdir>
# Frame: meters, +Y up, front +Z (a long side). Origin: center of the top's footprint, on the floor.
# The real tables stand with their legs to the East and their other end against the West wall (no legs there). The
# Master Copy has legs at both ends, mirrored, so a table the Mover moves away from the wall still stands.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from bl_util import reset, g2b, box, mesh_object, unlit_material, join, recalc_normals, soft_rect_alpha, shadow_plane, export

top_png, out, tmp = sys.argv[sys.argv.index('--') + 1:][:3]

L, D = 1.515, 0.750       # top size
H, T = 0.705, 0.025       # top surface height, top thickness
LEG_X = L / 2 - 0.019     # leg centers: 19 mm in from each end (outer face flush with it)
LEG_Z = 0.350             # leg centers at z = ±0.35 (0.700 apart)
LEG_W, LEG_D = 0.038, 0.032
CASTER = 0.075            # caster height (floor to leg bottom)
TOP_RGB = (225, 206, 187)
LEG_RGB = (84, 67, 57)
CASTER_RGB = (42, 40, 39)

reset()
top_img = bpy.data.images.load(top_png)
m_top = unlit_material('table_top', image=top_img)
m_edge = unlit_material('table_edge', color=[round(c * 0.86) for c in TOP_RGB])
m_under = unlit_material('table_under', color=[round(c * 0.50) for c in TOP_RGB])
m_leg = unlit_material('table_leg', color=LEG_RGB)
m_caster = unlit_material('table_caster', color=CASTER_RGB)

# top: one box; the upper face carries the tabletop image (u along +x, v along -z)
v, f = box(-L / 2, L / 2, H - T, H, -D / 2, D / 2)
uv_of = lambda i: ((v[i][0] + L / 2) / L, (v[i][1] + D / 2) / D)   # Blender y = -z
uvs = []
for face in f:
    uvs += [uv_of(i) for i in face]
top = mesh_object('top', v, f, uvs=uvs, mats=[m_top, m_edge, m_under], face_mats=[0, 2, 1, 1, 1, 1])
recalc_normals(top)
bev = top.modifiers.new('bevel', 'BEVEL'); bev.width = 0.003; bev.segments = 2; bev.limit_method = 'ANGLE'

parts = []
for ex in (-1, 1):            # each end: the real tables' East end, and its mirror
    for sz in (-1, 1):
        x, z = ex * LEG_X, sz * LEG_Z
        v, f = box(x - LEG_W / 2, x + LEG_W / 2, CASTER, H - T, z - LEG_D / 2, z + LEG_D / 2)
        parts.append(mesh_object(f'leg{ex}{sz}', v, f, mats=[m_leg]))
        # caster: plate, fork, wheel
        v, f = box(x - 0.019, x + 0.019, CASTER - 0.006, CASTER, z - 0.019, z + 0.019)
        parts.append(mesh_object(f'plate{ex}{sz}', v, f, mats=[m_caster]))
        for sx in (-1, 1):
            v, f = box(x + sx * 0.013 - 0.002, x + sx * 0.013 + 0.002, 0.024, CASTER - 0.006, z - 0.014, z + 0.014)
            parts.append(mesh_object(f'fork{ex}{sz}{sx}', v, f, mats=[m_caster]))
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.025, depth=0.020, location=g2b(x, 0.025, z), rotation=(0, np.pi / 2, 0))
        wheel = bpy.context.active_object; wheel.name = f'wheel{ex}{sz}'; wheel.data.materials.append(m_caster)
        parts.append(wheel)
    # rail under the top between the end's two legs
    v, f = box(ex * LEG_X - 0.0125, ex * LEG_X + 0.0125, H - T - 0.040, H - T, -LEG_Z, LEG_Z)
    parts.append(mesh_object(f'rail{ex}', v, f, mats=[m_leg]))
legs = join(parts, 'legs')
recalc_normals(legs)

# shadow: soft rectangle under the top (floor at 58-73% of open-floor brightness where no chair overlaps),
# darker contact spots under the four casters
res = 0.005
a = soft_rect_alpha(int((L + 0.5) / res), int((D + 0.5) / res), res, L / 2 - 0.05, D / 2 - 0.05, 0.10, 0.32,
                    spots=[(ex * LEG_X, sz * LEG_Z, 0.018, 0.55) for ex in (-1, 1) for sz in (-1, 1)])
shadow_plane('shadow', a, res, (0.0, 0.0), 0.002, tmp)

export(out, ['top', 'legs', 'shadow'])
print('exported', out)
