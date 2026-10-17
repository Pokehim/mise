# Polycam is the only capture; the room's meaning is added by hand in Room Setup

This supersedes ADR-0002. A Scan comes from a single Polycam capture: the free-tier textured LiDAR mesh as glTF, captured with Developer Mode on so that the raw photos and camera poses are also kept. The floor, walls, Openings, and Originals are marked once in a Room Setup step in our web editor. We don't build a RoomPlan app. Writing, signing, and testing a first RoomPlan app, plus a tool to align its output with the Polycam mesh, would cost about 4–5 of our roughly 20 hours. Judges never see capture, because the demo starts from a Scan prepared in advance.

## Consequences

- Room Setup for a dorm room is about 10 minutes of clicking, done once per Scan, before any Design is made.
- Everything lives in Polycam's coordinate frame, so there is no alignment step and no alignment error.
- Automatic room understanding (RoomPlan or AI detection) can be added later as an "auto-setup" that writes the same Room Setup data.
- The photoreal upgrade (a splat trained from the Developer Mode raw data) shares the mesh's coordinates, so Room Setup work carries over. This only works if Developer Mode was on during capture.
