---
status: amended by ADR-0009 (for lounge-v2 the Layout's boxes only seed the Master Copy fits)
---

# Captures from Polycam and KIRI Engine are merged into one Scan, and KIRI's Layout pre-fills Room Setup

Every capture we have of the lounge has holes. KIRI Engine's Room mode also exports a **Layout**: a RoomPlan-style USDZ with labeled walls, doors, windows, tables, and chairs at real size (meters, Y-up), but no scanned surfaces. We combine all of it in the Main Capture's frame, extending ADR-0007:

- **Fill Captures.** Other room-wide Captures, from either app, become Fill Captures. Besides filling Patches, they now fill gaps anywhere the Main Capture saw nothing.
- **Detail Captures.** Close-up Captures of a table and its chairs replace the Main Capture's geometry for the Originals they cover.
- **The Layout.** It is aligned to the Main Capture and pre-fills Room Setup. Its walls, floor, and ceiling also become a solid backstop behind any hole that no Capture saw.

This amends ADR-0004. Room Setup becomes a review of the Layout instead of clicking out every wall, door, table, and chair: 12 chairs and 3 tables here. Building our own RoomPlan app is still rejected, because KIRI gives us the same data for free.

## Consequences

- Captures from different apps differ in color and exposure. Each one is matched to the Main Capture: first globally, then per region, using the gain method from ADR-0007.
- The Layout's boxes are approximations, so every Original still gets a review pass in Room Setup.
- Reading USDZ (binary USDC) needs Python's `usd-core`; there is no maintained JavaScript reader. Layout import is therefore an offline script that writes JSON.
- `ScanCaptures` gains `details`, a contract change both people must agree to.
- Detail Captures are 600–730k triangles each, so they're decimated to fit the 500k-triangle room budget.
