# lounge-v2: the Empty Room (#77)

Scripts for `data/scans/lounge/` (spec `.plans/lounge-v2-spec.md` §1–3, §5–7). They hard-code the study lounge.

Set up once:

```sh
uv venv --python 3.13 scripts/lounge-v2/.venv
VIRTUAL_ENV=scripts/lounge-v2/.venv uv pip install -r scripts/lounge-v2/room/requirements.txt
```

Run from `scripts/lounge-v2/room/` with `../.venv/bin/python`:

| Script | Writes |
|---|---|
| `layout.py` | `lounge/layout.json`: the KIRI Layout in the room frame |
| `align.py` | `lounge/align.json`: every source's transform into the room frame (needs `layout.json`) |
| `setup.py` | `lounge/setup.json` (keeps `originals`) and `lounge/manifest.json` |
| `ortho.py` | Run in Blender: unlit orthographic views of a source, one per room surface |
| `textures.py` | The Empty Room's images, from the views below |
| `glb.py` | `lounge/empty-room.glb` |
| `splat_empty.py` | `lounge/empty-room.spz`, when a surface is set to use a splat. None is: see its `SOURCE` |
| `grain.py` | A floor view's grain direction (it fixed the chair Detail Captures' yaw in `align.py`) |

Intermediate files go to `scripts/.cache/lounge-v2/` (gitignored).

## Rebuilding the Empty Room

```sh
cd scripts/lounge-v2/room
B=/Applications/Blender.app/Contents/MacOS/Blender
for s in POLYCAM_ROOM_GLB_1.glb:GLB_1 POLYCAM_ROOM_GLB_2.glb:GLB_2 POLYCAM_ROOM_GLB_3.glb:GLB_3 KIRI_ENGINE_CHAIR_1/model.obj:KIRI; do
  $B -b --factory-startup -P ortho.py -- ${s%%:*} ../../.cache/lounge-v2/ortho/${s##*:} 2.5
done
$B -b --factory-startup -P ortho.py -- POLYCAM_CHAIR_1.glb ../../.cache/lounge-v2/ortho1mm/CHAIR_1 1 floor
../.venv/bin/python textures.py && ../.venv/bin/python glb.py
```

## The 8 shots (spec §6)

```sh
(cd docs/research/lounge-compare && npm install)   # playwright-core, once
npx vite --config scripts/lounge-v2/room/viewer/vite.config.mjs &
node scripts/lounge-v2/room/shoot.mjs empty all --fps
scripts/lounge-v2/.venv/bin/python scripts/lounge-v2/room/sheet.py scripts/.cache/lounge-v2/shots empty sheet.jpg
```

`viewer/` is the comparison viewer's (docs/research/lounge-compare) with the shots' cameras, 1440×900, the editor's 55° field of view and Dollhouse camera, and the editor's Dollhouse ceiling cut and faded near wall.
