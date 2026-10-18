# Split the rebuilt chair shell into the "seat" and "back" Parts with a clean straight cut at y = 0.50 m,
# and give each Part a UV atlas (xatlas) for baking. Output: <outdir>/seat.glb, <outdir>/back.glb.
# usage: python chair_parts.py <shell.ply> <outdir>
import sys
import numpy as np
import trimesh, xatlas

shell, outdir = sys.argv[1], sys.argv[2]
SPLIT_Y = 0.50
m = trimesh.load(shell, process=False)
for name, normal in (('back', [0, 1, 0]), ('seat', [0, -1, 0])):
    part = trimesh.intersections.slice_mesh_plane(m, plane_normal=normal, plane_origin=[0, SPLIT_Y, 0], cap=False)
    part.remove_unreferenced_vertices()
    vmap, faces, uvs = xatlas.parametrize(part.vertices, part.faces)
    out = trimesh.Trimesh(part.vertices[vmap], faces, process=False)
    out.visual = trimesh.visual.TextureVisuals(uv=uvs)
    out.export(f'{outdir}/{name}.glb')
    print(name, len(out.faces), 'faces, y', out.bounds[:, 1].round(3))
