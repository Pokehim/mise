# Polycam is the only capture; the room's meaning is added by hand in Room Setup

This supersedes ADR-0002. A Scan comes from Polycam alone. We have the **Business** tier, which unlocks every export. Polycam supplies the textured LiDAR mesh from a Space Mode capture (GLB) and a Gaussian splat (Splat PLY) built in its cloud. Developer Mode stays on during capture, so the raw photos and camera poses are kept as a fallback. The floor, walls, Openings, and Originals are marked once in a Room Setup step in our web editor.

We don't build a RoomPlan app. Writing, signing, and testing a first RoomPlan app, plus a tool to align its output with the Polycam mesh, would cost about 4–5 of our roughly 20 hours. Judges never see capture, because the demo starts from a Scan prepared in advance.

## Consequences

- Room Setup for a dorm room is about 10 minutes of clicking, done once per Scan, before any Design is made.
- The mesh defines the room frame, so Room Setup has no alignment step and no alignment error.
- Polycam builds splats only from Object Mode captures or uploaded photos and video, never from a Space Mode capture. Its splat therefore has its own coordinates and scale, and must be fitted to the mesh by hand (`splatTransform`, ADR-0005). The fallback splat, trained from the Developer Mode raw data, lines up with the mesh almost automatically, but only if Developer Mode was on during capture.
- Polycam's Business floor-plan export doesn't help with Room Setup. Its furniture detection skips beds, desks, chairs, tables, and sofas, and the plan is 2D (`docs/research/polycam-business.md`). Automatic setup, if it's ever added, would come from RoomPlan or AI detection, writing the same Room Setup data.
