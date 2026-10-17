# A Scan combines a Polycam capture with a separate RoomPlan scan, aligned once

A Scan is assembled from two captures of the same room:

- **Polycam (free tier, Developer Mode on).** It supplies a textured LiDAR mesh as glTF, plus the raw photos and camera poses.
- **Our own small RoomPlan app.** It supplies the walls, doors, windows, and labeled furniture boxes at real dimensions.

Both captures are metric and gravity-aligned, so a one-time alignment only needs horizontal position, height, and rotation about the vertical axis.

We rejected building our own ARKit capture. That would have recorded frames and RoomPlan in one session and been aligned automatically, but nobody on the team has ARKit experience, and texturing ARKit meshes ourselves would take days. We also rejected using Polycam alone, because it doesn't export furniture labels or wall geometry, and every editing feature depends on those.

## Consequences

- The Mover scans the room twice: once in Polycam, once in our app.
- Any alignment error shows up as furniture boxes that don't sit on the furniture.
- RoomPlan recognizes only 16 categories (no lamps, art, plants, or rugs), so other Originals must be tagged another way.
- Polycam's free tier doesn't export splats, so any photoreal splat must be trained by us from the Developer Mode raw data.
