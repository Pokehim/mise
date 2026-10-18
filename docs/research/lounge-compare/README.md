# Lounge Capture comparison (17 Oct 2026)

These are the scratch tools and results behind ADR-0009. They compare the lounge's mesh with both Polycam splats, viewed from the same cameras.

## Results

**Alignment.** These transforms move each splat into lounge-v1's room frame: floor at y = 0, walls on the axes, x = ±1.58, z = ±3.62, ceiling at 2.431 m. The full fits are in `align-ROOM_1.json` and `align-ROOM_2.json`.

The formula is `room = position + RotY(rotationY) · scale · F · file`. F is a 180° turn about X, because both splats are stored upside down (Y down).

| | position | rotationY | scale | tilt left over | median error |
|---|---|---|---|---|---|
| SPLAT_ROOM_1 | [−0.916, −0.243, 1.680] | 0.9185 rad | 1.5773 | 0.71° | 2.1 cm |
| SPLAT_ROOM_2 | [−4.008, −0.100, 2.322] | 2.4388 rad | 1.4510 | 0.49° | 2.3 cm |

`full.R` and `full.t` in each JSON include the tilt.

**Coverage.** This is the share of 10 cm cells where each source has a dense surface.

| Surface | Mesh (GLB_1) | SPLAT_ROOM_1 | SPLAT_ROOM_2 |
|---|---|---|---|
| Floor | 96% | 98% | 93% |
| North wall (window) | 66% | 58% | 47% |
| East wall (whiteboard) | 97% | 69% | 35% |
| South wall (glass, door) | 52% | 57% | 35% |
| West wall (main door) | 79% | 37% | 35% |
| Ceiling | 95% | 13% | 7% |

**Looks.** Contact sheets are in `sheets/`. Each is ordered: (a) mesh, (b) ROOM_1 with view-dependent color, (c) ROOM_1 without it, (d) ROOM_2.

- The mesh wins on the walls, ceiling, window, and whiteboard writing.
- The splats win on the chairs and tables.
- ROOM_1 beats ROOM_2 everywhere. 22% of ROOM_2's splats float outside the room, against 9% for ROOM_1.
- View-dependent color barely shows, because Polycam stores the highest band as zeros.

## Running the tools

1. Run `npm install` in this folder.
2. Start the viewer with `npx vite --config viewer/vite.config.mjs` (port 5199).
3. Take screenshots with `node shoot.mjs <src> <view>`.

Some scripts point at the main checkout (`/Users/jameswang/coding projects/mise`).

The viewer's `r1sh3` and `r2sh3` sources load `spz/room1_H3.spz` and `spz/room2_H3.spz`, which are not committed. Make them with `scripts/splat.sh` and `SPLAT_SH_BANDS=3`.
