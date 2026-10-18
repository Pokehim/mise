# Shared helpers for the lounge-v2 Master Copy scripts (run inside Blender 4.5, headless).
# Blender is Z-up; the glTF exporter writes +Y up, so glTF (x, y, z) = Blender (x, -z... ) i.e.
# Blender (x, y, z) -> glTF (x, z, -y). "Front is +Z" in the file means Blender -Y.
import bpy
import numpy as np


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def g2b(x, y, z):
    """glTF/room-style coordinates (Y up, front +Z) -> Blender coordinates."""
    return (x, -z, y)


def image_from_array(name, arr, path):
    """arr: HxWx3 or HxWx4 float in 0..1, row 0 = top of the image. Saved as PNG and loaded."""
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1))], 2)
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def unlit_material(name, color=None, image=None, alpha=False):
    """Unlit (KHR_materials_unlit) material from a flat sRGB color (0..255) or an image."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    if image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.interpolation = 'Linear'
        col = tex.outputs['Color']
    else:
        rgb = nt.nodes.new('ShaderNodeRGB')
        lin = [((c / 255) / 12.92 if c / 255 <= 0.04045 else (((c / 255) + 0.055) / 1.055) ** 2.4) for c in color]
        rgb.outputs[0].default_value = (*lin, 1.0)
        col = rgb.outputs[0]
    if alpha:
        mix = nt.nodes.new('ShaderNodeMixShader')
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        nt.links.new(tex.outputs['Alpha'], mix.inputs[0])
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(col, mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs['Surface'])
        m.surface_render_method = 'BLENDED'
    else:
        nt.links.new(col, out.inputs['Surface'])
    return m


def mesh_object(name, verts, faces, uvs=None, mats=None, face_mats=None):
    """verts in Blender coordinates; faces as index lists; uvs per face-corner list (optional)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [list(f) for f in faces])
    me.update()
    if uvs is not None:
        uv = me.uv_layers.new(name='UVMap')
        for i, loop in enumerate(me.loops):
            uv.data[i].uv = uvs[i]
    if mats:
        for m in mats:
            me.materials.append(m)
        if face_mats is not None:
            for p, k in zip(me.polygons, face_mats):
                p.material_index = k
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def box(x0, x1, y0, y1, z0, z1):
    """Axis-aligned box in glTF coords (Y up). Returns Blender verts and 6 quad faces
    ordered: top, bottom, +x, -x, +z(front), -z(back)."""
    c = [g2b(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    # index = xi*4 + yi*2 + zi
    f = [
        (2, 3, 7, 6),   # top    (y1)
        (0, 4, 5, 1),   # bottom (y0)
        (4, 6, 7, 5),   # +x
        (0, 1, 3, 2),   # -x
        (1, 5, 7, 3),   # +z
        (0, 2, 6, 4),   # -z
    ]
    return c, f


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def recalc_normals(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def soft_rect_alpha(w, h, res, rect_hw, rect_hh, sigma, peak, spots=()):
    """Alpha image (h x w px, res m/px, centered) of a blurred rectangle (half sizes rect_hw, rect_hh)
    scaled to `peak`, plus Gaussian spots [(x, z, sigma, peak)] in meters (x right, z down)."""
    xs = (np.arange(w) - w / 2 + 0.5) * res
    zs = (np.arange(h) - h / 2 + 0.5) * res
    from math import erf, sqrt
    verf = np.vectorize(erf)
    fx = 0.5 * (verf((xs + rect_hw) / (sqrt(2) * sigma)) - verf((xs - rect_hw) / (sqrt(2) * sigma)))
    fz = 0.5 * (verf((zs + rect_hh) / (sqrt(2) * sigma)) - verf((zs - rect_hh) / (sqrt(2) * sigma)))
    a = np.outer(fz, fx)
    a = a / a.max() * peak
    X, Z = np.meshgrid(xs, zs)
    for (sx, sz, ss, sp) in spots:
        a = 1 - (1 - a) * (1 - sp * np.exp(-((X - sx) ** 2 + (Z - sz) ** 2) / (2 * ss * ss)))
    return a


def shadow_plane(name, alpha, res, center_xz, y, tmpdir, vertical_wall=None):
    """Floor shadow (black, alpha) as a quad. alpha: HxW (row 0 = -z side). Returns the object."""
    h, w = alpha.shape
    rgba = np.zeros((h, w, 4))
    rgba[..., 3] = np.clip(alpha, 0, 1)
    img = image_from_array(name + '_img', rgba, f'{tmpdir}/{name}.png')
    mat = unlit_material(name + '_mat', image=img, alpha=True)
    hw, hh = w * res / 2, h * res / 2
    cx, cz = center_xz
    if vertical_wall is None:
        verts = [g2b(cx - hw, y, cz - hh), g2b(cx + hw, y, cz - hh), g2b(cx + hw, y, cz + hh), g2b(cx - hw, y, cz + hh)]
        uvs = [(0, 1), (1, 1), (1, 0), (0, 0)]
        faces = [(0, 3, 2, 1)]
        uvs = [uvs[0], uvs[3], uvs[2], uvs[1]]
    else:
        # vertical plane at z = vertical_wall, spanning x and y (alpha rows = y from top)
        zc, ybot = vertical_wall
        verts = [g2b(cx - hw, ybot + 2 * hh, zc), g2b(cx + hw, ybot + 2 * hh, zc), g2b(cx + hw, ybot, zc), g2b(cx - hw, ybot, zc)]
        faces = [(3, 2, 1, 0)]
        uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
    ob = mesh_object(name, verts, faces, uvs=uvs, mats=[mat])
    return ob


def export(path, names):
    bpy.ops.object.select_all(action='DESELECT')
    for n in names:
        bpy.data.objects[n].select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_image_format='AUTO', export_materials='EXPORT')
