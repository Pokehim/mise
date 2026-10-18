# lounge-v2: a photoreal copy of the study lounge

**Decided in:** the grilling session of 17 Oct 2026.
**Records:** ADR-0009. Glossary terms: Empty Room, Master Copy, Detail Capture.
**Comparison data:** `docs/research/lounge-compare/`.
**Issues:** one per part, A (room), B (furniture), and C (editor). Each runs in its own Superset workspace.

## 1. Goal and scope

Build `lounge-v2`: a copy of this one study lounge that looks real from every view:

- standing at eye level
- seated at a table
- close-ups of the tables and the chair legs
- the Dollhouse view
- top-down

Two versions of the room must both look real and true to reality:

- **the furnished room:** every chair, table, and the whiteboard where they really are
- **the Empty Room:** every Original taken out

**Scope:**

- **Only this room, only these files.** Scripts may hard-code this room's numbers, file names, and hand-picked choices. Nothing has to work on another Scan.
- **Only the demo Mac.** Tune for the M3 Pro in Chrome. Size limits don't apply, and the only performance bar is 60 fps there.
- **lounge-v1 stays.** It is the fallback until you sign off on lounge-v2. Then the hero Design moves to lounge-v2.

## 2. Sources

All sources are in `data/scans/real-scans/`, and all were captured with the furniture in the same place.

| File | What it is | Use |
|---|---|---|
| `POLYCAM_ROOM_GLB_1.glb` | Main Capture: 268k triangles, sharpest walls, readable whiteboard | Empty Room base, and the room frame (through lounge-v1's `meshTransform`) |
| `POLYCAM_ROOM_GLB_2.glb`, `_3.glb` | Room meshes | Empty Room base, wherever they're sharper or fill a hole |
| `KIRI_ENGINE_CHAIR_1/model.obj` | KIRI's whole-room LiDAR scene (despite its name) | Empty Room base, especially the floor (98% covered) |
| `SPLAT_ROOM_1.ply` | Polycam splat, 1.6M splats | Empty Room surface layer; the better splat |
| `SPLAT_ROOM_2.ply` | Polycam splat, 642k splats | Surface layer, only where it beats ROOM_1 |
| `POLYCAM_CHAIR_1.glb`, `_2.glb` | Detail Captures: each is one chair up close, plus scraps of floor and wall | The chair's Master Copy. Also the sharpest floor sample. |
| `KIRI_ENGINE_ROOM_1/room.usdz` | KIRI Layout: 4 walls, 2 windows, 2 doors, 3 tables, 12 chairs as boxes | Starting boxes for every Original, and the Openings |
| `KIRI_ENGINE_ROOM_2/room.usdz` | The same Layout, turned 90°, one window missing | Cross-check only |
| `POLYCAM_ROOM_PLY_*.ply`, `POLYCAM_ROOM_SPLAT_*.ply` | Point clouds, and stand-in "splats" made from them | Not used |

**The room frame** is lounge-v1's:

- floor at y = 0, walls on the axes
- room interior about x = ±1.58 and z = ±3.62
- ceiling at 2.431 m
- `POLYCAM_ROOM_GLB_1` reaches this frame through `data/scans/lounge-v1/manifest.json` → `meshTransform`

**Splat alignment:**

- `docs/research/lounge-compare/align-ROOM_*.json` has both splats already fitted, with a median error of about 2 cm.
- Both splats are stored **upside down** (Y down) and are **not in meters**: their scales are 1.577 and 1.451.
- The fit's `full.R` and `full.t` include the leftover tilt of 0.71° and 0.49°. Bake the tilt in too, because the app can only turn a splat about Y.

## 3. What's in lounge-v2

### The Empty Room (part A)

**Base layer:** a hole-free mesh, `empty-room.glb`.

- **Shape:**
  - Flat floor, walls, and ceiling at the room's measured size.
  - The door frames, the doors, the baseboard, and the window and glass-wall frames, modeled as simple shapes where they stick out.
  - Outlets and switches stay as part of the image.
- **Images:**
  - Each region's image comes from whichever source shows that spot most sharply. Fine detail comes from the closest, sharpest sample, such as the floor in the chair Detail Captures.
  - Light and shading come from the room Captures, so the real light falloff across the room stays.
- **Fill:** where Originals, clutter, or holes leave gaps, extend the surrounding pattern (the floor's planks, the plain teal paint). AI fill only where pattern extension visibly fails.
- **Removed:** the whiteboard (it's an Original) and the clutter. The plain wall behind the whiteboard is filled in.
- **No furniture shadows.** The Empty Room is lit as if empty.
- **Glass:** every glass area is an opaque, frosted pane in a neutral light grey. That's the North window, the glass wall, and the glass in the doors. Nothing outside the room shows.
- **Detail:** high definition. Aim for 2–3 mm per texel on the walls and floor near eye level.

**Surface layer:** cleaned splats, `empty-room.spz`, upright, in meters, in the room frame.

- **Keep** only splats lying within a few centimeters of the walls and floor, or of a fixture such as a door frame or the baseboard.
- **Drop:**
  - everything inside an Original's box, and all clutter
  - ceiling splats, since the ceiling comes from the mesh
  - glass regions
  - anything outside the walls
  - splats that are nearly transparent (opacity < 0.05) or very large (more than 0.3 m across)
- **Choose per region.** For each wall and the floor, ship whichever of ROOM_1, ROOM_2, or none (mesh only) looks more real in the shots in section 6. The comparison found the splats soft above about 1.7 m and thin on the West wall, so expect the mesh there.

### The furniture (part B)

**Master Copies.** Each is one file under `models/`:

| Master Copy | Built from | Parts (top-level node names) |
|---|---|---|
| `chair.glb` | The sharper of `POLYCAM_CHAIR_1` and `_2`, cut out of its surroundings and cleaned up in Blender. If each scan sees a different good side, combine them; the chair is left–right symmetric, so mirroring the better half is fine. | `seat`, `back`, `legs` (all 4 legs and their bracket) |
| `table.glb` | Rebuilt from measurements of the room scans and the splat (the splat has whole tables): top size and thickness, height, metal legs, casters. The tabletop image comes from the sharpest view, with smudges removed. | `top`, `legs` |
| `whiteboard.glb` | Rebuilt as a flat board plus its tray and trim, carrying the mesh's image so the writing stays readable | `board`, `frame` |

**Shadows.** Each Master Copy also has a node named `shadow`: a soft shadow under the item, its darkness matched to the real shadows under the chairs and tables in the Captures. The whiteboard's sits on the wall behind it. It moves with the item.

**Rules for every Master Copy file:**

- meters, +Y up, front is +Z
- origin at the center of the item's footprint on the floor
- images carry the real light, as the Empty Room's do
- brightness and color match the real items in the room

**Originals.** There are 16: `Chair 1`–`Chair 12`, `Table 1`–`Table 3`, and `Whiteboard`.

1. Each starts from its KIRI Layout box.
2. It's then fitted so its Master Copy sits where the real item is. Fit it against the room scans' surfaces and the splat's points inside the box.
3. It's saved in `setup.json` with `model`, a box matching the Master Copy's size at that pose, `category`, and `label`.

### The editor (part C)

**Drawing lounge-v2:**

- The Empty Room mesh is always drawn, with the splat on top.
- Push the mesh slightly back in depth (polygon offset) so a splat on the same surface wins.
- Each Original is drawn from its Master Copy: load each file once and place it 12, 3, or 1 times.
- Nothing is cut out of the scan mesh, and there are no Patches. Moving or removing an Original shows the Empty Room underneath.

**Recolor and Parts:**

- Parts are the Master Copy's named nodes.
- Recolor works on one Part or the whole item, and keeps the real lighting as it does now.
- **"All matching"** applies the same Recolor to every Original with the same Master Copy, as one Edit and one History row.

**Shadows:** an Original's `shadow` node moves with it. Catalog Pieces keep #48's shadows.

**Camera shots:** `?shot=<name>` jumps to each of the 8 shots in section 6, and `?empty=1` hides every Original. Both serve screenshots and the walk-through.

## 4. Contract changes (`shared/types.ts`, owned by C)

```ts
export interface Original {
  // ...existing fields
  model?: string;   // Master Copy file in the Scan folder, e.g. "models/chair.glb". When set, the Original
                    // is drawn from it at box.position / box.rotationY, and its Parts are the file's
                    // top-level node names except "shadow". Category Part rules (ADR-0006) don't apply.
}

// recolor gains an optional flag: apply to every Original with the same `model` (one Edit, one History row)
| { type: 'recolor'; targetId: string; partId: string; color: Hex | null; sameModel?: true }
```

## 5. Files in `data/scans/lounge-v2/`

| File | Owner | What |
|---|---|---|
| `manifest.json` | A | `mesh: "empty-room.glb"` and `splat: "empty-room.spz"`, with identity transforms (everything is already in the room frame) |
| `setup.json` | A, except `originals`, which B owns | Floor polygon, walls, ceiling, and Openings from the Layout and the mesh. A commits it with `originals: []`. |
| `align.json` | A | Every source's transform into the room frame |
| `layout.json` | A | The KIRI Layout's items in the room frame (walls, Openings, table and chair boxes) |
| `empty-room.glb`, `empty-room.spz` | A | The Empty Room |
| `models/*.glb` | B | Master Copies |

Keep each file under 95 MB, or put it in Git LFS.

## 6. "Real" in numbers

| Check | Target |
|---|---|
| Chair Master Copy vs the chair Detail Capture | median surface distance ≤ 1 cm; seat height, seat width, back height, and leg spread within 5 mm |
| Table Master Copy vs the room scans | top size and height within 5 mm; leg positions within 1 cm |
| Each Original's pose vs the real item | within 2 cm and 2° |
| Empty Room walls and floor vs the Main Capture | within 1 cm |
| Holes, floaters, smears, seams | none in any shot below, in either version of the room |
| Frame rate | 60 fps in Chrome on the M3 Pro, in every shot |

**The 8 shots.** Each is taken furnished and as the Empty Room, at 1440×900:

1. eye level (1.6 m) at the main door on the West wall, looking in
2. eye level at the North window end, looking South
3. eye level 2 m from the whiteboard, facing it
4. seated (1.15 m) at the middle table, looking across
5. a tabletop close-up, 0.6 m above Table 1
6. chair legs: 0.4 m high, 1 m from a chair
7. the default Dollhouse view
8. top-down

## 7. Order and finish

1. **A, part 1** goes first and merges fast, ideally within the first hour. It contains:
   - lounge-v1's splat rebuilt upright and lined up, so the fallback room works
   - the lounge-v2 folder with `align.json`, `layout.json`, `manifest.json`, and `setup.json` with no Originals yet
2. **B** starts on the Master Copies at once, since they don't need the room frame. It writes `setup.json` → `originals` only after A's part 1 is on main.
3. **C** starts at once against a small test Scan. It switches to lounge-v2 as A's and B's files land.
4. **Finish:** you walk through lounge-v2 in the editor and give feedback to the workspace that owns each problem. They fix it, and the hero Design moves to lounge-v2 when you sign off.
