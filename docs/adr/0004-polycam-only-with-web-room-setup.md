# Polycam is the only capture; the room's meaning is added by hand in Room Setup

This supersedes ADR-0002. A Scan comes from Polycam alone. We have the **Business** tier, which unlocks every export, so Polycam supplies the textured LiDAR mesh (GLB) and its own Gaussian splat (Splat PLY). Developer Mode stays on during capture, so the raw photos and camera poses are kept as a fallback. The floor, walls, Openings, and Originals are marked once in a Room Setup step in our web editor.

We don't build a RoomPlan app. Writing, signing, and testing a first RoomPlan app, plus a tool to align its output with the Polycam mesh, would cost about 4–5 of our roughly 20 hours. Judges never see capture, because the demo starts from a Scan prepared in advance.

## Consequences

- Room Setup for a dorm room is about 10 minutes of clicking, done once per Scan, before any Design is made.
- The mesh defines the room frame, so Room Setup has no alignment step and no alignment error.
- The splat must be placed in the mesh's frame (`splatTransform`, ADR-0005). If Polycam can't build the splat from the same capture as the mesh, that alignment is a manual fit.
- The fallback splat, trained from the Developer Mode raw data, shares the mesh's coordinates, but only if Developer Mode was on during capture.
- Automatic room understanding can be added later as an "auto-setup" that writes the same Room Setup data. Polycam Business's floor-plan export with furniture detection is the first candidate to check, then RoomPlan or AI detection.
