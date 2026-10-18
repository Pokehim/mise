# A Scan can be built from a Floor Plan, before the Mover can capture the room, and starts empty

Movers often have to plan before they can stand in the room: a freshman gets a housing assignment and a floor plan weeks before move-in. The Mover uploads the Floor Plan, and Claude reads it into a draft (`shared/floor-plan.ts`): the room's corners and Openings, in the image's pixels, plus the printed dimensions that give it a scale. The Mover corrects the draft over the image in Room Setup. `planToSetup` turns it into an ordinary Room Setup with no Captures, drawn as ADR-0010 draws a room with no Capture. This amends ADR-0004: a Scan now comes from Captures *or* a Floor Plan.

The room starts **empty**. Furniture drawn on the plan isn't read and isn't carried over. The Mover furnishes the room from the Catalog, or asks Claude for Designs.

## Considered options

- **Trace by hand only.** Predictable, but about 10 minutes of clicking per room. It stays as the fallback when Claude is unavailable or misreads the plan.
- **Typed dimensions.** Rectangles only.
- **Claude returns meters directly.** Rejected because its guesses couldn't be shown on the plan, so the Mover couldn't check them. Pixels plus a printed dimension let code do the math, and let the overlay show every guess.
- **The plan's furniture as Originals, each drawn with the Catalog item closest in kind and size.** Built, then dropped: the Mover chose to start every room empty.

## Consequences

- A Floor Plan Scan's manifest has `floorPlan` (its image, the draft, and the scale), and keeps `mesh: "room.glb"`, though no such file exists. The editor doesn't fetch it, and never draws a Patch.
- Plans don't give heights. The ceiling, doors and windows start from US defaults (8 ft, 80 in, a 36 in sill), which the Mover can change.
- Reading a plan is one Claude call (about 20–60 s). With no API key, the Mover traces the plan by hand on the same page.
- The contract grows by `ScanManifest.floorPlan`.
