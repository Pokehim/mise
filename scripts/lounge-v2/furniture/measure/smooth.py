import os
import pymeshlab, sys
ms = pymeshlab.MeshSet(); ms.load_new_mesh(sys.argv[1])
ms.meshing_remove_connected_component_by_face_number(mincomponentsize=5000)
ms.meshing_decimation_quadric_edge_collapse(targetfacenum=400000, preservenormal=True, preservetopology=True, qualitythr=0.5)
ms.apply_coord_two_steps_smoothing(stepsmoothnum=int(sys.argv[3]), normalthr=60, stepnormalnum=20, stepfitnum=20)
ms.apply_coord_taubin_smoothing(lambda_=0.5, mu=-0.53, stepsmoothnum=int(sys.argv[4]))
ms.meshing_decimation_quadric_edge_collapse(targetfacenum=int(sys.argv[5]), preservenormal=True, preservetopology=True, qualitythr=0.5)
m = ms.current_mesh(); print('faces', m.face_number())
ms.save_current_mesh(sys.argv[2])
