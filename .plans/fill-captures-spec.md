# Fill Captures: real Patches and completed Originals

**Written Sat 2026-10-17, about 4:45 PM, from a design interview. Decision record: [ADR-0007](../docs/adr/0007-patches-and-completion-from-fill-captures.md). Vocabulary: [`GLOSSARY.md`](../GLOSSARY.md) (Capture, Main Capture, Fill Capture, Patch).**

## 1. Problem and goal

A LiDAR scan never sees what furniture hides: the floor under a sofa, the wall behind a dresser, the back of anything against a wall. Today's plan fills those spots with a guess: the simple Patch (§10.6), then Patch v2's push-pull diffusion (§11.2). Removing a sofa leaves a flat or blurry stain, and the wall behind it stays a hole.

**Goal:** when the Mover removes or moves an Original, the spot it leaves shows the real floor and wall, and a moved Original shows a real back. Both come from extra Polycam Captures of the same room with the furniture moved, called Fill Captures.

**Resolution** (the other half of the original ask) is handled without fusing Captures. Reprocess the Main Capture with Polycam's Dense or Custom settings, raise the room budgets (§2.3 below), and build one splat from several walk-through videos (§12). Wherever nothing is edited, the room renders from the splat (ADR-0005).

**The demo room is now a lounge** (`lounge-v1`: sofas, a coffee table, side tables), replacing the dorm.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | A Scan = **one Main Capture + any number of Fill Captures**. Room Setup, the Originals and the splat come only from the Main Capture. | Fill Captures contain furniture in other places. Using them only for what the furniture hid means nobody has to tag where it went. |
| D2 | **Fill Captures supply only the floor and walls hidden by Originals, plus the unseen backs and sides of moved Originals.** No whole-mesh fusion. | Fusion for resolution costs registration, seam blending and texture choice everywhere, for detail the splat already gives. |
| D3 | A **Patch** is the Fill Capture's floor and wall inside the Original's box grown by **10 cm** on every side. That includes its contact shadow and the wall strip behind it. It shows **only while the Original is lifted or removed.** | While a table stands, the Main Capture's floor under it is right, shadow included. Once it's gone, the grown region also removes the ghost contact shadow. |
| D4 | **One Fill Capture per Patch:** the one covering the most of the Patch area. | No overlapping layers, one color gain per Patch. |
| D5 | Each Patch gets its **own color gain**, from a ring of floor and wall both Captures saw around it. It's computed in the merge and stored as the Patch material's color factor. | Polycam exposes each Capture differently, and lamps differ locally. Baking the gain into the merge keeps load time unchanged. |
| D6 | **Spots no Capture saw** get Patch v2's push-pull fill, as a **floor decal plus one wall decal per touched wall**, drawn under the captured Patch. | Keeps visible holes out, including through walls. |
| D7 | **Moved Originals are completed:** after registration, the Fill copy's triangles are added only where the Main copy has no surface within **2 cm**, with a gain per Original. Furniture stays **upright** in Fill Captures (registration = turn + floor position). | Gives real backs and sides without swapping the look of the whole piece. Tipping furniture for undersides would need full 3D registration. |
| D8 | **Alignment:** in a new Room Setup step after Originals, click 3–4 matching floor-level corners. The step solves turn and position (the floor height is found automatically), then refines with ICP. You click each moved Original's copy in the Fill Capture and pick the Original. | Every Capture is gravity-aligned and metric, so only 4 numbers are unknown. Clicking avoids picking the wrong 90° rotation in a near-square room; ICP gives about 1 cm accuracy. |
| D9 | **Merging is server-side gltf-transform:** `scripts/scan-merge.ts` rebuilds `room.glb` from the Main and Fill Captures. **Saving the step triggers it** (`POST /api/scans/:id/merge`). | Keeps meshopt and WebP intact, can be re-run, and can also be run by hand. |
| D10 | Fill triangles live **in `room.glb`, tagged** by Patch or completion. splitScan routes them by tag. | One mesh file, no new load path. |
| D11 | **Contract:** add `ScanManifest.captures`. `Original.patch` becomes `{ floor?, walls? }`. | Explicit types instead of naming rules. Both are optional or unused today, so nothing breaks. **Person B must agree** (§5 of the main spec). |
| D12 | **Budget:** `room.glb` ≤ **500k triangles in total**, with no separate cap on the Main Capture or the fill. Room textures go up to **4096**. | Decided after the interview. Replaces §2.3's 300k and 2K. |
| D13 | **Kept Originals get no Patch and no completion**, and stay put during Fill Captures. | They can never be moved or removed. |
| D14 | All of this is **pre-processing before the demo**; Room Setup's UI only needs to be usable, not polished. | Judges never see setup (ADR-0004). |
| D15 | **When:** take the Fill Captures today on the lounge trip; build in **Phase 2**, after Checkpoint 1. The simple Patch is the fallback until then. | Phase 1 is never cut. |

Decided while writing (flag if wrong):

- **The synthetic lounge is a second fixture,** `data/scans/synthetic-lounge/`, and the dorm `synthetic` stays as it is. #7 and #8 are building against the dorm right now.
- **Every transform is stored relative to the Main Capture's frame** (its Polycam frame), not the room frame, so redoing Room Setup step 1 (Level) doesn't invalidate it.

## 3. Capturing (amends §9.1; posted to #2)

1. **Main Capture**, as before: furniture in place, lights on, blinds fixed, Developer Mode ON. **Shoot every splat video now**: if furniture moves between videos, the splat shows it twice.
2. **Move the furniture, keeping it upright:**
   - pull sofas off the walls, and turn pieces so their backs face the room
   - move tables and chairs off their spots, ideally out of the room
   - leave Kept pieces where they are
3. **Fill Capture**, with the same lights:
   - every revealed floor and wall spot, walked up close
   - **at least two room corners**, for alignment
   - a full walk around each moved Original
4. **Every non-Kept Original's spot is uncovered in at least one Fill Capture.** If moving one piece covers another's spot, take another Fill Capture.
5. **Export each Capture as GLB** (`lounge-main.glb`, `lounge-fill-1.glb`, …), AirDrop them, and put the furniture back.

## 4. Data

### 4.1 Contract (`shared/types.ts`)

```ts
export interface ScanManifest {
  // …existing fields…
  mesh: string;                      // "room.glb": the Main Capture, plus fill triangles once merged
  captures?: ScanCaptures;           // Phase 2 (ADR-0007): what room.glb was merged from
}

export interface ScanCaptures {
  main: string;                      // "captures/main.glb": the Main Capture as imported
  fills: FillCapture[];
}

export interface FillCapture {
  mesh: string;                      // "captures/fill-1.glb"
  transform: YawTransform;           // this Capture's frame → the Main Capture's frame
  moved: MovedOriginal[];            // Originals this Capture saw somewhere else
}

export interface MovedOriginal {
  originalId: string;
  transform: YawTransform;           // its copy here (in the Main Capture's frame) → where it stands in the Main Capture
}

export interface Original {
  // …existing fields…
  patch?: {                          // Phase 2: generated fill (Patch v2) for spots no Capture saw
    floor?: string;                  // "patches/og_sofa.floor.png"
    walls?: Record<string, string>;  // wallId → "patches/og_sofa.wl_2.png"
  };
}
```

`YawTransform` keeps its meaning (yaw about +Y, then translate). Every Capture is gravity-aligned, so no tilt is ever needed.

### 4.2 Scan folder

```
data/scans/lounge-v1/
├─ manifest.json            ← captures added once a Fill Capture is imported
├─ setup.json
├─ room.glb                 ← rebuilt by the merge (Main Capture + tagged fill triangles)
├─ captures/main.glb        ← the Main Capture as imported (the merge always starts from here)
├─ captures/fill-1.glb
├─ patches/og_sofa.floor.png, patches/og_sofa.wl_2.png
└─ raw/                     ← gitignored, as before
```

### 4.3 Tags in `room.glb`

Every merged primitive carries `extras.mise.fill`:

```json
{ "kind": "patch", "originalId": "og_sofa", "capture": 0 }
{ "kind": "completion", "originalId": "og_sofa", "capture": 0 }
```

`capture` indexes `captures.fills`. The material is a clone of the source material with `baseColorFactor` set to the color gain and the same texture.

## 5. Pipeline

### 5.1 `scripts/scan-import.ts` (amends §9.2)

- The triangle cap goes from 300k to **500k** (the whole budget), and `--texture-size` from 2048 to **4096**.
- **New `--fill`:** `npx tsx scripts/scan-import.ts lounge-fill-1.glb lounge-v1 --fill`. It runs the same optimize pipeline into `captures/fill-<n>.glb` and appends `{ mesh, transform: identity, moved: [] }` to `captures.fills`. It never touches `room.glb` or `meshTransform`, and needs no `--force`.
  - The first `--fill` on a Scan also copies `room.glb` to `captures/main.glb` and sets `captures.main`.
  - The summary adds a reminder: "Next: line it up in Room Setup → Fill Captures."

### 5.2 Room Setup step 6, "Fill Captures" (new; Bake becomes step 7)

For each Fill Capture:

1. **Level:** find its floor height with the step 1 histogram, so y is solved.
2. **Corners:** two top-down views side by side, Main on the left and Fill on the right. Click the same 3–4 floor-level corners in both. Solve yaw and x/z by 2D least squares (Kabsch, no scale).
3. **Refine:** point-to-plane ICP with 4 degrees of freedom (yaw, x, y, z) on both Captures' **Surfaces**: floor (n.y > 0.8, near y = 0) and walls (near a wall plane, facing it). Furniture is left out because it moved. The Fill Capture's Surfaces are picked where the corners put it, within 10 cm. ICP runs at most 40 iterations, its match distance shrinking from 30 cm to 5 cm, so a rough start still converges.
4. **Check:** overlay the Fill Capture as a wireframe and show the median shell distance. Aim for ≤ 1 cm.
5. **Moved Originals:** press Mark beside an Original (non-Kept only), then click its copy in the Fill Capture. The §9.3 auto-box finds the copy. Registration:
   - start from the two box centers, trying turns of 0°, 90°, 180° and 270°
   - refine with ICP over yaw and floor position (3 degrees of freedom) on the vertices of both copies above y = 0.03
   - keep the turn with the lowest cost (the mean distance, counting each unmatched sample as the match distance), so a turn that matches less of the copy loses
   - the panel shows the residual; showing the Fill Capture as a wireframe compares the two
6. **Save:** `PUT /api/scans/:id/manifest` (`captures`), then `POST /api/scans/:id/merge`, which answers with the merge summary. Room Setup shows the Main Capture (`captures.main`), so nothing there reloads; the editor shows the result.

### 5.3 The merge: `scripts/scan-merge.ts`

`mergeScan(scanDir)` is exported for the server, and the script also runs on its own: `npx tsx scripts/scan-merge.ts lounge-v1`. It always starts from `captures/main.glb`, so re-running it is safe.

1. **Bring in each Fill Capture.** Load it and transform it into the Main Capture's frame, then into the room frame through `meshTransform`, for classification.
2. **Patches,** for each non-Kept Original:
   - **Region:** the Original's box grown 10 cm on every side.
   - **Keep** the Fill triangles whose centroid is in the region and that pass the §9.4 **Floor** test (|c.y| < 0.03, n.y > 0.8, inside the floor polygon) or **Wall** test (within 4 cm of a wall plane, |n·normal| > 0.7, inside the wall's extent). Moved furniture fails both tests, so it never ends up in a Patch.
   - **Coverage** = kept area ÷ the region's floor and wall area. Use the Fill Capture with the highest coverage (D4).
   - **Gain:** take the floor and wall triangles in a ring 10–30 cm outside the region, from both Captures. Sample each one's texture at up to 2,000 triangle UV centroids (decoded with sharp, then converted to linear light, where `baseColorFactor` multiplies). Average each 10 cm cell that both Captures saw, and take the per-channel ratio Main ÷ Fill over those cells, clamped to 0.5–2.
3. **Completions,** for each `moved` entry:
   - take the Fill triangles inside that Original's box at its Fill pose, grown 2 cm, with y > 0.02
   - transform them to the Main pose
   - drop those within 2 cm of a Main triangle of the same Original that faces the same way (point-to-triangle distance)
   - **Gain:** the same ratio, sampled on the surfaces both copies saw (the triangles that were dropped)
4. **Budget:** if the Main Capture plus the fill comes to more than 500k triangles, simplify every primitive with the same ratio (`500k / total`, error 1). Neither part has its own cap, and the merge always starts again from `captures/main.glb`, so nothing is simplified twice.
5. **Write:** transform the fill back into the Main Capture's frame, append one primitive per Patch or completion (tagged, §4.3), dedup the textures, keep the meshopt and WebP pipeline, and write `room.glb`. Print a summary per Original: triangles, area, coverage (the share of the region's floor the Fill Capture saw) and gain.
6. **Skip** Fill Captures that still have scan-import's identity transform: they haven't been lined up, so they would land anywhere. The summary lists them.

The server gains a small route next to the others in `server/app.ts`: `POST /api/scans/:id/merge` → `mergeScan` → its `MergeSummary`. A Scan that isn't ready (no Fill Captures, no Room Setup) is a 400; anything else a 500.

### 5.4 splitScan (amends §9.4, #8)

Before rule 1:

- **Rule 0:**
  - triangles of a primitive tagged `fill.kind = "patch"` → `patches[originalId]`, hidden by default
  - triangles tagged `"completion"` → that Original's node
  - untagged triangles → the existing rules 1–5
- **Patch nodes:** `MeshBasicMaterial` with the map and the color factor (the gain). Set `polygonOffset` (factor −1, units −1) so they draw over the Main Capture's floor and wall at the same depth. Compute `avgLuminance` the same way as for other nodes.
- The result gains `patches: Record<originalId, Object3D>`.
- The timing target scales with the new budget: under 500 ms for 500k triangles.

### 5.5 Rendering (amends §10.6, §11, #13)

When an Original is in `RoomState.patches` (removed, replaced or moved):

- show its Patch v2 decals (floor at y = 0.002, wall decals 2 mm in front of their wall, feathered), then its captured Patch node on top
- with no captured Patch and no decals, fall back to the simple Patch

### 5.6 Bake, Patch v2 for gaps (Room Setup step 7, amends §11.2, #13)

For each non-Kept Original:

- **Floor:** render top-down, orthographic, 512² with alpha, over its footprint plus 40 cm. Draw the Main Capture's Floor node **with the Patch region cut out**, then its captured Patch node.
  - Pixels with alpha 0 inside the region are the gaps. Fill them with push-pull diffusion and save `patches/<id>.floor.png`.
  - The old "mask the footprint plus 5 cm" step goes away: the captured Patch has no contact shadow.
- **Walls:** for each wall within 10 cm of the grown box, do the same with an orthographic camera facing the wall. It covers the box's extent along the wall plus 10 cm on each side, from the floor to the box's height plus 10 cm. Save `patches/<id>.<wallId>.png`.
- **Write** `original.patch = { floor, walls }` and save `setup.json`.

### 5.7 Splat (amends §12, #16)

The splat-hiding box for a lifted or removed Original is its box **grown by 10 cm**, the same region as its Patch.

## 6. Synthetic lounge fixture

`scripts/synthetic-room.ts` gains a second room, `data/scans/synthetic-lounge/`, built the same way as the dorm: 5 cm cells, ±2 mm noise, its own noise texture per Shape, and the true `setup.json`.

- **Room:** 5.4 × 6.0 m with a 2.7 m ceiling, a door, and two windows.
- **Originals:**
  - a 3-seat sofa against a wall (not Kept)
  - an armchair
  - a coffee table on legs
  - a side table
  - one Kept piece, a built-in bench against a wall
- **Main Capture:** the furniture in place.
- **Fill Capture:**
  - the sofa moved to the other side of the room and turned around, so its back faces the room
  - the coffee table, side table and armchair moved off their spots, to where nothing stood
  - the whole Capture offset by a known transform (yaw 0.37 rad, translation (1.2, −0.8, −0.6) m, where y simulates a different ARKit origin)
  - its textures darkened by 10%, so the gain has something to correct
- Neither Capture has what a scanner can't see: the floor under furniture resting on it, the wall behind furniture standing against it, and furniture faces turned to a wall.
- Both Captures go through `scan-import`, the second with `--fill`. The generator then writes the true transforms (the ones step 6 recovers: `LOUNGE_FILL_TRANSFORM`, `LOUNGE_FILL_MOVED_TRANSFORMS`) and runs the merge, so the committed Scan already shows its Patches in the editor. Step 6 can still line it up again.

**Tests** (`scripts/scan-merge.test.ts` and Room Setup's alignment module):

1. The corner solve recovers the known transform within 1 cm and 0.2°.
2. ICP converges back from a ±5 cm, ±3° perturbation.
3. Furniture registration finds the sofa's 180° turn and its position within 2 cm.
4. Merge:
   - the sofa's Patch has only floor and wall triangles
   - it covers ≥ 95% of the region
   - its gain is about 1.11
5. Completion adds the sofa's back and keeps no triangle within 2 cm of the Main copy.
6. The budget holds: a merge that would pass 500k triangles comes out at 500k or fewer.
7. Kept Originals get no Patch and no completion.

## 7. Work breakdown

| Where | Who / when | What |
|---|---|---|
| **New issue: "Fill Captures"** | Person A, Phase 2. Depends on #8 (merged) and #4 (merged). | Contract change (with Person B's OK); `scan-import --fill` and the new budget; the Room Setup step 6 UI and alignment module; `scripts/scan-merge.ts` and `POST /api/scans/:id/merge`; splitScan rule 0, Patch nodes (gain, polygonOffset) and `patches` in its result, since #8 is already merged; showing a Patch node in `ScanMesh` while its Original is in `RoomState.patches`; the synthetic lounge and tests |
| **Amend #13** | Phase 2 | Render captured Patch nodes plus floor and wall decals; Bake writes `patch = { floor, walls }`; remove the footprint mask |
| **Amend #16** | Phase 3 | Grow the splat-hiding box by 10 cm |
| **#2** | Today | Capture checklist ✅ (commented) |

## 8. Main spec edits this implies (`.plans/mise-spec.md`) ✅ made with this plan

- **dorm → lounge:** `dorm-v1` → `lounge-v1`, and update the examples: Kept examples become lounge pieces.
- **§2.2 Capture row and §3 diagram:** add Fill Captures.
- **§2.3:**
  - room mesh ≤ 500k triangles in total, with **4K** WebP textures
  - splitScan target < 500 ms for 500k
- **§9.1:** the capture order (§3 above). **§9.2:** `--fill`, 500k, 4096.
- **§9.3:** new step 6, Fill Captures; Bake becomes step 7, with Patch v2 for gaps on the floor and walls. **§9.4:** rule 0 and Patch nodes.
- **§10.6 and §11.1–11.2:** the Patch is the captured Patch plus v2 decals for gaps; the simple Patch is only a fallback.
- **§12:** the grown splat-hiding box.
- **§16:** add risks R1–R3 below.
- **§17 cut order:** Fill Captures sit with "Patch v2", and completion is cut before Patches.

## 9. Done when

- [ ] On `lounge-v1`, removing the sofa shows the real floor and the wall behind it, with no contact shadow left behind and no visible step in brightness at the edge.
- [ ] Moving the sofa 1 m off the wall shows its real back.
- [ ] Spots no Capture saw show a Patch v2 decal, never a hole, including on walls.
- [ ] The median alignment residual on the lounge is ≤ 1 cm, and `room.glb` is within 500k triangles and loads in three.js.
- [ ] Saving the Fill Captures step rebuilds `room.glb`, and running `npx tsx scripts/scan-merge.ts lounge-v1` gives the same file.
- [ ] The synthetic-lounge tests pass.

## 10. Risks

- **R1. ARKit drift differs between Captures,** so walls may not overlap everywhere within 1 cm even after ICP. *Mitigation:* the Patch's feathered decal underneath, and the grown region hiding the edge. *If it's bad:* run a local ICP per Patch region (not planned).
- **R2. Moved furniture covers another Original's spot** in every Fill Capture. *Mitigation:* the capture rule in §3, step 4; otherwise Patch v2 fills it.
- **R3. Lighting changed between Captures** (daylight, a moved lamp). *Mitigation:* per-Patch gain. A strong directional change (a new shadow) can't be fixed.

## 11. Out of scope

- Fusing whole meshes for resolution
- Undersides (tipped furniture)
- Patches and completions for Kept Originals
- Fill Captures for the splat
- Showing setup to judges
