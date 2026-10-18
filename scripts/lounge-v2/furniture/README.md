# lounge-v2 furniture (part B, #78)

Master Copies of the study lounge's chair, table, and whiteboard, and the 16 Originals placed from them.
Everything here is hard-coded for this room (spec §1).

Outputs, in `data/scans/lounge/`:

- `models/chair.glb`: nodes `seat`, `back`, `legs`, `shadow`
- `models/table.glb`: nodes `top`, `legs`, `shadow`
- `models/whiteboard.glb`: nodes `board`, `frame`, `shadow`
- `setup.json` → `originals`

Every file is in meters, +Y up, front +Z, with its origin at the center of its footprint on the floor. Materials
are unlit (`KHR_materials_unlit`): the images carry the real light. Each `shadow` is a black quad with an alpha
image (`alphaMode: BLEND`) on the floor, or on the wall for the whiteboard.

## Tools

- Blender 4.5, headless: `/Applications/Blender.app/Contents/MacOS/Blender -b --python <script> -- <args>`
- Python 3.11 with `numpy scipy trimesh pillow pymeshlab xatlas shapely open3d` (pymeshlab and xatlas need 3.11).
  The measurement scripts in `measure/` read and write a work folder named by `WORK`, and find the repo by `REPO`.

## Order

1. `measure/splat_load.py ROOM_1 $WORK/cache`: SPLAT_ROOM_1 in the room frame (comparison fit).
2. `measure/canon.py`: each chair Detail Capture levelled on its floor, centered on its 4 feet, back to −Z, and
   turned onto its symmetry plane (median mirror distance 2.0 mm for CHAIR_1, 3.5 mm for CHAIR_2).
3. `crop_chair.py` (Blender): each chair cut out and scaled to meters (see **Chair size**).
4. `measure/icp12.py`: CHAIR_1 onto CHAIR_2, with free scale (1.0007; median 3.9 mm).
5. `measure/legs.py`: a tapered cone fitted to each leg of each capture.
6. `measure/chair_shell.py` then `measure/smooth.py`: the seat and back shell, screened Poisson (depth 9)
   from CHAIR_1 made symmetric (its left half, holes filled from its mirrored right half, then from CHAIR_2),
   trimmed to within 6 mm of the data, then two-step and Taubin smoothing.
7. `close_holes.py`: every hole in the shell closed (the seat/back junction and the underside had some), so
   nothing dark shows through. Then `fix_underside.py`: everything under the cushion's lower rim (leg stubs, the
   bracket's torn pieces, a hanging hole patch) is cut away and rebuilt as a smooth surface that follows CHAIR_1's
   own underside, measured as a height field (0.395-0.45 m). The flat hole patch in the middle of the pan's rear
   wall (2-3 mm inside the curve) is laid on a smooth symmetric surface fitted to the wall around it, and the lower
   walls are Taubin-smoothed so no seam shows where the new underside meets the old shell (median shift 0.3 mm).
8. `chair_parts.py`: the shell cut at y = 0.50 m into `seat` and `back`, UV-unwrapped with xatlas.
9. `chair.py` (Blender): bakes 4 texture layers, CHAIR_1, its mirror, CHAIR_2, and its mirror (Cycles, emission,
   selected-to-active). Rays look only 6 mm either side of the surface: the shell is about 8 mm thick, and longer
   rays fell through holes in a capture and baked the inside of the far face as dark spots. It also rebuilds the
   legs straight, adds the frame under the seat and the shadow, and exports.
10. `chair_texel_geometry.py` (Blender), then `chair_composite.py`: the final seat and back textures, in 3D. The
    white shell shows CHAIR_1's own texture wherever it is clean; its holes and grey spots take another capture,
    matched to CHAIR_1's light there. The green cushion keeps its printed grid, with brown or dark blotches refilled
    from a capture that is clean there. `swap_textures.py` puts them in the file.
11. `measure/tpose.py`, `measure/tpeaks.py`, `measure/tthick.py`, `measure/tcolor.py`: the table, from the splat.
12. `table_top_image.py`, then `table.py` (Blender).
13. `render.py` (Blender) with the East wall view of GLB_1 and of GLB_3, `whiteboard_image.py` (GLB_1's image, with
    the North end's top from GLB_3 and its smeared bottom corner refilled), then `whiteboard.py` (Blender).
14. `recenter_glb.py` on each file, so its origin is the center of its footprint (`--wall` for the whiteboard: its origin
    on its bottom edge, so its Original's box runs 0.845-2.330 m, not from the floor).
15. `fit_originals.py`: the 16 Originals; `check_chair.py`: the chair's Done-when numbers.

## Measurements

### Chair size

The Detail Captures are not to scale (spec §2): the same chair is 0.729 tall in CHAIR_2 and 0.591 in CHAIR_1.
CHAIR_2 is scaled by **1.170** (CHAIR_1 by 1.452, from the CHAIR_1→CHAIR_2 fit), set from the room:

| Evidence (SPLAT_ROOM_1, in the room frame) | Scale for CHAIR_2 |
|---|---|
| Free-scale fit of CHAIR_2 into the 7 best-fitting room chairs | 1.158 (sd 0.009) |
| Chairs' back tops (99th percentile, 12 chairs) / CHAIR_2's | 1.170 |
| North window sill length in the splat / in CHAIR_2's wall scrap | 1.183 |
| Sill top height | 1.160 |

With 1.170 the Master Copy's seat and back heights land within 4 mm of the room's chairs in both splats
(`check_chair.py`), so it was kept.

### Table (`measure/tpose.py`, `tpeaks.py`, `tthick.py`)

- Two metal legs, both at the East end; the West end rests against the West wall. No legs there in any Capture.
- Legs 0.701 / 0.699 / 0.702 m apart (centers), 38 x 32 mm, dark (sRGB 84, 67, 57), casters in the bottom 75 mm.
- Top 1.515 x 0.750 m: depth from the top's edge faces, which show as density peaks in the splat in each
  table's own frame (0.752 / 0.747 / 0.750 m). Length from the East edge (1.0-2.3 cm past the leg line) to the
  West edge (1.496-1.526 m; weak, against the wall).
- Top surface 0.705 m (GLB_1's top layer, 0.704-0.705; the splat's 0.69-0.70). Top 25 mm thick.
- Each table is turned about 1.2° from the room's axes (+1.23°, -1.30°, -1.24°).

### Whiteboard

6.087 m from the North corner (z = -3.565) to z = 2.522, 0.845 to 2.330 m high including the tray; the board's
face 12 mm off the wall, the tray 33 mm. Ends and heights from 1 mm/px orthographic renders of GLB_1. GLB_1's East
wall leans (x = 1.586 at 0.5 m, 1.52 near the ceiling), so the board is kept vertical, its back on setup.json's
East wall (x = 1.5759, the Empty Room's since #92; GLB_1 has the wall at 1.55 at the board's mid-height), so it never
floats off the wall the room draws.

### Shadows

- Chair: under a lone chair (CHAIR_2's floor) the floor is at 48% of its brightness under the seat, 78% at
  0.29 m from the center, 90% at 0.35 m. The shadow is a soft square, alpha 0.52 at the center, plus contact
  spots under the feet.
- Table: away from the chairs, the floor under the tables is at 58-73% of the open floor's brightness
  (GLB_1). Alpha 0.32, plus the casters' contact spots.
- Whiteboard: a soft band under the tray (alpha 0.35, 2.5 cm) and a thin halo around the edges, on the wall.

## Results

`fit_report.txt` (from `fit_originals.py`) and `originals.json`, which is what goes into setup.json's `originals`.
