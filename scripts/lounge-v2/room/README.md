# lounge-v2: the Empty Room (#77)

Scripts for `data/scans/lounge-v2/` (spec `.plans/lounge-v2-spec.md` §1–3, §5–7). They hard-code the study lounge.

Set up once:

```sh
uv venv --python 3.13 scripts/lounge-v2/.venv
VIRTUAL_ENV=scripts/lounge-v2/.venv uv pip install -r scripts/lounge-v2/room/requirements.txt
```

Run from `scripts/lounge-v2/room/` with `../.venv/bin/python`:

| Script | Writes |
|---|---|
| `splat_v1.py` | `lounge-v1/splat.spz` upright and cropped to the room, and `lounge-v1/manifest.json` → `splatTransform` |
| `layout.py` | `lounge-v2/layout.json`: the KIRI Layout in the room frame |
| `align.py` | `lounge-v2/align.json`: every source's transform into the room frame (needs `layout.json`) |
| `setup.py` | `lounge-v2/setup.json` (keeps `originals`) and `lounge-v2/manifest.json` |
| `ortho.py` | Run in Blender: unlit orthographic views of a source, one per room surface |

Intermediate files go to `scripts/.cache/lounge-v2/` (gitignored).
