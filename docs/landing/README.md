# The landing page's 16 rooms

The Designs behind the 16 rooms on the landing page (`web/src/pages/landing/rooms.ts`). Claude made each one of the study lounge (`lounge`) with Generate, from a one-line Brief for a kind of room: a dorm bedroom, a game room, a study room, a library, a guest bedroom or a music lounge. The Briefs ask for a muted palette and no multicolor rugs, because the first round came back with neon pink and yellow. The Designs are kept here, not in `data/designs`, so the Scans page lists only the lounge's own Designs.

Each room on the landing page is a clip of its reveal (`web/src/scene/Reveal.tsx`): the lounge as it is turning into the Design Edit by Edit, from the door. To record the clips again, after changing a Design or the reveal, start the app and run:

```sh
node scripts/landing-clips.ts            # every Design here
node scripts/landing-clips.ts ds_x ds_y  # just these
uv run --with imageio-ffmpeg python scripts/landing-clips-compress.py  # then shrink the new ones
```

The browser records near-lossless (8 Mb/s) in real time; `landing-clips-compress.py` encodes each new clip once, at 480×360 and CRF 30: sharp at the size the rooms show, about 120 kB a clip. It skips clips already at 480×360.

To open one of these Designs in the editor, copy it into `data/designs/`, then go to `/d/<id>`.

The photo beside the rooms (`web/src/pages/landing/real-room.webp`) is the lounge as it really is, with its tables and chairs: a phone photo cropped square from below the ceiling, resized to 800 px, and saved as WebP without its metadata.

## The scan

Before the rooms assemble, the grid shows the lounge's scan building (`web/src/pages/landing/scan/scan.webm`): the point cloud of `data/scans/real-scans/POLYCAM_ROOM_SPLAT_1.ply`, placed in the lounge's frame by `data/scans/lounge/align.json`, swept from the door to the window in LiDAR colors (by height). The camera comes down to the door, and the points turn, near to far, into the lounge as the app rebuilt it, its Originals and all, from the door. That is the first frame of every room clip (`empty.webp`), so the scan hands over to the 16 rooms, each of which then takes out what its Design removes. `counts.json` holds how many points the sweep has passed, ten times a second, and when the rebuilt lounge takes over, for the slip. To render it again (about two minutes), start the app, then:

```sh
cd scripts/scan-renders
PORT=<the app's port> uv run --with numpy --with pillow --with imageio-ffmpeg python gridclip.py
```

It writes `scan.webm` (1600×1200) and `scan-small.webm` (800×600, for small grids, screens that aren't sharp, and slow connections). It opens the editor at `/d/ds_lounge?shot=door` (`door.mjs`) for that frame and its camera, and keeps them in `$OUT` (`scan-renders/` by default); `--door` takes them again.

The same scripts render stills and a 10-second video for slides: `OUT=<dir> python final.py lidar-dollhouse color-dollhouse lidar-depth-eye color-points-eye lidar-plan three-passes` and `OUT=<dir> python anim.py`.
