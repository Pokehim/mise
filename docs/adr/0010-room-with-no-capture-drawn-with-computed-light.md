# A room with no Capture is drawn from its Room Setup, with its light computed when it loads

Some Scans have no Capture: the fixture, and dorm rooms read off the floor plans universities publish (`data/floor-plans/`), for Movers who can't stand in the room yet. The editor drew these as flat, evenly lit panels, which look nothing like a real room. Now it builds them from the Room Setup the way a room is built: walls 15 cm thick with tops and an outside, door and window frames, a door, window glass with a view out, baseboards and a ceiling light. `RoomSetup.surfaces` (`RoomSurfaces`) says what the room is made of: drywall or painted cinderblock, the paint color, the floor (a Material Library id), the ceiling, and the baseboard.

Its light is computed in the browser when the room loads (`bakeLight.ts`, a few hundred milliseconds): an overcast sky and the ground through each window, the sun through the largest one, a ceiling light, and two bounces off the walls, floor and ceiling. Everything is drawn unlit, like a Scan, with that light as each Surface's **light map**, kept apart from its color. So paint and material Finishes, which change only the color, keep the room's light and shadows exactly, as they do on a Scan. And a Finish replaces the surface's own detail (carpet loops, cinderblock joints) instead of showing it through: `uMatDetail` is 0 for these rooms, and stays 1 for a Scan, whose texture holds its light.

## Considered options

- **Real-time lighting** (lit materials, shadow maps, screen-space ambient occlusion). It needs a post-processing pipeline that would also darken Scans, whose light is already in their texture, and it can't bounce light, so corners and the far side of the room look flat.
- **Light baked into the color texture**, as in a Scan. A floor Finish would then show the carpet's pattern through the oak.
- **Baking offline into a `room.glb`**, as `synthetic-room.ts` does. Rooms built later, such as from a floor plan (#68), would need a server step before they could be shown.

## Consequences

- Furniture drawn on the plan isn't an Original here: an Original with no scanned geometry is a box until Stand-ins exist (#68). The rooms' furniture is a "Move-in layout" Design of Catalog Pieces instead.
- The light is computed for the room as built. A moved Piece doesn't shadow the floor until the Max level's cast shadows.
- The sun always comes through the largest window, 30° up. It makes a believable patch, but it isn't the room's real orientation.
- The window shows a made-up campus view, not the room's real one.
