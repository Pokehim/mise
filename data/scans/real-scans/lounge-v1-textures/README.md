# lounge-v1 textures

Flat, straight-on photos of the real study lounge's surfaces, for the `synthetic-study` mock room
(`scripts/synthetic-room.ts`). Each was rendered from `lounge-v1/room.glb` in the room frame, 200 px
per meter, keeping the triangles in a thin band around the surface's plane.

| File | What | Notes |
|---|---|---|
| `wall_e.png` | East wall, 7.218 × 2.431 m, left = North end | As rendered (outlets, scuffs, paint), but with the real whiteboard (0–6.2 m along, 0.70–2.30 m up, with its glare and tray shadow) painted over in the wall's paint, so moving the mock board leaves bare wall |
| `wall_n.png`, `wall_s.png`, `wall_w.png` | The other walls, left = each wall's start | The real paint color and baseboard from `wall_e.png`, with fine grain. Their scans were mostly holes and glass reflections. `wall_n.png` keeps the real window region. |
| `floor.png` | Floor, 3.118 × 7.218 m, up = North | The clean carpet east of the tables (1.0 × 3.0 m) mirror-tiled, so no furniture is printed on it |
| `ceiling.png` | Ceiling, up = South | As rendered, with the real light fixtures |
| `whiteboard.png` | The real board (0–6.06 m along the East wall, 0.85–2.02 m up) | Stretched to the mock board's 7.118 m |
| `door.png` | The door slab, 0.08–0.93 m along the South wall from its South-East corner, 0–2.10 m up | |
| `window.png` | Not used now (the mock's glass is tinted). The North window's glass: the view out, sky, a tree and the brick building opposite | Cropped from the app's Quick view of `lounge-v1`, looking at the window head-on: straight-on renders of the mesh there only show the glass's reflections |
| `table_top.png` | Table 2's top from above, its inner 1.3 × 0.85 m, up = North | The edges are left out: they picked up the chairs |

The South-West corner's floor-to-ceiling glass didn't scan, so it keeps a solid color.
