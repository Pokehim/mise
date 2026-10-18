---
status: superseded by ADR-0009 for lounge-v2 (no Fill Capture has moved furniture; the Empty Room replaces Patches)
---

# Patches and the backs of moved Originals come from Fill Captures

A LiDAR scan never sees the floor under a sofa, the wall behind a dresser, or the back of anything pushed against a wall. So removing or moving an Original leaves a gap that a generated fill can only guess at. We take extra Polycam Captures of the same room with the furniture moved (Fill Captures), line each one up with the Main Capture in Room Setup, and merge what they saw into `room.glb`. That merged geometry covers two things: the real floor and wall under and behind each Original, which becomes its Patch, and the unseen backs and sides of moved Originals. Generated fill (Patch v2's push-pull diffusion) remains only for spots no Capture saw.

## Considered options

- **Generated fill only** (the earlier plan: a floor-colored rectangle, then push-pull diffusion, maybe inpainting). It needs no extra Captures, but it is blurry or flat under large furniture, and it can't fill a wall behind a piece or its back at all.
- **Fusing whole meshes from several Captures** for more detail everywhere. It needs registration, seam blending and per-region texture choice across the whole room, for a gain the splat already gives wherever nothing is edited (ADR-0005). For resolution we instead reprocess the Main Capture with denser settings and raise its texture budget.

## Consequences

- **Capturing has an order.** The Main Capture and every splat video come first, with the furniture in place. Then the furniture is moved, kept upright, and the Fill Captures are taken with the lights unchanged. Kept Originals stay put.
- **The contract grows.** `ScanManifest.captures` lists the Main Capture and each Fill Capture, with its transform to the Main Capture and the moved Originals it holds. `Original.patch` becomes a floor image plus one image per wall, for the generated part.
- **Room Setup gains a Fill Captures step** after Originals, and saving it rebuilds `room.glb` on the server. Only triangles inside Patch areas and moved Originals are merged, and the whole `room.glb` stays within one triangle budget.
- **Patches can show seams.** Each Capture is exposed differently, so each Patch and each completion carries its own color gain. A moved Original keeps the lighting baked in where it stood.
