# For each chair Part's texture, bake where every texel sits on the chair: its position and its normal (Cycles,
# emission of the Geometry node; position + 1 and (normal + 1) / 2 so nothing is negative). chair_composite.py uses
# them to clean the textures in 3D, where neighbouring texels really are neighbours.
# usage: Blender -b --python chair_texel_geometry.py -- <parts dir> <out dir>   -> <part>_pos.npy, <part>_nrm.npy
import sys
import bpy
import numpy as np

parts_dir, out = sys.argv[sys.argv.index('--') + 1:][:2]
TEX = 4096
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.samples = 1; sc.cycles.device = 'CPU'
sc.render.bake.use_selected_to_active = False; sc.render.bake.margin = 0; sc.render.bake.use_clear = True
for name in ('back', 'seat'):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{parts_dir}/{name}.glb')
    ob = [o for o in bpy.data.objects if o not in before and o.type == 'MESH'][0]
    ob.parent = None
    for o in [o for o in bpy.data.objects if o.type == 'EMPTY']:
        bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for what in ('pos', 'nrm'):
        m = bpy.data.materials.new(f'{name}_{what}'); m.use_nodes = True; nt = m.node_tree
        for n in list(nt.nodes): nt.nodes.remove(n)
        geo = nt.nodes.new('ShaderNodeNewGeometry'); vm = nt.nodes.new('ShaderNodeVectorMath')
        if what == 'pos':
            vm.operation = 'ADD'; vm.inputs[1].default_value = (1, 1, 1); nt.links.new(geo.outputs['Position'], vm.inputs[0])
        else:
            vm.operation = 'MULTIPLY_ADD'; vm.inputs[1].default_value = (0.5, 0.5, 0.5); vm.inputs[2].default_value = (0.5, 0.5, 0.5)
            nt.links.new(geo.outputs['Normal'], vm.inputs[0])
        em = nt.nodes.new('ShaderNodeEmission'); o = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(vm.outputs[0], em.inputs['Color']); nt.links.new(em.outputs[0], o.inputs['Surface'])
        img = bpy.data.images.new(f'{name}_{what}', TEX, TEX, alpha=False, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; nt.nodes.active = t
        ob.data.materials.clear(); ob.data.materials.append(m)
        bpy.ops.object.bake(type='EMIT')
        a = np.empty(TEX * TEX * 4, np.float32); img.pixels.foreach_get(a)
        a = a.reshape(TEX, TEX, 4)[..., :3]
        a = a - 1 if what == 'pos' else a * 2 - 1
        # Blender coordinates -> glTF (x, z, -y): the chair's frame
        a = np.stack([a[..., 0], a[..., 2], -a[..., 1]], -1)
        np.save(f'{out}/{name}_{what}.npy', a.astype(np.float32))
        print(name, what, 'range', a.reshape(-1, 3).min(0).round(3), a.reshape(-1, 3).max(0).round(3), flush=True)
    bpy.data.objects.remove(ob)
