# A Scan can be built from a Floor Plan, before the Mover can capture the room

Movers often have to plan before they can stand in the room: a freshman gets a housing assignment and a floor plan weeks before move-in. The Mover uploads the Floor Plan, and Claude reads it into a draft: the room's corners, Openings, and drawn furniture, in the image's pixels, plus the printed dimensions that give it a scale (`shared/floor-plan.ts`). The Mover corrects the draft over the image in Room Setup, and `planToSetup` turns it into an ordinary Room Setup with no Captures, drawn as ADR-0010 draws a room with no Capture. Furniture drawn on the plan becomes Originals drawn with a **Stand-in**: the Catalog item closest in kind and size, scaled to the Original's box. This amends ADR-0004: a Scan now comes from Captures *or* a Floor Plan.

## Considered options

- **Trace by hand only.** Predictable, but about 10 minutes of clicking per room. It stays as the fallback when Claude is unavailable or misreads the plan.
- **Typed dimensions.** Rectangles only.
- **Claude returns meters directly.** Rejected because its guesses couldn't be shown on the plan, so the Mover couldn't check them. Pixels plus a printed dimension let code do the math, and let the overlay show every guess.
- **Gray boxes for drawn furniture.** They look unfinished next to the room ADR-0010 draws.
- **Text-to-3D furniture.** Slow, paid, and kept off the demo path.

## Consequences

- A Floor Plan Scan's manifest has `floorPlan` (its image, the draft, and the scale), and keeps `mesh: "room.glb"`, though no such file exists. The editor doesn't fetch it, and never draws a Patch, since nothing was hidden under the furniture.
- Plans don't give heights. The ceiling, doors and windows start from US defaults (8 ft, 80 in, a 36 in sill), and each Stand-in brings its own height. The Mover can change all of them.
- A Stand-in matches the real furniture's footprint and kind, not its look. A Kept Original keeps its Stand-in, and Replace swaps it for a Piece as usual.
- Reading a plan is one Claude call (about 20–60 s). With no API key, the Mover traces the plan by hand on the same page.
- The contract grows by `ScanManifest.floorPlan` and `Original.standInId`.
