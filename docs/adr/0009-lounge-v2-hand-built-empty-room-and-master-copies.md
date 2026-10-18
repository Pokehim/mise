# lounge-v2 is hand-built for this one room: an Empty Room plus a Master Copy of each kind of furniture

The demo has one room, the study lounge, and every view of it has to look real: eye level, seated, close-ups, the Dollhouse view, and top-down. A side-by-side render of every Capture showed that no single source gets there:

- **The meshes** have sharp walls, ceiling, window, and whiteboard, but torn chairs and ragged tables.
- **The splats** have whole chairs and tables, but almost no ceiling and soft, patchy upper walls. They also float blobs near the door and outside the room.

So `lounge-v2` is built by hand from all of the Captures, and only for this room:

- **The Empty Room** is drawn in two layers. Underneath is a hole-free mesh: flat walls, floor, and ceiling at the room's measured size, plus door frames and doors. Each region's image comes from the sharpest Capture of that spot, and gaps are filled by extending the surrounding pattern. On top is a splat cleaned down to the splats lying on the room's surfaces. For each region, whichever layer looks more real is shown. The ceiling always comes from the mesh, and every glass area is an opaque frosted pane.
- **Every Original is its own item,** drawn from a Master Copy from the moment the room opens: 12 chairs, 3 tables, and the whiteboard. The chair's Master Copy comes from the two chair Detail Captures. The table and the whiteboard are rebuilt from measurements and the real images. Each Original carries its own shadow, and Parts are the Master Copy's named pieces.

This supersedes ADR-0007 for lounge-v2: every Capture has the furniture in the same place, so there is no Fill Capture with furniture moved, no Completion, and no Patch. Wherever an Original is moved or removed, the Empty Room shows. It overrides ADR-0005 for this room: nothing switches from splat to mesh when edited, because Originals are never part of the splat. It also takes Room Setup for lounge-v2 out of ADR-0008's general Layout pre-fill: the Layout's boxes are only a starting point for fitting each Master Copy.

## Considered options

- **The general pipeline** (ADR-0005, 0007, 0008): splat for untouched areas, the mesh once edited, Patches from Fill Captures. Our Captures have no moved furniture, and the moment an Original was edited it would switch to the torn mesh.
- **One splat for everything,** with floaters removed. It is still missing the ceiling and the upper walls, falls apart from above, and can't give clean Parts.
- **One cleaned mesh for everything.** It would work from every angle but lose the splat's realism where the splat is strong.

## Consequences

- Scripts and data for lounge-v2 hard-code this room's numbers and are not expected to work on other Scans.
- Its 12 chairs are identical, and so are its 3 tables, so one Master Copy each makes every chair equally sharp but drops each one's own scuffs.
- `Original` gains an optional Master Copy file, and Parts come from that file's named pieces when it is set. This is a `shared/types.ts` change.
- `lounge-v1` stays as the fallback until lounge-v2 passes a walk-through by a person.
