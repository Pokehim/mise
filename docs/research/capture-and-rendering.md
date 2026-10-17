# Capture, Splat Training, and Web Rendering

Researched 2026-10-17, during the event. Sources are primary where possible: Apple documentation and its JSON, WWDC transcripts, the RoomPlan and ARKit `.swiftinterface` files in the local iOS 26.5 SDK, GitHub READMEs, source code and release APIs, npm and PyPI, vendor help centers, and App Store listings. Version numbers and dates for Spark, three.js, gsplat, nerfstudio, Brush, and msplat were re-checked by hand against npm, PyPI, and the GitHub API.

Markers used in this document:

- **[older]**: the fact was confirmed only from a source dated before 2026.
- **[unverified]**: the fact comes from a forum post, a secondary write-up, or a search snippet.
- **[est.]**: the figure is our extrapolation, not a measurement.

Companion doc: `docs/research/assets-and-hackathon.md` (catalog GLBs, PBR materials, deadlines).

> **Update, Sat 4 PM:** the team now has **Polycam Business**. Every export is unlocked, including Splat PLY, and Polycam builds splats in its cloud. Where this document treats Polycam's splat export as paid or unavailable, that no longer applies. Training our own splat (msplat on the raw data) is now only the fallback. Polycam builds splats only from Object Mode captures or uploaded photos and video, never from a Space Mode capture, so a Polycam splat must be fitted to the mesh by hand. See `docs/research/polycam-business.md`. The current plan is in `.plans/mise-spec.md` §9.1 and §12.

---

## TL;DR

1. **RoomPlan provides the room's semantics but not its appearance.**
   - `CapturedRoom` is `Codable` JSON. It holds walls, doors, windows, openings, and floors, plus 16 object categories (chair, sofa, table, bed, and others).
   - Every element has a `transform` (4×4) and `dimensions`. These are in the ARSession's world frame: meters, Y-up, gravity-aligned.
   - The USDZ export is untextured gray geometry.
   - RoomPlan's API has not changed since iOS 17. The iOS 26.5 SDK has no newer `@available` tags.
2. **The capture app can record photos and poses in the same frame as the RoomPlan boxes.** iOS 17+ lets you pass your own `ARSession` into `RoomCaptureSession` and read `ARFrame`s (image, intrinsics, camera pose) while it scans. This is the key enabler.
   - **Catch:** forum reports from 2023–2025 say `sceneDepth` is often nil while RoomPlan runs. Treat LiDAR depth during the scan as unavailable until a spike proves otherwise.
3. **Splat trainers.**
   - **Mac:** Brush v0.3.0, msplat 1.1.4, and OpenSplat 1.2.2 train natively on an M3 Pro.
   - **Not on Mac:** nerfstudio, splatfacto, and gsplat are CUDA-only.
   - **Cloud:** gsplat takes about 19 min for 30k steps on an A100.
   - **Mac [est.]:** about 25–45 min on an M3 Pro with msplat, or about 1–2.5 h with Brush.
   - **Easiest input:** nerfstudio `transforms.json`. ARKit camera poses can be written into it **directly**, because both use OpenGL camera axes.
4. **Normalization can break alignment.** Nerfstudio (by default), gsplat (`normalize_world_space=True`), and OpenSplat all re-center and re-scale the scene. That breaks metric alignment with RoomPlan. Brush keeps the dataset's coordinates.
5. **Off-the-shelf apps.**
   - **Scaniverse (Classic mode)** is the only app that trains splats **on the phone, for free, without limits**, and exports PLY and SPZ. Its PLY up-axis is not documented.
   - **Polycam** now puts splat PLY export behind its Business plan. Its free Developer Mode raw export (images, poses, depth) feeds straight into `ns-process-data polycam`.
   - **Luma** capture is effectively dead.
   - **KIRI** splats need Pro.
   - **3D Scanner App** has moved to subscriptions.
6. **Web renderer: use Spark 2.3.1** (`@sparkjsdev/spark`, MIT, released 2026-10-01, requires three ≥ 0.180).
   - It depth-tests splats against opaque three.js meshes, so a GLB chair occludes correctly.
   - It has built-in SDF region edits: a BOX with opacity 0 hides the old chair, and a color blend recolors a region.
   - It defaults to a budget of 1.5M rendered splats on iOS.
   - mkkellogg's GaussianSplats3D is no longer developed and points to Spark.
7. **Textured meshes are a fallback, not the main path.**
   - ARKit meshes have no UVs. Texturing them yourself is days of work.
   - Polycam's free tier exports a textured LiDAR mesh as GLTF, and Scaniverse and KIRI export meshes for free. These meshes look less photoreal than a splat.

---

## 1. Apple RoomPlan

### Direct answer

`CapturedRoom` holds **typed, oriented boxes and planes**: surfaces and furniture, each with a category, a 4×4 `transform`, `dimensions`, and a confidence. It holds no image or texture data.

- **Frame:** the transforms are in the **same world frame as the underlying ARSession**: meters, Y-up, gravity-aligned, with the origin where the session started.
- **Frame access:** since iOS 17 you can supply your own `ARSession` and read its frames during the scan.
- **Exports:** USDZ (parametric, mesh, or model), `Codable` JSON, and opaque `CapturedRoomData`.
- **Requirements:** iOS 16+ and a LiDAR device. Use iOS 17+ for everything we need.
- **Code size:** a minimal app is about 60–100 lines of SwiftUI.

### What `CapturedRoom` contains

Confirmed against the iOS 26.5 SDK `RoomPlan.swiftinterface` and Apple's doc JSON. Every `@available` tag in that interface is iOS 16.0 or 17.0, and WWDC24 and WWDC25 had no RoomPlan sessions.

| Member | Contents |
|---|---|
| `CapturedRoom` (iOS 16) | `walls`, `doors`, `windows`, `openings`, `objects`, `identifier: UUID`. Conforms to `Codable` and `Sendable`. |
| `CapturedRoom` (iOS 17 additions) | `floors`, `sections`, `story: Int`, `version: Int`. |
| `Surface` | `category` (`.wall`, `.opening`, `.window`, `.door(isOpen:)`, `.floor` from iOS 17), `confidence` (high/medium/low), `dimensions: simd_float3`, `transform: simd_float4x4`, `identifier`, `completedEdges: Set<Edge>` (top/right/bottom/left), `curve: Curve?` (center, radius, start and end angle). iOS 17 added `story`, `parentIdentifier` ("the parent of a window is the wall surface on which the window rests"), and `polygonCorners: [simd_float3]` ("in local plane coordinates"). |
| `Object` | `category`, `confidence`, `dimensions`, `transform`, `identifier`. iOS 17 added `attributes: [any CapturedRoomAttribute]`, `story`, `parentIdentifier`, and `attribute(of:)`. |
| `Object.Category` (16 cases, unchanged since iOS 16) | storage, refrigerator, stove, bed, sink, washerDryer, toilet, bathtub, oven, dishwasher, table, sofa, chair, fireplace, television, stairs. |
| Attributes (iOS 17) | `ChairType` (dining, stool, swivel, unidentified), `ChairArmType` and `ChairBackType` (existing, missing), `ChairLegType` (four, star, unidentified), `SofaType` (rectangular, lShaped, lShapedExtension, singleSeat, unidentified), `TableType` (coffee, dining, unidentified), `TableShapeType` (rectangular, circularElliptic, lShaped, unidentified), `StorageType` (cabinet, shelf). |
| `Section` (iOS 17) | `label` (livingRoom, bedroom, bathroom, kitchen, diningRoom, unidentified), `center: simd_float3`, `story`. |

**`dimensions`** is the full extent of the element's bounding box, in its local frame, centered on `transform`:

- Walls are (length, height, 0).
- Objects are (width, height, depth).
- Columns 0–2 of the transform are the local right, up, and depth axes; column 3 is the position. This comes from an Apple answer quoted in the forums. **[unverified]**
- Corollary: an object's transform marks the **center** of its box, not the floor contact point.

### Coordinate frame

**Answer:** the transforms are in the ARSession world frame. Apple implies this strongly but never says it in one sentence. The evidence:

- **WWDC23 10192:** separate scans "are all in their own coordinate system". With a continuous ARSession, "all the CapturedRooms are in the same 3D world space."
- **Apple's multi-room article:** "each `RoomCaptureSession` needs to share the same common coordinate space as the `ARSession`".
- **An Apple engineer in forum thread 849873 (about Oct 2026):** `stop(pauseARSession: false)` "keeps your scan results in the same world coordinate space as the running session".
- **ARKit's `.gravity` world alignment:** "y-axis is parallel to gravity", the origin is the device's start position, and the camera initially faces −Z. Units are meters.

**Caveats:**

- **The final room can be shifted.** The same Apple engineer (thread 849873) warned that "processed positions can sometimes differ" between the live `didUpdate` results and the final `RoomBuilder` result. One developer saw the whole room shifted. Apple's advice is to drop an `ARAnchor` at each wall. **[unverified]** (forum thread)
- **Multi-room merges move rooms.** With `StructureBuilder` / `CapturedStructure` (iOS 17), the world origin can move between rooms, and earlier rooms get repositioned (threads 763244 and 760952). Stick to **one room per session**.

### Getting at the ARSession and ARFrames

| API | Since | Notes |
|---|---|---|
| `RoomCaptureSession.arSession` | iOS 16 | "You may use this object to display your own AR experience." |
| `RoomCaptureSession(arSession:)`, `RoomCaptureView(frame:arSession:)` | iOS 17 | WWDC23: "Any custom ARSession with ARWorldTrackingConfiguration will be honored inside RoomCaptureSession." Apple names "high-quality image capture from ARKit" as a use case. |
| `stop(pauseARSession: false)` | iOS 17 | Keeps the ARSession, and its world frame, running after the scan ends. |
| `ARSession.captureHighResolutionFrame(...)` | iOS 16; iOS 26 adds an `AVCapturePhotoSettings` variant | Optional sharper keyframes. |

**Practical notes.** These come from forum threads 728601, 763400, 808834, and 713409, dated 2022–2025. **[unverified]**

- **What works:** developers set `arSession.delegate = self` and do receive `ARFrame`s. `capturedImage`, `camera.transform`, `camera.intrinsics`, and `camera.imageResolution` are all available.
- **`sceneDepth` is often nil once RoomPlan starts.** A workaround from Polycam's developer is to re-run a world-tracking configuration with `sceneDepth` enabled after `didStart`. Apple has not confirmed this, and a Dec 2025 report is unanswered.
- **No mesh during the scan.** "RoomPlan owns the underlying ARKit session... The configuration only enables scene depth, not scene reconstruction." Don't expect a `sceneReconstruction` mesh during the scan. You can run your own `.mesh` configuration on the same session after `stop(pauseARSession: false)`.
- **Copy pixel buffers; don't hold on to `ARFrame` objects.** If you retain them, ARKit starts dropping frames.
- **iOS 26 debug builds:** builds run from the Xcode debugger showed a corrupted green and purple camera feed. TestFlight builds were fine (thread 801252, Sep 2025). **[unverified]**

### Export options

- **`export(to:exportOptions:)` to USDZ.** `USDExportOptions` has three options:
  - `.parametric`: unit cubes scaled into planes or boxes. Only this option keeps elements resizable.
  - `.mesh`: the default. Walls get door and window cutouts.
  - `.model`: substitutes your own USD models. It needs iOS 17's `export(to:metadataURL:modelProvider:exportOptions:)`.
  - `metadataURL` writes a map from USD node name to `CapturedRoom` UUID.
  - Before iOS 17.4, the filename must not start with a digit.
- **The USDZ is untextured.** It contains flat default materials and no photo data. In Apple's own WWDC23 10274 workflow, a designer adds textures afterwards in a DCC tool.
- **JSON:** `CapturedRoom` is `Codable`. Apple's sample writes `Room.json` with `JSONEncoder`. **Use this for the web editor** instead of parsing USDZ.
  - `simd_float4x4` is column-major, and so is `THREE.Matrix4.fromArray`.
  - The exact JSON layout (flat array or nested columns) is not documented. Check it on a real export.
- **`CapturedRoomData`** is `Codable` but opaque. `RoomBuilder(options: [.beautifyObjects]).capturedRoom(from:)` (async) turns it into a `CapturedRoom`.
- Mac Catalyst can decode and export rooms but cannot scan.

### Requirements

- iOS/iPadOS 16+ for basic scanning. **iOS 17+** for a custom ARSession, `floors`, sections, attributes, and `stop(pauseARSession:)`.
- `RoomCaptureSession.isSupported` "is `true` if the device contains a LiDAR Scanner": iPhone 12 Pro or later Pro models, and LiDAR iPads.
- Info.plist must include `NSCameraUsageDescription`.
- Limits (WWDC22) **[older]**:
  - Rooms up to about 30 × 30 ft.
  - At least 50 lux of light.
  - "Avoid… single long scans over 5 minutes."
  - Errors include `exceedSceneSizeLimit` and `deviceTooHot`.

### How much code

- **Apple's sample**, "Create a 3D model of an interior room by guiding the user through an AR experience", has **196 Swift lines** in total, in UIKit with storyboards. `RoomCaptureViewController` accounts for 133 of them.
  - The essential core is about 25 lines: `RoomCaptureView(frame:)`, `captureSession.run(configuration:)`, `stop()`, the `captureView(didPresent:)` callback, and `export` plus a JSON encode.
- **A SwiftUI version** with a `UIViewRepresentable` and a coordinator: about 60–100 lines, 1–2 hours of work. **[est.]**
- **Recording frames** (ARSession delegate, keyframe selection, JPEG writing, `transforms.json`, zip, share sheet) adds about 150–250 lines. **[est.]**

### Implication for our hackathon

**Use RoomPlan only as the semantic layer.** It answers "where is the chair, how big is it, where are the walls". It provides no visuals.

- Build the capture app on iOS 17+ with **one custom `ARSession` shared by RoomPlan and our frame recorder**. The splat then lands in the same metric, Y-up frame as `room.json`, so editor objects line up with no manual alignment.
- Don't count on LiDAR depth during the scan.
- Spike-test whether the final `CapturedRoom` is shifted relative to the live poses.

### Sources

- https://developer.apple.com/documentation/roomplan/capturedroom
- https://developer.apple.com/documentation/roomplan/capturedroom/surface
- https://developer.apple.com/documentation/roomplan/captured-object-attributes
- https://developer.apple.com/documentation/roomplan/roomcapturesession
- https://developer.apple.com/documentation/roomplan/capturedroom/usdexportoptions
- https://developer.apple.com/documentation/roomplan/scanning-the-rooms-of-a-single-structure
- https://developer.apple.com/documentation/roomplan/create-a-3d-model-of-an-interior-room-by-guiding-the-user-through-an-ar-experience
- https://developer.apple.com/videos/play/wwdc2022/10127/ **[older]**
- https://developer.apple.com/videos/play/wwdc2023/10192/ **[older]**
- https://developer.apple.com/videos/play/wwdc2023/10274/ **[older]**
- https://developer.apple.com/documentation/arkit/arconfiguration/worldalignment/gravity
- Apple Developer Forums threads 849873, 787628, 763400, 808834, 728601, 713409, 763244, 760952, and 801252, each at https://developer.apple.com/forums/thread/NNNNNN **[unverified]**
- https://github.com/jmousseau/RoomObjectReplicator, which uses `object.transform` directly as an `ARAnchor` transform **[older]**
- Local SDK: `Xcode.app/.../iPhoneOS26.5.sdk/System/Library/Frameworks/RoomPlan.framework/Modules/RoomPlan.swiftmodule/arm64e-apple-ios.swiftinterface`

---

## 2. Gaussian splat training from iPhone captures

### Direct answer

- **On the M3 Pro:** use **Brush** (GUI or CLI; reads `transforms.json`; keeps your coordinates) or **msplat** (the fastest on Metal, but only a few months old).
- **In the cloud:** use **nerfstudio splatfacto** from the official Docker image, or **gsplat `simple_trainer`** on an L4, A10G, or A100.
- **Input:** all of them accept COLMAP, and most accept nerfstudio `transforms.json`.
- **Converters:** nerfstudio's `record3d` and `polycam` converters use the app's ARKit poses directly, with no COLMAP.
- **Raw ARKit poses:** usable, with some blur. Pose refinement (splatfacto `SO3xR3`) recovers part of the gap.
- **Biggest pitfall:** the trainer's default world normalization.

### 2a. Trainers on Apple Silicon

| Trainer | Status (checked today) | Inputs | Notes |
|---|---|---|---|
| **Brush** (ArthurBrussee/brush) | Latest tag **v0.3.0, 2025-09-14** (verified). Main is very active (commits 2026-10-03). | COLMAP; nerfstudio `transforms.json`; RealityCapture CSV; a `.zip` of any of these. | macOS, Windows, Linux, and Android via wgpu/Burn; a browser build needs Chrome 134+. GUI or `brush` CLI (`--with-viewer`). Defaults: 30k iterations, max 10M splats, `--max-resolution 1920`. Reads optional `ply_file_path`, otherwise uses random init. **No re-centering or normalization.** No pose optimization. PLY export. Main had macOS regressions in Sep 2026 (#533, #531), so **use the v0.3.0 binary**. Memory spikes at 1920 px (#211), so use `--max-resolution 1440`. |
| **msplat** (rayanht/msplat) | **1.1.4, 2026-08-25** on PyPI (verified). Repo created 2026-03; 97 stars. | COLMAP, nerfstudio, Polycam. | `pip install msplat[cli]`, then `msplat-train <dataset> -n 30000`. Needs Python 3.12+ and macOS 14+. M4 Max benchmark: garden scene, 30k steps in **700 s**, 3.51M Gaussians, 27.14 PSNR. Normalization and init behavior not documented, so test them. |
| **OpenSplat** (pierotofy/OpenSplat) | v1.2.2, 2026-09-16 (from the agent; not re-verified because the GitHub API was rate-limited). | COLMAP, nerfstudio, ODM/OpenSfM/OpenMVG. | Metal via MPS. **Requires init points** ("random initialization is not supported"). **Auto-centers and scales the scene**, so exports are not metric. Brew build pulls in PyTorch. |
| Laan Labs "3D Splat App" | v0.3.1, Sep 2026 (App Store). | Images, COLMAP, nerfstudio, video. | Free Mac app (M1 or newer). Exports PLY, SPZ, SOG, and compressed PLY. **[unverified]** quality |
| Not on Mac | — | — | **gsplat, nerfstudio splatfacto**: CUDA-only. A gsplat MPS PR (#832) was closed unmerged. **LichtFeld Studio**: CUDA 12.8+ only. **Postshot**: Windows and NVIDIA only. |

**Rough 30k-step times for a room** (about 300 images at about 1.5k px, 1–3M splats):

| Setup | Time |
|---|---|
| A100, gsplat | **~19 min** (3.2M splats, 5.6 GB VRAM); MCMC capped at 1M splats: 15.4 min (gsplat eval page) |
| A100, original 3DGS | 26 min |
| H100 | ~10–15 min **[est.]** |
| A10G or L4 | ~25–45 min **[est.]** |
| M3 Pro, msplat | ~25–45 min **[est.]** (from the M4 Max figure) |
| M3 Pro, Brush | ~1–2.5 h **[est.]** (one report: about 3.4 h on a fanless MacBook Air **[unverified]**) |
| M3 Air | About 2× the M3 Pro time, and it throttles. Use it for development, not training. |

A 7k-step preview takes roughly a quarter of the 30k time, and it is usually good enough for a demo.

### 2b. Cloud NVIDIA trainers

- **Nerfstudio Docker (fastest to stand up):** `docker pull ghcr.io/nerfstudio-project/nerfstudio:latest`, then `docker run --gpus all --shm-size=12gb …`.
  - The image ships CUDA 11.8, torch 2.1.2, COLMAP 3.9.1 with CUDA, and `gsplat==1.4.0`. It is built for sm_61 through sm_90, which covers the T4, A10, L4, A100, and H100.
  - Train with `ns-train splatfacto --data <dir>` (about 6 GB VRAM) or `splatfacto-big` (about 12 GB).
  - Export with `ns-export gaussian-splat --load-config … --output-dir …`.
  - **Nerfstudio itself is stale**: the last release was 1.1.5 on 2024-11-11 (verified on PyPI). The Docker image still works.
- **gsplat:** 1.5.3, 2025-07-04 (verified on PyPI).
  - Prebuilt wheels are Linux cp310 only: `pip install gsplat --index-url https://docs.gsplat.studio/whl/pt24cu124`.
  - Train with `python examples/simple_trainer.py default|mcmc --data_dir <colmap> --data_factor 2 --result_dir out --save_ply`. Check out the examples at tag v1.5.3 so they match the wheel.
  - Input is **COLMAP only**.
  - Defaults: `pose_opt=False`, `normalize_world_space=True`.
  - Claims "up to 4x less GPU memory" and "up to 15% less time" than the original implementation.
- **Original graphdeco-inria 3DGS:** wants 24 GB VRAM for paper quality, and its license is non-commercial. **[older]**
- **GPU quota:** new AWS and Azure accounts usually start with **0 GPU quota**. The companion doc confirms this for Azure. Request quota in hour 0; approval is not instant.

### 2c. Input formats

| Trainer | COLMAP (bin/txt) | nerfstudio `transforms.json` | Other |
|---|---|---|---|
| splatfacto | Yes | Yes | Outputs of all `ns-process-data` converters |
| gsplat `simple_trainer` | Yes | No | Reads `points3D` unconditionally |
| graphdeco 3DGS | Yes | Synthetic only | — |
| Brush | Yes | Yes | RealityCapture CSV, zip |
| OpenSplat | Yes | Yes (needs `ply_file_path`) | ODM, OpenSfM, OpenMVG |
| msplat | Yes | Yes | Polycam |

**`transforms.json` fields** (from nerfstudio's `nerfstudio_dataparser.py`):

- **Intrinsics,** global or per frame: `fl_x`, `fl_y`, `cx`, `cy`, `w`, `h`, `camera_model` (e.g. `OPENCV`), and distortion `k1`–`k4`, `p1`, `p2`.
- **Per frame:** `frames[].file_path` and `frames[].transform_matrix`, a 4×4 camera-to-world matrix. Optional `depth_file_path` and `mask_path`.
- **Top level:** optional `ply_file_path` for init points, plus `applied_transform`.
- **Without init points**, splatfacto warns and uses 50k random points in a cube.
- **Depth units:** `depth_unit_scale_factor` defaults to 1e-3, so depth images are read as millimeters.

### 2d. Converters from ARKit captures

- **`ns-process-data record3d --data <EXR+JPG export> [--ply <dir>]`.** Docs: Record3D "uses the LiDAR sensor to compute camera poses, so COLMAP is not needed."
  - Defaults: `max_dataset_size=300`.
  - With `--ply`, it merges the LiDAR clouds into `sparse_pc.ply` for init.
  - It ignores the metadata principal point and uses W/2, H/2 instead.
- **`ns-process-data polycam`.** Docs: "COLMAP is not used… poses are globally optimized which make them more robust to drift."
  - Input is Polycam's Developer Mode "Raw Data" zip. It must be enabled **before** capturing, and the zip must be exported from the capturing device.
  - It uses `corrected_cameras` and depth if present. It writes `point_cloud.ply` from `raw.glb` for init.
- **Other subcommands:** `metashape`, `realitycapture`, `odm`, `aria`, `images`, `video`.
  - **Pitfall:** `images` and `video` call COLMAP with flags that COLMAP 3.13+ renamed (nerfstudio issue #3733). Homebrew ships COLMAP 4.2.1, so these break on the Mac. Use the Docker image's COLMAP 3.9.1.
- **Other capture apps with poses:**
  - Stray Scanner: free, MIT; `odometry.csv` plus `camera_matrix.csv`; 256×192 depth in mm.
  - Spectacular AI: `sai-cli`.
  - SplatKing: a free iOS app that writes a COLMAP model from LiDAR captures on the phone. **[unverified]**
  - NeRFCapture: abandoned in 2023. **[older]**
- **Writing your own:** none of these needs a converter if our app writes `transforms.json` itself. See 2f.

### 2e. Do raw ARKit poses work?

**Yes, but expect some softness.** The best evidence is arXiv 2608.21008 (2026, single author, not peer-reviewed). **[unverified]**

- ARKit poses on ScanNet++ iPhone rooms have about 0.55° and 19 mm mean error.
- 3DGS PSNR on MobileBrick: ARKit poses 16.55, COLMAP bundle adjustment seeded from ARKit 17.71, ground truth 18.29. Refinement recovers about one half to two thirds of the gap.
- Classic COLMAP triangulation plus prior-seeded bundle adjustment made **room** poses slightly *worse* in 15 of 15 scenes.

**Mitigations, in order of effort:**

1. **Keyframe selection.** Skip blurry frames, and keep about one frame per 10–15 cm or 10° of motion.
2. **In-training pose refinement.** splatfacto: `--pipeline.model.camera-optimizer.mode SO3xR3` (default off; "If enabled, we recommend SO3xR3"). gsplat: `--pose_opt`. **Brush and OpenSplat have none.**
3. **Init points from COLMAP, poses from ARKit.** Follow the COLMAP FAQ's "known poses" recipe: write `cameras.txt` and `images.txt` with an empty `points3D.txt`, then run `feature_extractor`, a matcher, and `point_triangulator`.
   - COLMAP 4.x also has `pose_prior_mapper` and `global_mapper`. GLOMAP has been merged into COLMAP.
   - Time for 300 images on an M3 Pro with CPU SIFT and sequential matching: about 5–15 min **[est.]**.

### 2f. Coordinate-convention pitfalls

| Frame | Camera axes | World | Pose stored as |
|---|---|---|---|
| ARKit (`ARCamera.transform`) | +X right (in the landscape sensor image), +Y up, **looks down −Z** (OpenGL) | `.gravity`: +Y up, meters, origin at session start | camera-to-world `simd_float4x4`, column-major |
| nerfstudio `transforms.json` | OpenGL/Blender: +X right, +Y up, +Z back | Its viewer assumes +Z up, which is only cosmetic | camera-to-world 4×4, row-major nested list |
| COLMAP `images.txt` | OpenCV: +X right, **+Y down, +Z forward** | arbitrary | **world-to-camera**: `QW QX QY QZ TX TY TZ` |
| three.js and Spark | +Y up | +Y up, units as given | `Matrix4.fromArray` takes a column-major array |
| SPZ (Niantic) | — | stored as RUB (right, up, back) by default; the README notes that PLYs are usually RDF | — |

**Concrete rules:**

1. **ARKit to nerfstudio needs no axis flip.** `ARCamera.transform` goes straight into `transform_matrix`. Write it row by row: row `r` is `[c.columns.0[r], c.columns.1[r], c.columns.2[r], c.columns.3[r]]`.
2. **ARKit to COLMAP:** compute `c2w_cv = c2w_arkit · diag(1, −1, −1, 1)`, invert it to get world-to-camera, then convert R to a Hamilton quaternion (w first).
3. **Intrinsics:** `camera.intrinsics` is a column-major `simd_float3x3` in pixels for the **landscape** `capturedImage`:
   - `fl_x = K.columns.0.x`, `fl_y = K.columns.1.y`
   - `cx = K.columns.2.x`, `cy = K.columns.2.y`
   - `w` and `h` come from `camera.imageResolution`.
   - **Save images in landscape sensor orientation.** If you rotate them to portrait, you must also swap fx and fy, remap cx and cy, and rotate the pose.
4. **When resizing images,** scale `fl_x` and `cx` by w′/w, and `fl_y` and `cy` by h′/h.
5. **`capturedImage` is YCbCr (biplanar 420f).** Convert it to RGB before writing JPEGs; `CIImage` → `CIContext.jpegRepresentation` does it.
6. **Normalization breaks the metric frame:**
   - **Nerfstudio** defaults to `orientation_method="up"`, `center_method="poses"`, and `auto_scale_poses=True`. The transform is saved to `dataparser_transforms.json`. **`ns-export gaussian-splat` does not undo it.** Disable all three: `ns-train splatfacto … nerfstudio-data --orientation-method none --center-method none --auto-scale-poses False`.
   - **gsplat** defaults to `normalize_world_space=True`, which applies a similarity transform, a PCA axis alignment, and an optional flip. Disable it, or invert `parser.transform` on the exported PLY.
   - **OpenSplat** always normalizes.
   - **Brush** keeps the dataset's frame.
7. **Format conversion may flip axes.** Many viewers and SuperSplat assume COLMAP-style RDF PLYs and rotate them 180° about X or Z. A splat trained in the ARKit frame is already Y-up and needs **no** rotation in three.js. Re-check orientation after every format conversion (PLY → SPZ/SOG).
8. **Init points without LiDAR depth:**
   - Option 1: accumulate `ARFrame.rawFeaturePoints` (ARKit's sparse feature points, already in world coordinates) into a PLY and point `ply_file_path` at it. Not tested by anyone we found. **[est.]**
   - Option 2: random init, which Brush and splatfacto support.
   - Option 3: COLMAP's `point_triangulator` (2e, step 3).

### Implication for our hackathon

**Have the iOS app write `images/*.jpg` plus `transforms.json` (ARKit c2w, landscape intrinsics) directly**, in the same ARSession as RoomPlan.

- **Training:** start with Brush v0.3.0 on the M3 Pro, because it keeps the frame and has a GUI. Use msplat for speed if it keeps the frame too. Use cloud splatfacto (SO3xR3, normalization off) if GPU quota arrives in time.
- **Defaults:** never accept a trainer's default normalization.

### Sources

- https://github.com/ArthurBrussee/brush (README, releases API, `crates/brush-dataset/src/formats/nerfstudio.rs`, issues #211, #531, #533)
- https://github.com/rayanht/msplat and https://pypi.org/project/msplat/
- https://github.com/pierotofy/OpenSplat
- https://github.com/nerfstudio-project/gsplat, https://docs.gsplat.studio/main/tests/eval.html, https://docs.gsplat.studio/whl/gsplat/
- https://docs.nerf.studio/quickstart/installation.html, https://docs.nerf.studio/nerfology/methods/splat.html, https://docs.nerf.studio/quickstart/custom_dataset.html, https://docs.nerf.studio/quickstart/data_conventions.html, and nerfstudio issue #3733
- https://colmap.github.io/format.html, https://colmap.github.io/faq.html, https://colmap.github.io/cli.html
- https://developer.apple.com/documentation/arkit/arcamera/transform
- https://arxiv.org/html/2608.21008 **[unverified]** (preprint)
- https://www.jawset.com/ (Postshot) and the LichtFeld Studio README (https://github.com/MrNeRF/LichtFeld-Studio)
- https://apps.apple.com/us/app/3d-splat-app/id6760239941
- https://radiancefields.com/i-tried-to-make-gaussian-splatting-1-000×-faster **[unverified]**

---

## 3. Off-the-shelf capture apps

### Direct answer

- **Scaniverse (Classic mode)** trains splats on the phone, for free, without limits, and exports PLY, SPZ, and meshes.
- **Polycam** splats need a paid plan, and splat PLY export needs Business. Its free tier still gives a textured GLTF mesh from LiDAR and a raw images, poses, and depth export.
- **Luma** is not usable for new captures.
- **KIRI** splats are Pro-only and processed in the cloud. Its LiDAR mesh mode is free.
- **3D Scanner App** has a new seller and subscription pricing.
- **Scale and gravity:** exports are metric where advertised. No vendor documents the up-axis of exported splats.

| App (status, 2026) | Splat export | Textured mesh export | Where it trains | Metric / gravity | Raw poses export |
|---|---|---|---|---|---|
| **Scaniverse**, Niantic Spatial, v5.2.8 (2026-09-17) | **PLY and SPZ, free** in Classic | OBJ, FBX, GLB (free); USDZ on Plus ($20/mo) | **On the phone** (Classic), about 90 s **[unverified]**; the "New" mode is cloud and costs credits | Free tier advertises "metric scale"; up-axis not documented | No |
| **Polycam** (Free / Basic $150/yr / Business $400/yr) | Creating splats needs Basic+ (≤300 images); **"Splat PLY" export needs Business+** | Free: **GLTF only**; Basic adds OBJ, FBX, USDZ, STL, DAE | Cloud, a few minutes to an hour | LiDAR mesh about ±½" accurate; **splat and mesh frames differ**: Polycam's Unity guide rotates a splat capture's *own* mesh export 180° about Y and scales it ×100 to match the splat. Splats come only from Object Mode captures or uploads, never from Space Mode (see `polycam-business.md`). | **Yes, free**: Developer Mode Raw Data (JPG keyframes, camera JSON with fx/fy/cx/cy and pose, depth plus confidence, `yAlignmentRotation`) |
| **Luma 3D Capture** v1.3.14 (Jan 2026) | Legacy exports only | Legacy only | Cloud uploads paused since Nov 2024 **[unverified]** | — | No |
| **KIRI Engine** (Basic free / Pro $79.99/yr) | PLY, **Pro only** | LiDAR "Scene Scan": OBJ and USDZ, **free**, processed on the phone; 3DGS→mesh is Pro | Splats in the cloud | USDZ is real scale | Developer Mode "Camera pose" (nerfstudio-ready) |
| **3D Scanner App** (seller now "AI Photo Editor Lab SRL") | None (the separate free Mac "3D Splat App" trains splats) | USDZ, OBJ, GLTF, GLB, DAE, STL, plus point clouds; **now subscription** ($2.99/wk–$69.99/yr) | Mesh on the phone | "Y-Axis pointed in the up direction… meters" **[older]** (2023 docs) | "All Data" export; schema not verified |
| Record3D ($4–5) | — | glTF, FBX, OBJ, PLY sequences | — | ARKit | Yes: EXR + JPG, `ns-process-data record3d` |
| Stray Scanner (free, MIT, iOS 18.6+) | — | — | — | ARKit | Yes: RGB, depth, poses, intrinsics |
| Scantic (Aug 2026) | Free PLY is "standard quality" (thinned); full quality €29.99/yr | — | On the phone, under 1 min | — | — **[unverified]** |

**Notes:**

- **Scaniverse ownership:** Niantic's games business went to Scopely (closed May 29, 2025). Scaniverse stayed with **Niantic Spatial**, and scaniverse.com now redirects to nianticspatial.com.
  - The pricing page's free tier lists "metric scale, Gaussian splats, meshes, VPS maps, FBX, SPZ and PLY export".
  - Commercial or resale use needs Pro ($50/mo). A hackathon demo should be fine, but read the terms.
- **SPZ** is MIT-licensed, about 10× smaller than PLY, and v4 uses ZSTD. Spark loads it natively.
- **Polycam's free Developer Mode** gives poses that "are globally optimized" plus LiDAR depth. That is better pose input than raw ARKit, with no Swift code. It has no RoomPlan objects, however; Polycam's "Floorplan Mode" uses its own pipeline.

### Implication for our hackathon

**Scan the venue room with Scaniverse Classic in hour 0.** It costs about 5 minutes and gives a free, on-phone splat (PLY or SPZ) that the web half of the team can build against right away. It is also the demo fallback if our own capture pipeline fails.

- Determine its up-axis with one test load in Spark.
- Its frame will **not** match a separate RoomPlan scan. Alignment would need a manual gizmo or a 3-point align.

### Sources

- https://apps.apple.com/us/app/scaniverse-3d-scanner/id1541433223, https://nianticspatial.com/pricing, https://www.nianticspatial.com/docs/scaniverse/quickstart, https://www.nianticspatial.com/docs/scaniverse/advanced_tools/, https://github.com/nianticlabs/spz
- https://poly.cam/pricing, plus learn.poly.cam help center articles: exports by tier https://learn.poly.cam/hc/en-us/articles/27756102599572, splats https://learn.poly.cam/hc/en-us/articles/27425185907348, Space Mode https://learn.poly.cam/hc/en-us/articles/36655587097620, Developer Mode https://learn.poly.cam/hc/en-us/articles/34295907278996, raw data format https://learn.poly.cam/hc/en-us/articles/38276871185044, accuracy https://learn.poly.cam/hc/en-us/articles/50434745985556
- https://apps.apple.com/us/app/luma-3d-capture/id1615849914 and https://radiancefields.com/radiance-field-uploads-suspended-on-luma-ai **[unverified]**
- https://www.kiriengine.app/pricing, https://www.kiriengine.app/blog/kiri-engine-basic-vs-pro, https://www.kiriengine.app/features/export-formats, https://www.kiriengine.app/blog/iphone-lidar-scene-scan-guide
- https://apps.apple.com/us/app/3d-scanner-app/id1419913995 and https://docs.3dscannerapp.com/faq **[older]**
- https://apps.apple.com/us/app/record3d-3d-videos/id1477716895, https://github.com/strayrobots/scanner, https://www.cgchannel.com/2026/08/scantic-trains-gaussian-splats-entirely-on-your-phone/

---

## 4. Web splat rendering

### Direct answer

**Use Spark** for a three.js or R3F editor.

- It is the only maintained three.js-native renderer that composites correctly with opaque meshes **and** ships region-edit primitives.
- It is very active: version 2.3.1 came out 2026-10-01 (verified on npm), and 2.0 shipped on 2026-04-14.
- PlayCanvas with SuperSplat is the strongest alternative, but it means leaving three.js.
- mkkellogg's GaussianSplats3D is no longer developed.

### 4a. Spark (`@sparkjsdev/spark`, World Labs, MIT)

**Integration**

- **Classes:** `SplatMesh` extends `SplatGenerator`, which extends `THREE.Object3D`, so it is not a `THREE.Mesh`.
- **Spark 2.x requires a `SparkRenderer`:** create `new SparkRenderer({ renderer })` and add it to the scene, or no splats render. Use `antialias: false` on the `WebGLRenderer`.
- **Rendering API:** WebGL2 only; Spark has no WebGPU path.
- **Peer dependency:** three ≥ 0.180.0 (verified).

**R3F**

- The official example is https://github.com/sparkjsdev/spark-react-r3f (plus Next.js and React Router variants). It registers `SparkRenderer` and `SplatMesh` with R3F's `extend()`. It then renders a `SparkRenderer` element with `args={[{ renderer: gl }]}`, where `gl` comes from `useThree`, and puts a `SplatMesh` element with `args={[{ url }]}` inside it.
- **These examples are stale.** They pin Spark ^0.1.6 and three ^0.178, and the last commit was July 2025. Bump the versions yourself.
- **Use Vite.** The README warns that Webpack does not resolve Spark's WASM URL, which matters for Next.js.

**Formats**

- Loads `.ply` (including compressed PLY), `.spz`, `.splat`, `.ksplat`, `.sog` / `.zip` (SOGS), and `.rad`, Spark 2.0's LoD and streaming format.
- `.splat` and `.ksplat` may need an explicit `fileType`.
- A remote SOGS `manifest.json` is no longer supported.

**LoD (Spark 2.0)**

- With LoD on, Spark renders a fixed per-frame splat budget.
  - Quick route: `new SplatMesh({ url, lod: true })` builds the LoD in a worker at about 1–3 s per 1M splats.
  - Better route: pre-build with `npm run build-lod -- file.ply --quality`, then load the `.rad` file, optionally with `paged: true` to stream it.
- Default budgets, from the source: **iOS 1.5M**, Android 1M, Quest 500K, Vision Pro 750K, desktop 2.5M. Scale them with `lodSplatScale`.

**Compositing with meshes**

- The `SparkRenderer` material defaults to `depthTest: true` ("the splats respect the Z depth buffer and blend with other opaque objects"), `depthWrite: false`, `transparent: true`, and `premultipliedAlpha: true`.
- So **an opaque GLB chair occludes splats behind it, and splats in front of it blend over it.**
- **Caveats:**
  - Transparent meshes, such as glass, do not sort against individual splats.
  - The sort lags the render by about one frame.
- **Matching the room's lighting:** `spark.renderEnvMap({ scene, worldCenter })` renders a pre-filtered environment map from the splats. Apply it to `MeshStandardMaterial`s, e.g. with `recurseSetEnvMap`, and catalog GLBs pick up the room's lighting.

**Editing primitives** (from docs and `src/SplatEdit.ts`)

- **`SplatEdit`** options: `{ name, rgbaBlendMode, sdfSmooth, softEdge, invert, sdfs }`. `softEdge` and `sdfSmooth` are in world units.
- **`SplatEditSdf`** extends `THREE.Object3D`. Options: `{ type, invert, opacity, color, displace, radius }`.
  - Box and ellipsoid size come from the object's **`scale`**; `radius` rounds the corners.
  - Whether `scale` means full size or half-extents is **[unverified]**. Check it, and pad by 5–10 cm.
- **`SplatEditSdfType`:** `ALL`, `PLANE`, `SPHERE`, `BOX`, `ELLIPSOID`, `CYLINDER`, `CAPSULE`, `INFINITE_CONE`.
- **`SplatEditRgbaBlendMode`:** `MULTIPLY` (the default), `SET_RGB`, `ADD_RGBA`.
- **Hide or delete a region:** docs: "Using MULTIPLY with opacity=0 can be used to delete splats from a region of space."
- **Recolor:**
  - `SET_RGB` replaces color and loses shading.
  - `MULTIPLY` with a color tints.
  - `SplatMesh.recolor` and `.opacity` affect a whole mesh.
  - For a recolor that **keeps shading**, copy the dyno brush from the official **Splat Painter** example. It scales the new color by the ratio of old to new luminance.
- **Attaching edits:** add the edit as a child of a `SplatMesh`, or apply it to every `editable` mesh. Edits apply live, and their number is not capped.
- **Custom per-splat logic:** `dyno` shader graphs via `SplatMesh.objectModifiers` / `worldModifiers`, then `updateGenerator()`.

**Saving edits permanently**

- `PackedSplats.getSplat`, `setSplat`, `pushSplat`, and `forEachSplat` give per-splat access.
- `writeSpz(packedSplats)` returns SPZ bytes. `transcodeSpz({ inputs, clipXyz, opacityThreshold })` merges files and clips them to a box.
- There is no delete call. To delete, rebuild a `PackedSplats` without the unwanted splats.
- **For the hackathon, save edits as a JSON scene description** (edit boxes, colors, GLB transforms) instead of baking them into the splat.

**Raycasting**

- `THREE.Raycaster` works against `SplatMesh` (`raycastable`, `minRaycastOpacity` = 0.2), but it is "synchronous and WebAssembly-based". Against millions of splats it "ha[s] a noticeable delay". Call it on click only.
- It returns a point, not an object ID.
- Whether hidden (edited-out) splats are skipped is **[unverified]**.

**Performance**

- Spark reads distances back from the GPU and bucket-sorts them in a worker.
- Spark's performance page gives "iPhone: 1-3 million splats" and "Computer: 1-5 million".
- `maxStdDev` defaults to √8; √5 is suggested for VR or speed.
- Cap the device pixel ratio at about 1.5 on phones.

### 4b. mkkellogg GaussianSplats3D

The README says: "⚠️ … this repo is no longer in active development". It recommends Spark.

- Last release: v0.4.7 on 2025-01-25. **[older]**
- `DropInViewer` mixes with meshes "only for objects that write to the depth buffer".
- `sharedMemoryForWorkers` defaults to true and needs COOP/COEP headers.
- The README lists "sub-optimal performance on mobile devices" as a known issue.
- **Do not pick it.**

### 4c. PlayCanvas, SuperSplat, and splat-transform

- **PlayCanvas engine:** v2.23.3 (2026-10-15).
  - It uses a GPU sort on WebGPU and a worker sort on WebGL2.
  - `app.scene.gsplat.splatBudget` "defaults to 1 million splats", with guidance of "1 million for mobile, 3+ million for desktop".
  - Supports streamed SOG LoD and ID-buffer picking (`pc.Picker`, `getSelectionAsync`).
  - SOG files are about 15–20× smaller than PLY.
  - **@playcanvas/react** v0.11.7 (`useSplat`, `<GSplat>`) is not three.js, so R3F and drei skills don't carry over.
- **SuperSplat** (MIT, v3.5.2, 2026-10-05) is the best **offline cleanup tool**.
  - It runs in the browser or self-hosted (`npm run develop`).
  - Selection tools: rect, brush, polygon, lasso, sphere, box, flood, and eyedropper.
  - Operations: delete, invert, **Separate** (the selection becomes its own splat), and duplicate.
  - Exports: PLY, compressed PLY, SOG, SPZ, splat, and an HTML viewer.
  - The installed editor needs a WebGPU browser.
- **splat-transform** (`@playcanvas/splat-transform` v3.10.1) is a CLI.
  - **Reads:** PLY, compressed PLY, SOG, SPZ, splat, ksplat, LCC.
  - **Writes:** PLY, compressed PLY, SOG and streamed-SOG LoD, SPZ, and GLB (`KHR_gaussian_splatting`).
  - **Actions:** translate, rotate, and scale (`-t`, `-r`, `-s`); filters for box, sphere, NaN, value, and SH bands (`-B`, `-S`, `-N`, `-V`, `-H`); floater and cluster cleanup (`-F`, `-C`); and **decimation** (`-d`).
  - **Use it to crop the room, remove floaters, and decimate to about 1M splats.**

### 4d. Others

| Option | Status |
|---|---|
| three.js core | **r186 (2026-09-24, verified)** added a TSL/WebGPURenderer Gaussian splat renderer (`GaussianSplat`, `SPZLoader`, a PLY loader, a glTF extension). It is three weeks old, has no edit primitives, and does not mix with Spark's WebGLRenderer. Avoid it for this build. |
| Babylon.js | Capable (PLY, SPZ, SOG, picking, streamed LoD), but not three.js. |
| luma-web | Archived April 2025. Dead. |
| antimatter15/splat, gsplat.js | Viewer only, or dormant. |
| Apple RealityKit `GaussianSplatComponent` | Announced at WWDC26 (session 279). Native splat rendering on iOS, macOS, and visionOS 27. Not relevant for a web editor. **[unverified]** details |

### 4e. iPhone Safari performance

- **WebGPU:** "WebGPU is now shipping in Safari 26.0 for macOS, iOS, iPadOS, and visionOS". This matters for PlayCanvas's GPU sort and three.js r186, **not** for Spark, which uses WebGL2.
- **Published budgets:** Spark gives "iPhone: 1-3 million splats" and a 1.5M iOS LoD default. PlayCanvas gives 1M for mobile. No vendor publishes iPhone FPS figures.
- **Target:** about **1M rendered splats on iPhone**, 1.5M at most. Desktop can render 2–3M.
- **Two ways to hit it:**
  - (a) Pre-build a `.rad` LoD and keep Spark's iOS budget.
  - (b) Decimate to about 1M with `splat-transform -d`, and strip higher spherical-harmonic bands (`-H`) to save memory and bandwidth.

### Implication for our hackathon

**Stack:** Vite + React + R3F + Spark 2.3.1 + three ≥ 0.180. Use SuperSplat and splat-transform offline for cleanup and decimation.

Editor features map to Spark like this:

- **Swap a chair:**
  - Put a BOX `SplatEditSdf` with opacity 0 at the RoomPlan chair's transform and dimensions.
  - Add the catalog GLB at the same transform, shifted down by `dimensions.y / 2` so its base sits on the floor.
  - Light the GLB with `renderEnvMap`.
- **Recolor an item:** a `SplatEdit` with `MULTIPLY` or the luminance-preserving dyno, limited to the object's box. Recolor GLBs through their materials.
- **Change a wall or floor material:**
  - Overlay RoomPlan wall and floor planes as opaque PBR meshes, about 1 cm in front of the surface.
  - Depth testing hides the splat surface behind them.
  - Use RoomPlan's mesh cutouts so windows and doors stay visible.
- **Add a painting:** a textured plane on a RoomPlan wall.
- **Hit-testing:** raycast against **invisible RoomPlan proxy boxes and planes** instead of the splat. It is fast, and it tells you *which* object was hit.

### Sources

- https://registry.npmjs.org/@sparkjsdev/spark (verified), https://sparkjs.dev/docs/new-features-2.0/, https://sparkjs.dev/docs/lod-getting-started/, https://sparkjs.dev/docs/loading-splats/, https://sparkjs.dev/docs/splat-mesh/, https://sparkjs.dev/docs/system-design/, https://sparkjs.dev/docs/spark-renderer/, https://sparkjs.dev/docs/splat-editing/, https://sparkjs.dev/docs/dyno-overview/, https://sparkjs.dev/docs/performance/, https://sparkjs.dev/examples/#splat-painter, https://github.com/sparkjsdev/spark-react-r3f
- https://github.com/mkkellogg/GaussianSplats3D
- https://developer.playcanvas.com/user-manual/gaussian-splatting/building/performance/, https://developer.playcanvas.com/user-manual/react/api/gsplat/, https://github.com/playcanvas/supersplat, https://developer.playcanvas.com/user-manual/supersplat/editor/editing-splats/, https://github.com/playcanvas/splat-transform
- https://api.github.com/repos/mrdoob/three.js/releases (r186, verified), https://doc.babylonjs.com/features/featuresDeepDive/mesh/gaussianSplatting
- https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- https://developer.apple.com/videos/play/wwdc2026/279/ **[unverified]**

---

## 5. Textured mesh alternative

### Direct answer

**Not easily from ARKit itself.** `ARMeshGeometry` has only `vertices`, `normals`, `faces`, and an optional `classification`, with no UVs or colors (iOS 26.5 SDK header). Apple's reconstruction sample is a debug overlay ("you normally enable mesh visualization only for debugging purposes").

**Apps do export textured LiDAR meshes:**

- Polycam Space Mode: free, GLTF only.
- KIRI LiDAR Scene Scan: free, OBJ and USDZ, processed on the phone.
- Scaniverse: OBJ, FBX, and GLB.
- 3D Scanner App: OBJ, GLB, and others, now on subscription.

**Apple's own route** is Object Capture **area mode** (WWDC24): `PhotogrammetrySession` on the Mac produces a textured USDZ or OBJ.

### Key facts

**Do-it-yourself texturing:**

- Project mesh vertices into keyframes with `camera.projectPoint(_:orientation: .landscapeRight, viewportSize: imageResolution)`, convert YCbCr to RGB, and sample.
  - Per-vertex color from a few keyframes: about 4–8 h, and it looks blotchy on ARKit's coarse mesh. **[est.]**
  - A proper UV atlas (view selection, unwrap, packing, seam blending): **several days**. Not feasible here.
- Existing projects are thin: TokyoYoshida/ExampleOfiOSLiDAR (single-frame color) and philipturner/scene-color-reconstruction. **[older]**
- Apple DTS, asked in May 2025 about scanning "rooms, houses… realistic colors and textures", pointed to Object Capture.

**Object Capture area mode** (iOS 18 / macOS 15):

- There is "no new call or configuration": skip `startDetecting`. For full scenes, set `ignoreBoundingBox` and `isObjectMaskingEnabled = false`.
- Apple's caveats:
  - "Areas larger than 6 feet may have reduced mesh and texture quality unless processed at a higher detail level on Mac."
  - It "works best on moveable objects".
  - It struggles with single-color surfaces, which describes plain white walls.
- The Mac can process up to 2000 images.
- Detail levels range from `.preview` (25k triangles) to `.full` (250k triangles, 8K textures) and `.raw`.
- **Its output frame is unrelated to RoomPlan's.**
- Time for a room: 10–60+ min. **[est.]**

**Mesh versus splat for our features:**

- A mesh can occlude and be occluded, and three.js can hide a region by discarding fragments inside a box in the shader.
- But it is still one welded mesh. Swapping objects leaves holes in either case, and splats look much more photoreal for a "reimagine your room" demo.

### Implication for our hackathon

**Keep the textured mesh as a demo-day fallback only:** a Polycam free GLTF or a KIRI OBJ, loaded with `GLTFLoader` or `OBJLoader`.

- Don't build texture projection.
- If the splat path fails by hour 10, swap the room renderer for the mesh behind the same editor API (RoomPlan proxies, GLB placement, wall overlays).

### Sources

- https://developer.apple.com/documentation/arkit/armeshgeometry
- https://developer.apple.com/forums/thread/781596
- https://developer.apple.com/videos/play/wwdc2024/10107/ **[older]** (2024)
- https://developer.apple.com/documentation/realitykit/photogrammetrysession/request/detail
- https://developer.apple.com/documentation/realitykit/capturing-photographs-for-realitykit-object-capture
- https://github.com/TokyoYoshida/ExampleOfiOSLiDAR **[older]**
- Polycam, KIRI, Scaniverse, and 3D Scanner App pages listed in section 3

---

## Recommended pipeline for a 2-person, 24-hour team

```
iPhone Pro (our SwiftUI app, iOS 17+)
  one ARSession  ──►  RoomCaptureSession(arSession:)  ──►  room.json (CapturedRoom, Codable) + room.usdz
         └──► ARSessionDelegate keyframe recorder ──► images/*.jpg (landscape) + transforms.json (ARKit c2w, K)
                                                     (+ optional points.ply from rawFeaturePoints)
  zip ──► AirDrop / share sheet ──► M3 Pro
M3 Pro (or cloud GPU if quota)
  Brush v0.3.0 (or msplat; or splatfacto in Docker with SO3xR3 and normalization OFF)  ──►  room.ply
  splat-transform: crop box, remove floaters, decimate to ~1M, strip SH  ──►  room.spz / .sog / .rad
Web (Vite + React + R3F + Spark 2.3.1)
  SplatMesh(room) + RoomPlan proxies (invisible boxes and planes for picking)
  swap = BOX SplatEdit (opacity 0) + catalog GLB at the object transform
  recolor = SplatEdit MULTIPLY / dyno luminance recolor in the object box
  wall/floor material = PBR plane overlay
  painting = textured plane on the wall
  save = JSON scene description (edits + GLB transforms), not a baked splat
```

**Division of labor**

- **Person A (Swift):**
  - First, a minimal `RoomCaptureView` app with the JSON export.
  - Then the frame recorder on the same session.
  - Then the zip and share flow.
  - Later, help with the training scripts.
- **Person B (web):** builds the editor from minute one against a **Scaniverse Classic splat of the venue room** plus a hand-written fake `room.json`. Builds against the real capture once it exists.

**Fallback ladder.** Decide by about hour 8, since the draft is due Saturday at 10:30 PM.

1. **Best:** our app (RoomPlan plus frames, one session), trained in the ARKit frame. Objects line up automatically.
2. **Middle:** our app captures `room.json`, and the splat comes from Polycam Developer Mode (`ns-process-data polycam`) or Scaniverse. Align the two once with a manual gizmo, then save the 4×4 matrix.
3. **Safe:** a Scaniverse splat with **user-drawn boxes** in the editor (place a box, hide it, drop in a GLB). No RoomPlan dependency. The editor is identical.
4. **Last resort:** a textured mesh (Polycam GLTF or KIRI OBJ) in place of the splat.

---

## Top risks to spike-test in hour 1

1. **GPU quota.** Request AWS G/P and Azure NC quota **now**; new accounts start at 0. If it isn't approved by hour 3, commit to Mac training (Brush or msplat) and shorter runs (7k–15k steps).
2. **ARFrame access during RoomPlan.** With `RoomCaptureSession(arSession:)` and our own delegate, check three things:
   - Frames arrive at a usable rate.
   - The RoomPlan UI doesn't stall.
   - `sceneDepth` is or is not nil.
   - Also check whether Xcode debug runs show the iOS 26 green and purple corruption. If they do, test from a Release or TestFlight build.
3. **Frame alignment end to end.** This is the riskiest assumption.
   - Capture about 100 frames plus `room.json`, train 2k–7k steps with normalization off, and load both in Spark.
   - Do the RoomPlan chair boxes sit on the splat chairs?
   - Check the `simd_float4x4` JSON layout, and whether the final `CapturedRoom` is shifted from the live poses.
4. **Splat quality from raw ARKit poses.** Compare a quick train against the Scaniverse splat of the same room. If ours is mushy:
   - Option 1: use Polycam Developer Mode poses.
   - Option 2: run splatfacto with `SO3xR3` in the cloud.
5. **iPhone Safari performance.** Load the Scaniverse splat, decimated to about 1M, plus 2–3 GLBs in Spark on the team's iPhone. Check the frame rate and memory, cap DPR at 1.5, and confirm `antialias: false`.
6. **Spark 2.x in R3F.** The official R3F examples pin Spark 0.1.6. Confirm three things on Vite:
   - `extend()`, `SparkRenderer` with `renderer: gl`, and a `SplatEdit` BOX all work.
   - Whether the BOX `scale` means full size or half-extents.
   - That the GLB occludes splats correctly.
7. **Orientation of exported splats.** Check Scaniverse's PLY up-axis, and whether PLY → SPZ/SOG conversion flips axes. Use a known upright object as the test.
8. **Scan limits.** One room per session, under 5 minutes, at least 50 lux, and watch for `deviceTooHot`. Have a charged backup phone.

---

## Open questions and unverified items

- No Apple document covers `sceneDepth` while RoomPlan runs, or who owns the ARSession delegate. All evidence is from forums.
- The exact JSON shape of `simd_float4x4` in `CapturedRoom`'s `Codable` output.
- RoomPlan's object-local "front" direction, which is needed to orient a catalog GLB facing the right way. The ABO catalog uses +Z as front (see the companion doc).
- Whether msplat normalizes the world frame or accepts `ply_file_path`.
- Scaniverse's PLY axis convention, and whether its mesh and splat share a frame.
- Whether Spark's raycast skips splats hidden by a `SplatEdit`.
- All M3 Pro training times are extrapolations.
