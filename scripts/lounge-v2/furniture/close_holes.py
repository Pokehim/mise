# Close the holes left in the chair shell (where no capture had surface: the seat/back junction, the underside),
# so nothing behind shows through them as dark spots. Fills each hole, then relaxes the new patch into its rim.
# usage: python close_holes.py <shell.ply> <out.ply>
import sys
import pymeshlab

ms = pymeshlab.MeshSet()
ms.load_new_mesh(sys.argv[1])
before = ms.get_topological_measures()['boundary_edges']
ms.meshing_repair_non_manifold_edges()
ms.meshing_close_holes(maxholesize=1000, selected=False, newfaceselected=True, selfintersection=False)
ms.meshing_surface_subdivision_midpoint(iterations=2, threshold=pymeshlab.PercentageValue(0.6), selected=True)
ms.compute_selection_by_condition_per_face(condselect='(fq >= 0)')   # keep the whole mesh for the next step
ms.set_selection_none()
ms.apply_coord_taubin_smoothing(lambda_=0.5, mu=-0.53, stepsmoothnum=10)
after = ms.get_topological_measures()['boundary_edges']
ms.save_current_mesh(sys.argv[2])
print('boundary edges', before, '->', after, 'faces', ms.current_mesh().face_number())
