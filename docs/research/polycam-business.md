# Polycam Business: splats and floor plans

Researched Sat 2026-10-17, about 4:30 PM, from Polycam's own help center. The pages block automated browsers, so the articles were read through the help center's public Zendesk API (`learn.poly.cam/api/v2/help_center/en-us/articles/<id>.json`). Each article's last-updated date is listed under Sources.

## Q1. Can Polycam build a Gaussian splat from the same LiDAR (Space Mode) capture as the mesh?

**No.** Polycam makes splats only from **Object Mode** captures (photos or video) or from **uploaded photos and video**, never from a Space Mode capture.

- In Polycam's export table, **Splat PLY** appears only under the "Object: Gaussian Splat" capture type. The Space Mode (LiDAR) column offers images (with Developer Mode, on the original device), video, 2D floor-plan formats, mesh formats (OBJ, DAE, FBX, GLTF, STL, USDZ), and point clouds. It has no splat. [Export table]
- "Object Mode gives you two ways to turn photos into 3D: Photogrammetry for traditional mesh models, and Gaussian Splats for photorealistic results." [Capture modes]
- Uploaded media can be processed as a Gaussian Splat ("Available on Basic and above"). On Business, an upload can be up to 1,000 images or a 30-minute video. [Upload]

**What this means for Mise:**

- A Polycam splat lives in **its own coordinate frame**. Its camera positions are re-estimated from photos, so its scale and tilt aren't guaranteed to match the LiDAR mesh. It has to be **fitted to the mesh by hand**, including scale and possibly tilt.
- **A shortcut that avoids a second walk-through:** export the Space capture's own **video** (the export table lists it as available) and upload it as a Gaussian Splat. Same walk, same lighting. It still needs fitting.
- **Correction to our earlier docs:** the "rotate 180° about Y, scale ×100" step in Polycam's Unity guide lines up a splat capture with **that same capture's own mesh export**, inside Unity. It says nothing about fitting a splat to a separate Space Mode mesh. [Unity guide]
- The only route that lines up automatically is our fallback: training a splat with msplat from the Space capture's Developer Mode raw data. That data carries ARKit camera poses in the same frame as its raw mesh. The tradeoff is quality: expect a softer splat than Polycam's.

## Q2. What does the Business floor-plan export contain? Can it pre-fill Room Setup?

**It can't pre-fill Room Setup in a useful way, so keep Room Setup manual.**

- **One Space Mode session (LiDAR) produces three outputs:** "a detailed 3D LiDAR mesh, a clean 3D floorplan model, and a 2D floorplan with measurements and room labels." [Capture modes]
- **2D floor-plan exports (Business):** Blueprint, Blueprint + Measurements, CSV, DXF, PDF, PNG, SVG. The units (metric or imperial) are chosen before export. [Export table, AutoCAD guide]
- **The DXF is layered.** Polycam's AutoCAD guide refers to layers for room and wall outlines ("Poly Rooms"), fixtures, appliances, furniture, labels, dimensions, and room areas. Doors and windows are editable elements of the floor plan. [AutoCAD guide, Floorplan Editor]
- **Automatic furniture detection is narrow.** The recognized types are dishwasher, oven, refrigerator, stove, sink, bathtub, toilet, fireplace, stairs, storage (shelves and cabinets), and washer/dryer. **Beds, desks, chairs, tables, sofas, and lamps are not detected.** You can add them by hand in the floor-plan editor. [Furniture list, Floorplan Editor]
- **Not documented:** whether the "clean 3D floorplan model" can be exported as a 3D file, and whether the 2D plan's coordinates match the mesh's. The plan is 2D, so walls would need a height, and the plan would need fitting to the mesh (position and rotation on the floor).

**What this means for Mise:**

- For a dorm, auto-detection would find walls, the door, and the windows, plus maybe a dresser or wardrobe. It would miss the bed, desk, and chair, which are the Originals the demo uses.
- Writing a DXF importer and a 2D fitting step would take about 2–3 hours. Clicking out a 4-wall dorm by hand takes about 10 minutes.
- **Decision:** don't build an importer for the hackathon. Do export the floor-plan **PDF with measurements** as a reference to check the dimensions entered in Room Setup.

## Sources (Polycam help center, last-updated dates)

- [Export table] What File Types Can Polycam Export? (2026-09-23): https://learn.poly.cam/hc/en-us/articles/27756102599572
- [Capture modes] Which Capture Mode Should I Use? (2026-09-16): https://learn.poly.cam/hc/en-us/articles/48565771018772
- [Upload] How to Create Photogrammetry and Gaussian splats from Existing Images and Videos (2026-07-14): https://learn.poly.cam/hc/en-us/articles/30549121659412
- [Unity guide] How to Import Your Gaussian Splat Captures into Unity (2025-10-15): https://learn.poly.cam/hc/en-us/articles/41491673295508
- [AutoCAD guide] How to Export Polycam Space Mode Captures to AutoCAD (2025-10-13): https://learn.poly.cam/hc/en-us/articles/41491709457684
- [Furniture list] What Types of Furniture Are Recognized in Floorplan and Space Mode? (2026-04-01): https://learn.poly.cam/hc/en-us/articles/30550038931988
- [Floorplan Editor] How to Use the Polycam Floorplan Editor (2026-10-12): https://learn.poly.cam/hc/en-us/articles/44278971384852
- Also read: How to Capture As-Built Drawings (2026-05-06), How to Create Floorplan Captures (2026-06-17), Export Gaussian Splats from Polycam to Unreal Engine (2025-10-22)
