# Mise: Build Spec

**Version 1, written Sat 2026-10-17 2:15 PM PDT, during DubHacks 2026.**

| Item | Value |
|---|---|
| Team | 2 people: **Person A** (Scan and rendering) and **Person B** (editor, Catalog, and Claude). Write your names here. |
| Deadlines | Devpost draft: Sat **10:30 PM**. Final submission: Sun **10:00 AM**. Judging: Sun 11:30 AM–2:00 PM. |
| Vocabulary | [`GLOSSARY.md`](../GLOSSARY.md). Use its words in code, in the UI, and in conversation: Mover, Scan, Design, Surface, Original, Piece, Part, Edit, Finish, Patch, and so on. |
| Decisions | [`docs/adr/`](../docs/adr/): 0001 Edit list; 0003 curated Catalog; 0004 Polycam only; 0005 splat for untouched, mesh for edited; 0006 Parts from geometry rules. |
| Research | [`docs/research/capture-and-rendering.md`](../docs/research/capture-and-rendering.md) and [`docs/research/assets-and-hackathon.md`](../docs/research/assets-and-hackathon.md) |

---

## 1. What we're building

**One line:** *Scan your new room with your iPhone. Redesign it with real products at real size, in a 3D copy of your actual room, before you buy anything or carry a single box.*

**Who it's for:** the **Mover**: a college freshman about to furnish a dorm, or a new homeowner. Movers buy furniture blind. They don't know:

- whether a desk fits between the bed and the window
- how a rug looks next to the school's beige dresser
- whether the walls would look better sage

They also have fixed constraints, like the dorm bed that can't leave the room.

**What Mise does:**

1. **Scan.** The Mover captures the room once with Polycam on a LiDAR iPhone.
2. **Set up.** A one-time Room Setup marks the floor, walls, doors, windows, and existing furniture (Originals).
3. **Design.** In the browser, the Mover edits the room:
   - Place, move, swap, and resize real products from the Catalog (Amazon Berkeley Objects).
   - Recolor individual Parts, such as black legs with an oak top.
   - Paint walls while keeping the room's real lighting.
   - Replace their own furniture with Catalog Pieces.
4. **Compare.** One Scan has many Designs. Each Design has a shopping list with product links and an estimated total.
5. **Generate (last phase).** Claude turns a Brief ("cozy Japandi, under $400, I need a reading corner") into 3 Designs that fit the room. The Mover then customizes them.

**How it maps to Visa "Reimagine Shopping"**, our primary track (Track Applicability is 30% of the score):

| Visa's words | Mise feature |
|---|---|
| Discovery | Browse real products in *your* room; Claude proposes Designs |
| Decision-making | True size, Fit rules, comparing Designs side by side, the total cost |
| Personalization | Your actual room, your Brief, your Kept furniture |
| Generative AI | Claude generates and refines Designs |

The other judging weights are Functionality 30%, Design 20%, and Creativity 20%. Design is the UI and visual polish. Budget time for it in Phase 4 polish.

---

## 2. Parameters: in scope, later, and out

### 2.1 Build order

We build in this order. The order is the user's decision; see Round 7.

| Phase | Name | Goal | Target done |
|---|---|---|---|
| **1** | **Fundamentals** | Scan → Room Setup → web editor → manual Design editing with ABO Pieces | Sat ~10:30 PM ✅ Checkpoint 1 |
| **2** | **Originals** | Move or remove Originals, a better Patch, Finishes (materials, wallpaper, floor) | Sun ~2:00 AM |
| **3** | **Photoreal** | Splat Look layer, Realism levels, room lighting, cast shadows | Sun ~4:00 AM (time-boxed) |
| **4** | **Claude** | Brief → 3 Designs; Refine; animated reveal | Sun ~7:30 AM |

> **Time-box rule (protects the Visa pitch).** Phase 4 starts **no later than Sun 4:00 AM**. Whatever isn't working in Phase 3 by then is cut, and the mesh look ships. A minimal "Brief → 3 Designs" is **never cut**: the Visa brief literally says "use generative AI."

### 2.2 Scope table

| Area | Phase 1 | Later | Out (not this hackathon) |
|---|---|---|---|
| Capture | **Polycam Business** (every export unlocked): the Space Mode (LiDAR) mesh as GLB; a Polycam Gaussian splat (Splat PLY) built from the Space capture's uploaded video or a separate Object Mode capture; Developer Mode raw data as a fallback | **Fill Captures** with the furniture moved, for real Patches and the backs of moved Originals (P2, ADR-0007); auto-setup (our own RoomPlan or AI detection) | Our own iOS app or video pipeline, RoomPlan, importing Polycam's floor plan (§18), capture from a phone webpage |
| Room meaning | Room Setup by hand: floor corners → walls, Openings, click-to-tag Originals with auto-box | Auto-setup by RoomPlan or AI | — |
| Look | Polycam textured mesh | Splat + mesh hybrid, Realism levels (P3) | AI photo stills (dropped) |
| Pieces | Place, Move, Rotate, Remove, Swap, Resize, Recolor per Part | Text-to-3D for categories the Catalog lacks (P4 stretch) | Live web product search |
| Originals | Replace (with a simple Patch) | Move, Remove, Recolor and Finish per Part; Patches from Fill Captures, with generated fill for gaps; backs of moved Originals from Fill Captures (P2) | Completing unseen sides with image-to-3D; undersides |
| Surfaces | Paint walls (keeps real lighting) | Wallpaper, floor materials such as carpet or wood (P2) | Ceiling edits |
| Catalog | ~20 → 60 ABO items | ~150 items (exact list decided later) | Real prices |
| AI | — | Claude Generate and Refine (P4) | MCP server, Claude Desktop integration |
| Commerce | Shopping list, estimated total, `amazon.com/dp/<ASIN>` links (dead links accepted) | — | Checkout, live prices |
| Infra | Vite web app, tiny Hono server, JSON files on disk | `POST /api/generate` (P4) | Database, auth, accounts, multi-user, deployment, phone share links |

### 2.3 Hard parameters

| Parameter | Value |
|---|---|
| Units and axes | Meters; +Y up; right-handed (three.js). The floor is **y = 0** in the room frame. |
| Object frame (Pieces and Originals) | Origin at the **bottom-center** of the box; **+Z is the front**; size = [width x, height y, depth z]. ABO models already use +Y up, +Z front, and meters. |
| Rotation | `rotationY` in radians, three.js convention. Only yaw; nothing tilts. |
| Colors | Hex strings, `#rrggbb` |
| Pre-processing time | Unlimited (15 minutes or more is fine): import, Room Setup, Patch bake, splat training, Catalog build |
| Live interactions | Drag, rotate, and orbit at **60 fps** on the M3 Pro and M3 Air in Chrome. Any Edit applied and visible in **under 100 ms**. Swap and Resize candidate lists in **under 200 ms**. |
| Loading | Scan + Design interactive in **under 5 s** from localhost on first load |
| Generation (P4) | 3 Designs in **under 30 s** |
| Asset budgets | Room mesh ≤ 500k triangles in total, Fill Captures included, with up to 4K WebP textures. Splat ≤ 1.5M splats as SPZ. Each Piece ≤ 2 MB (1K WebP, meshopt). At most 25 Pieces per Design. |
| Demo machine | M3 Pro, Chrome, localhost. No phone required during judging. |

---

## 3. Architecture

```
iPhone 16 Pro ─ Polycam Business (Developer Mode ON)              ── AirDrop all exports to the M3 Pro
   ├─ Space (LiDAR) mode            → mesh export (GLB): the Main Capture, then Fill Captures (furniture moved)
   ├─ Gaussian splat (Polycam cloud, from the Space video) → Splat PLY, in its own frame
   └─ Raw Data (photos + poses)     → fallback only

M3 Pro, offline (any duration)
   scripts/scan-import.ts   ◄ mesh       → data/scans/<id>/room.glb + manifest.json (--fill: captures/fill-<n>.glb)
   scripts/scan-merge.ts    ◄ Main + Fill Captures + setup.json → room.glb with Patches (ADR-0007)
   scripts/splat.sh (P3)    ◄ Splat PLY  → splat-transform → data/scans/<id>/splat.spz
   msplat-train (fallback)  ◄ raw data   → a splat in the mesh's own coordinates
   scripts/catalog-build.ts              → data/catalog/catalog.json + models/*.glb

Browser (Vite + React + TypeScript + React Three Fiber + drei)
   /setup/:scanId   Room Setup tool  ──PUT──►  data/scans/<id>/setup.json, manifest.json; ──POST merge──► room.glb
   /d/:designId     Editor
                      load Scan mesh → split into Shell / Floor / Walls / Originals (in memory)
                      load Catalog + Design
                      RoomState = replay(setup, catalog, design.edits)   ← pure function (shared/)
                      render RoomState; UI actions create Edits → append → save

Hono server (localhost:$API_PORT, default 8787)
   GET  /data/*                  static: scans, catalog, materials
   GET  /api/scans               list ScanManifests
   PUT  /api/scans/:id/setup     save Room Setup
   PUT  /api/scans/:id/manifest  save meshTransform (Room Setup step 1) and splatTransform (Phase 3)
   PUT  /api/scans/:id/files/:name   Phase 2: save baked Patch PNGs into the scan folder
   POST /api/scans/:id/merge     Phase 2: rebuild room.glb from the Main and Fill Captures (ADR-0007)
   GET  /api/designs?scanId=     list Designs
   GET  /api/designs/:id         one Design
   POST /api/designs             create (empty, or duplicate of an existing Design)
   PUT  /api/designs/:id         save the whole Design
   POST /api/generate            Phase 4: Brief → 3 Designs (Claude)
   POST /api/designs/:id/refine  Phase 4: append Claude Edits
```

**Six ideas the whole system rests on:**

1. **A Scan is a mesh plus a Room Setup.** It's made once and never changed by Designs (ADR-0004).
2. **Load-time split.** When the editor loads the Polycam mesh, it sorts every triangle into *Shell*, *Floor*, one node per *Wall*, one node per *Original*, or *Ceiling*. That makes walls paintable and Originals hideable and movable, with no offline baking (§9).
3. **A Design is a list of Edits** (ADR-0001). The room you see is `replay(edits)`. Undo, History, Duplicate, and the Phase 4 reveal animation all come from this.
4. **Rendering reads only RoomState.** The UI never mutates the scene directly; it appends Edits.
5. **One set of Edit functions** is used by the Mover's UI and, in Phase 4, by Claude's tools. Fit rules live in `shared/` and run in both places.
6. **Four render primitives:** hide a region, recolor a region, add a mesh, move a region. In Phase 3, untouched things render from the splat and touched things from the mesh (ADR-0005).

---

## 4. Repo layout

There's one `package.json` at the root, so there's no workspace tooling to configure.

```
/
├─ GLOSSARY.md
├─ .plans/mise-spec.md          ← this file
├─ docs/adr/  docs/research/
├─ package.json  tsconfig.json  vite.config.ts
├─ shared/                       ← pure TypeScript, no DOM, no three.js scene code
│  ├─ types.ts                   ← THE CONTRACT (§5). Change only when both people agree.
│  ├─ replay.ts                  ← replay(setup, catalog, edits) → RoomState
│  ├─ describe.ts                ← Edit → "Painted North wall · Sage"
│  ├─ fit.ts                     ← Fit rules → FitViolation[]
│  ├─ parts.ts                   ← category → Part list + per-triangle rule
│  ├─ catalog-search.ts          ← filters + size-closeness ranking
│  ├─ anchors.ts                 ← Phase 4: Anchor → Placement
│  └─ ids.ts                     ← id helpers (nanoid with prefixes)
├─ web/
│  ├─ index.html
│  └─ src/
│     ├─ main.tsx  App.tsx       ← routes: /, /setup/:scanId, /d/:designId
│     ├─ api.ts
│     ├─ state/store.ts          ← zustand: scan, setup, catalog, design, roomState, selection, mode
│     ├─ scene/                  ← SceneCanvas, ScanMesh, splitScan, PieceNode, Patch, BlobShadow,
│     │                             DollhouseCamera, WalkControls, WallFader, DragControls, ResizeHandles,
│     │                             materials/recolor.ts (+ triplanar in Phase 2)
│     ├─ ui/                     ← TopBar, CatalogPanel, Inspector, HistoryPanel, ShoppingList, DesignsMenu
│     └─ setup/                  ← RoomSetupPage + steps, floorDetect, autoBox
├─ server/
│  ├─ index.ts                   ← Hono app
│  └─ generate/                  ← Phase 4: agent.ts, tools.ts, prompt.ts, roomSummary.ts
├─ scripts/
│  ├─ scan-import.ts             ← Polycam export → data/scans/<id>/
│  ├─ catalog-build.ts           ← picks → optimized GLBs + catalog.json
│  ├─ materials-build.ts         ← Phase 2: ambientCG/Poly Haven → data/materials/
│  └─ splat.sh                   ← Phase 3: Polycam Splat PLY → splat-transform → splat.spz
└─ data/
   ├─ scans/<scanId>/            ← manifest.json, room.glb, setup.json, patches/, splat.spz, raw/ (gitignored)
   ├─ catalog/                   ← catalog.json, models/, thumbs/
   ├─ materials/                 ← Phase 2
   └─ designs/<designId>.json
```

**Packages:**

- **Phase 1:** `react`, `react-dom`, `three` (≥ 0.180, which Spark requires), `@react-three/fiber`, `@react-three/drei`, `zustand`, `hono`, `@hono/node-server`, `nanoid`.
- **Dev:** `vite`, `@vitejs/plugin-react`, `typescript`, `tsx`, `vitest`, `concurrently`, `@gltf-transform/cli`.
- **Phase 3:** `@sparkjsdev/spark@2.3.1`.
- **Phase 4:** `@anthropic-ai/sdk`, `zod`.

**Running it:**

- `npm run dev` runs `concurrently "npm:dev:web" "npm:dev:api"`:
  - `dev:web` is `vite --port ${PORT:-5173} --strictPort`.
  - `dev:api` is `tsx watch server/index.ts`, which listens on `process.env.API_PORT ?? 8787`.
  - Vite proxies `/api` and `/data` to `http://localhost:${API_PORT ?? 8787}`.
- **Superset ports:** each Superset workspace gets its own port block, and its Run button (`.superset/run.sh`) exports `PORT` and `API_PORT`. Never hard-code 5173 or 8787 anywhere else. Keep the word `vite` out of the `dev` script itself: if it appears there, `run.sh` appends `--port` to `concurrently` instead of to Vite.
- **Secrets:** put `.env` (with `ANTHROPIC_API_KEY` in Phase 4) in the main checkout. `.superset/setup.sh` copies it into every new workspace.
- **Git:** commit everything except `data/scans/*/raw/`. The GLBs and SPZ are small enough for GitHub, and committing them lets both laptops run the same data.
- **Tests:** `vitest` on the pure modules (`replay`, `fit`, `catalog-search`, `parts`) only. They're small, and they are the code Claude will depend on in Phase 4.

---

## 5. The hour-0 contract: `shared/types.ts`

Both people paste this file in at 2:15 PM, and **neither changes it alone**. Person B builds the editor against a hand-written `setup.json` until Person A's Room Setup tool produces real ones.

```ts
// shared/types.ts — Mise contract v1. Meters, +Y up, floor at y = 0.

export type Vec2 = [x: number, z: number];            // a point on the floor plane
export type Vec3 = [x: number, y: number, z: number];
export type Hex = `#${string}`;                         // "#9caf88"

export type Category =
  | 'chair' | 'desk' | 'table' | 'nightstand' | 'bed' | 'sofa'
  | 'dresser' | 'wardrobe' | 'shelf' | 'storage'
  | 'rug' | 'lamp' | 'wall_art' | 'mirror' | 'plant' | 'decor';

/* ───────────── Scan ───────────── */

export interface ScanManifest {
  version: 1;
  id: string;                        // "lounge-v1"
  name: string;                      // "Maple Hall 412"
  mesh: string;                      // file in the scan folder: "room.glb"
  meshTransform: YawTransform;       // Polycam frame → room frame (set by Room Setup step 1)
  splat?: string;                    // Phase 3: "splat.spz"
  splatTransform?: YawTransform & { scale: number }; // Phase 3: splat frame → room frame
  captures?: ScanCaptures;           // Phase 2 (ADR-0007): what room.glb was merged from
}

export interface YawTransform { position: Vec3; rotationY: number }

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

export interface RoomSetup {
  version: 1;
  scanId: string;
  ceilingHeight: number;             // meters above the floor
  floor: { polygon: Vec2[] };        // room corners, in click order, closed implicitly
  walls: Wall[];                     // one per polygon edge
  openings: Opening[];
  originals: Original[];
}

export interface Wall {
  id: string;                        // "wl_1"
  name: string;                      // "North wall" (auto-named by facing; editable)
  start: Vec2;
  end: Vec2;
  normal: Vec2;                      // unit vector pointing INTO the room
  height: number;
}

export interface Opening {
  id: string;                        // "op_1"
  kind: 'door' | 'window';
  wallId: string;
  offset: number;                    // m from wall.start to the opening's nearer edge
  width: number;
  bottom: number;                    // m above floor; 0 for doors
  height: number;
  swing?: 'in-left' | 'in-right' | 'none';  // doors; hinge side seen from inside the room
}

export interface Box {
  position: Vec3;                    // bottom-center
  size: Vec3;                        // [width, height, depth] in the box's own frame
  rotationY: number;                 // box +Z = the object's front
}

export interface Original {
  id: string;                        // "og_bed"
  label: string;                     // "Bed"
  category: Category;
  box: Box;
  kept: boolean;                     // can't leave the real room (e.g. a building-owned sofa)
  partParams?: PartParams;           // overrides for the category Part rule (ADR-0006)
  floorColor: Hex;                   // average floor color around the footprint → simple Patch
  patch?: {                          // Phase 2: generated fill (Patch v2) for the spots no Capture saw
    floor?: string;                  // "patches/og_sofa.floor.png"
    walls?: Record<string, string>;  // wallId → "patches/og_sofa.wl_2.png"
  };
}

export interface PartParams {
  topThickness?: number;             // table/desk: meters below the top that count as "top" (0.06)
  seatFraction?: number;             // chair: below this fraction of height = "legs" (0.45)
  beddingRange?: [number, number];   // bed: y range in meters that counts as "bedding" ([0.22, 0.70])
  frontDepth?: number;               // dresser/wardrobe/nightstand/storage: front slab depth (0.03)
}

export interface PartDef { id: string; name: string }   // { id: 'legs', name: 'Legs' }

/* ───────────── Catalog ───────────── */

export interface CatalogItem {
  id: string;                        // ABO item_id (an ASIN), e.g. "B07HSLGGDB"
  source: 'abo' | 'polyhaven' | 'generated';
  title: string;
  brand?: string;
  category: Category;
  mount: 'floor' | 'wall';           // floor items may also be dropped onto furniture tops
  size: Vec3;                        // meters [W, H, D] after normalization
  model: string;                     // "/data/catalog/models/<id>.glb" — bottom-center pivot, +Z front
  thumbnail: string;                 // "/data/catalog/thumbs/<id>.jpg"
  colors: string[];                  // ABO color names, e.g. ["Walnut"]
  colorHex?: Hex;                    // ABO color_code when present
  materials: string[];               // e.g. ["Wood", "Metal"]
  styleTags: string[];               // from ABO `style`, e.g. ["Mid-Century Modern"]
  partParams?: PartParams;
  priceEstimateUsd: number;          // ALWAYS shown as an estimate (§8.3)
  url: string;                       // "https://www.amazon.com/dp/<id>" (dead links accepted)
  attribution: string;               // "Amazon Berkeley Objects (CC BY 4.0)"
}

export interface Catalog { version: 1; items: CatalogItem[] }

export interface LibraryMaterial {   // Phase 2
  id: string;                        // "oak"
  name: string;                      // "Oak"
  kind: 'wood' | 'stone' | 'fabric' | 'metal' | 'carpet' | 'wallpaper' | 'tile';
  maps: { color: string; normal?: string; roughness?: string };  // 1K textures
  tileSize: number;                  // meters per texture repeat (tri-planar)
  source: string;                    // "ambientCG Wood049 (CC0)"
}

/* ───────────── Design and Edits ───────────── */

export type Actor = 'mover' | 'claude';

export interface Placement {
  position: Vec3;                    // bottom-center in the room frame (raw coordinates, always stored)
  rotationY: number;
  mount: 'floor' | 'wall' | 'surface';  // 'surface' = resting on top of furniture
  wallId?: string;                   // when mount === 'wall'
}

export type Finish =
  | { kind: 'paint'; color: Hex }
  | { kind: 'material'; materialId: string; tint?: Hex }   // Phase 2
  | { kind: 'none' };                                      // back to the scanned look

export type FinishTarget =
  | { kind: 'wall'; wallId: string }
  | { kind: 'floor' }                                      // Phase 2
  | { kind: 'original'; originalId: string; partId: string };   // Phase 2; '*' = all Parts

interface EditBase { id: string; at: string; by: Actor }   // id "ed_xxxxxxxx", at = ISO time

export type Edit = EditBase & (
  | { type: 'place';   pieceId: string; catalogId: string; placement: Placement }
  | { type: 'move';    targetId: string; placement: Placement }        // Piece (P1) | Original (P2)
  | { type: 'remove';  targetId: string }                               // Piece (P1) | Original (P2)
  | { type: 'swap';    pieceId: string; catalogId: string; placement: Placement;
                       via: 'swap' | 'resize'; targetSize?: Vec3 }
  | { type: 'replace'; originalId: string; pieceId: string; catalogId: string; placement: Placement;
                       via: 'replace' | 'resize'; targetSize?: Vec3 }
  | { type: 'recolor'; targetId: string; partId: string; color: Hex | null }  // '*' = all Parts; null = clear
  | { type: 'finish';  target: FinishTarget; finish: Finish }
);

export interface Design {
  version: 1;
  id: string;                        // "ds_xxxxxxxx"
  scanId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  origin: Actor;                     // who created this Design
  brief?: Brief;                     // Phase 4
  rationale?: string;                // Phase 4: one line from Claude
  palette?: Palette;                 // Phase 4
  edits: Edit[];
}

export interface Brief { text: string; styles?: string[]; budgetUsd?: number }
export interface Palette { wall: Hex; accents: Hex[]; materials: string[] }

/* ───────────── Derived state (never stored) ───────────── */

export interface RoomState {
  originals: Record<string, {
    visible: boolean;                // false after remove / replace
    placement: Placement;            // from Room Setup; changed by move (P2)
    moved: boolean;
    partColors: Record<string, Hex>;
    partFinishes: Record<string, Finish>;
  }>;
  pieces: Record<string, {
    catalogId: string;
    placement: Placement;
    partColors: Record<string, Hex>;
    replacesOriginalId?: string;
  }>;
  surfaces: { walls: Record<string, Finish>; floor?: Finish };
  patches: string[];                 // ids of Originals whose original footprint needs a Patch
  skipped: { editId: string; reason: SkipReason }[];
}

export type SkipReason = 'missing-target' | 'kept' | 'unknown-catalog' | 'unknown-part' | 'duplicate-id';

export interface FitViolation {
  rule: 'overlap' | 'outside-floor' | 'door-swing' | 'blocks-window' | 'walkway';
  subjectId: string;
  otherId?: string;
  message: string;                   // "Blocks the door swing"
}
```

**ID prefixes:**

| Prefix | Kind |
|---|---|
| `og_` | Original |
| `pc_` | Piece |
| `ed_` | Edit |
| `ds_` | Design |
| `wl_` | Wall |
| `op_` | Opening |

Scan IDs are slugs, such as `lounge-v1`.

---

## 6. Replay semantics: `shared/replay.ts`

`replay(setup, catalog, edits)` starts from the Scan:

- every Original visible, at its Room Setup box, with no colors
- no Pieces
- no Finishes

It then applies the Edits in order. **An Edit that can't apply is skipped and recorded in `skipped`; replay never throws.**

| Edit | Applies when | Effect |
|---|---|---|
| `place` | `pieceId` is new; `catalogId` exists | Adds the Piece |
| `move` | The target exists. If it's an Original: it's visible and **not Kept** | Sets the placement. An Original also gets `moved = true` and is added to `patches`. |
| `remove` | The target exists. If it's an Original: **not Kept** | A Piece is deleted. An Original gets `visible = false` and is added to `patches`. |
| `swap` | The Piece exists; `catalogId` exists | Changes the catalog item and placement. Keeps colors only for Part IDs that exist in both items. |
| `replace` | The Original is visible and **not Kept**; `pieceId` is new | Hides the Original, adds it to `patches`, and adds a Piece with `replacesOriginalId` |
| `recolor` | The target is a Piece, or a visible Original (**Kept Originals may be recolored**); `partId` is in the category's Parts, or is `'*'` | Sets or clears the color. `'*'` sets every Part. |
| `finish` | The target exists | Sets the Finish. `{kind:'none'}` removes it. |

**Rules of thumb:**

- **Undo** removes the *last* Edit. Redo is a client-side stack and isn't saved.
- The **History panel** can delete *any* Edit; replay shows the consequences. For example, deleting a `place` makes a later `recolor` of that Piece skip, and it appears greyed out in History with the reason.
- Removing a Piece that `replace`d an Original does **not** bring the Original back. The spot stays empty with a Patch. To bring the Original back, delete the `replace` Edit.
- `describe(edit, setup, catalog)` returns History text:

  | Edit | Example History text |
  |---|---|
  | `place` | "Placed **Mainstays 5×7 Rug**" |
  | `swap` (via resize) | "Resized desk → **30″ Walnut Desk**" |
  | `recolor` | "Recolored chair legs · Black" |
  | `finish` | "Painted **North wall** · Sage" |
  | `replace` | "Replaced **your chair** with **Ergo Mesh Chair**" |

---

## 7. Parts: `shared/parts.ts` (ADR-0006)

The same rules run on Pieces (Catalog GLBs) and on Originals (cut from the Scan mesh). Each rule is evaluated per triangle, in the object's own frame: bottom-center origin, +Z front, with `h`, `w`, `d` the box height, width, and depth.

| Category | Parts | Rule (defaults; overridable through `partParams`) |
|---|---|---|
| table, desk | `top`, `legs` | `top` if centroid.y ≥ h − 0.06; otherwise `legs` |
| chair | `seat_back`, `legs` | `legs` if centroid.y < 0.45·h; otherwise `seat_back` |
| bed | `frame`, `bedding` | `bedding` if 0.22 ≤ y ≤ 0.70, \|x\| < 0.47·w, and z > −d/2 + 0.12 (away from the headboard at −Z); otherwise `frame` |
| dresser, wardrobe, nightstand, storage | `body`, `fronts` | `fronts` if the normal's z component > 0.7 and centroid.z > d/2 − 0.03; otherwise `body` |
| sofa | `frame`, `cushions` | `cushions` if 0.25·h ≤ y ≤ 0.6·h, \|x\| < 0.45·w, and z > −d/2 + 0.15; otherwise `frame` |
| everything else | `body` | — |

**How a model is prepared at load:**

1. Sort the triangle indices by Part.
2. Add one `BufferGeometry` group per Part.
3. Use one material per group. All the groups share the model's original texture.

Recoloring a Part then only changes that Part's material uniforms.

---

## 8. Catalog

### 8.1 Build pipeline: `scripts/catalog-build.ts`

1. **Get ABO metadata once:** the 16 `listings/metadata/listings_{0..f}.json.gz` files (about 5.4 MB each) and `3dmodels/metadata/3dmodels.csv.gz` from `https://amazon-berkeley-objects.s3.amazonaws.com/`. Join them on `item_id`. Only items that have a 3D model qualify.
2. **Pick items by hand** into `scripts/catalog-picks.json`: `[{ "id": "B0…", "category": "desk", "price": 160 }]`. Filter by `product_type` and keywords, then look at thumbnails. The exact list is deferred; the user will decide later.
3. **For each pick:**
   - Fetch `https://amazon-berkeley-objects.s3.amazonaws.com/3dmodels/original/<path>`.
   - Run `gltf-transform optimize in.glb out.glb --texture-compress webp --texture-size 1024`, which applies meshopt compression by default.
   - Run `gltf-transform center out.glb out.glb --pivot below` to put the origin at the bottom-center.
   - Read the bounding-box size.
4. **Thumbnail:** use the ABO main product image, from the listing's image ID.
5. **Write `data/catalog/catalog.json`.**
   - `styleTags` comes from ABO `style`, `colors` from `color`, `colorHex` from `color_code`, and `materials` from `material`.
   - `url` is `https://www.amazon.com/dp/<item_id>`.
   - `mount` is `'wall'` for `wall_art` and `mirror`, and `'floor'` for everything else.

The loader needs `MeshoptDecoder` (`three/examples/jsm/libs/meshopt_decoder.module.js`) registered on the GLTFLoader. ABO models already use +Y up, +Z front, and meters.

**Targets:** about 20 items by Checkpoint 1, then about 60 in Phase 2. Default category mix for about 60 items:

| Category | Count |
|---|---|
| chairs | 8 |
| desks | 6 |
| tables and nightstands | 6 |
| beds | 4 |
| sofas | 4 |
| rugs | 8 |
| lamps | 8 |
| wall art and mirrors | 8 |
| shelves and storage | 6 |
| decor and plants | 2 |

**Attribution:** the app footer reads "3D models: Amazon Berkeley Objects (CC BY 4.0), Amazon.com."

### 8.2 Search: `shared/catalog-search.ts`

```ts
search(catalog, { category?, text?, color?, maxSize?: Vec3, targetSize?: Vec3, lockHeight?: boolean, limit = 12 })
```

- **Filters:** category, case-insensitive text match on the title or style, color match on `colors` and `colorHex`, and `maxSize` (width and depth).
- **Size closeness**, when `targetSize` is given:

  ```
  score = max(|w−W|/W, |d−D|/D, lockHeight ? |h−H|/H : 0)
  ```

  Sort by score, ascending.
- **Resize result:** items with `score ≤ 0.15` are "Fits." If there are none, return the 3 closest, labeled **"Closest available."** If the category has no items at all, show the empty state; text-to-3D comes in Phase 4 as a stretch.

### 8.3 Estimated prices

ABO has no prices (ADR-0003). `priceEstimateUsd` defaults by category, can be overridden per pick, and is **always displayed as "≈ $X (est.)"**.

| Category | Default | Category | Default |
|---|---|---|---|
| chair | 120 | sofa | 450 |
| desk | 180 | dresser | 220 |
| table | 90 | wardrobe | 260 |
| nightstand | 70 | shelf | 90 |
| bed | 300 | storage | 110 |
| rug | 80 | lamp | 45 |
| wall_art | 40 | mirror | 60 |
| plant | 30 | decor | 25 |

---

## 9. Scan import and Room Setup (Person A)

### 9.1 Capture checklist (the lounge, **before 5 PM today**)

We have **Polycam Business**, so every export format is unlocked, including Gaussian splats as Splat PLY. Polycam builds the splat in its cloud, so we don't train our own.

- [ ] Polycam **Developer Mode ON before capturing** (Settings). The raw data is now only a fallback, but it costs nothing.
- [ ] **Mesh:** capture in LiDAR / "Space" mode.
- [ ] **Splat:** Polycam can't build a splat from a Space capture (see `docs/research/polycam-business.md`). Use one of these:
  - **(a), recommended:** export the Space capture's **video**, then upload it as a Gaussian Splat (**+ → Upload media → Gaussian Splat**). Same walk, same lighting, no second capture.
  - **(b):** a separate Object Mode Gaussian Splat capture right after, with the same lighting.

  Either way the splat has its own coordinates and scale, and gets fitted to the mesh in Phase 3.
- [ ] All lights on. Blinds in their final position, unchanged for the whole capture.
- [ ] The lounge's furniture stays in its usual places for the **Main Capture**; the pieces the building owns become Kept Originals. Personal clutter goes off the floor and tables.
- [ ] Walk slowly, two loops at two heights. Get under the desk and behind the chair.
- [ ] **Capture twice** (a backup).
- [ ] **Fill Captures** (ADR-0007, `.plans/fill-captures-spec.md` §3): only after the Main Capture and every splat video. Move the furniture, keeping it upright: pull sofas off the walls, turn furniture so its back faces the room, move tables off their spots, and leave Kept Originals alone. Same lights. Include at least two room corners and walk around each moved Original. Every non-Kept Original's spot must be uncovered in at least one Fill Capture.
- [ ] **Export:**
  - each Capture's mesh as **GLB** (glTF also works)
  - the splat as **Splat PLY**
  - the **Raw Data** zip, which must be exported *from the phone that captured it*
  - the floor-plan **PDF with measurements**, as a reference for checking dimensions in Room Setup

  AirDrop everything to the M3 Pro. The Splat PLY is large, so keep it out of git; only the compressed `splat.spz` is committed.

Do a **10-minute test scan of the hackathon table area first**. It becomes the development fixture, and it tests export, scale, and up-axis before the lounge capture. Also upload its video as a splat, so the splat route gets tested early too.

### 9.2 `scripts/scan-import.ts <polycam-export> <scanId>`

1. Unzip. Convert to GLB with `gltf-transform copy`, then `gltf-transform optimize --texture-compress webp --texture-size 4096`. If the result is over 500k triangles, add `gltf-transform simplify`.
2. Copy the raw data to `data/scans/<id>/raw/`.
3. Write `manifest.json` with `meshTransform` set to identity. Room Setup step 1 fills it in.
4. Print the triangle count, texture count, bounding box, and which axis is up. Polycam glTF should be +Y up and in meters; **verify this on the test scan.**
5. `--fill` imports a Fill Capture into an existing Scan instead: `captures/fill-<n>.glb`, added to `manifest.captures` with an identity transform. The first one also keeps the Main Capture as `captures/main.glb`. It never touches `room.glb` or `meshTransform`.

### 9.3 Room Setup tool: `/setup/:scanId` (web)

It's a stepper. Each step saves into the same `RoomSetup` object, and **Save** sends it with PUT.

| Step | What the Mover (us) does | Automatic help |
|---|---|---|
| 1. Level | Confirm the floor height and the yaw | **Floor height:** a histogram of the y values of vertices whose normal points up (normal.y > 0.9); the lowest strong peak is the floor. **Yaw:** a histogram of horizontal normal angles, taken mod 90°; rotate so the walls line up with the X and Z axes. Writes `meshTransform`. |
| 2. Ceiling | Confirm the ceiling height | A histogram of vertices whose normal points down; adjust with a slider |
| 3. Corners | Click the room's corners in a top-down view (4 clicks for a rectangular room) | The polygon becomes `floor.polygon`. Each edge becomes a `Wall`, with its inward `normal` computed toward the polygon's centroid. Walls are auto-named by facing (North is −Z). |
| 4. Openings | Pick a wall, then click two opposite corners of the door or window on the wall's surface; choose door or window and the swing | The clicks are projected onto the wall plane, giving `offset`, `width`, `bottom`, and `height` |
| 5. Originals | Click on a piece of furniture | **Auto-box:** collect mesh vertices within 1.0 m of the click that are above the floor (y > 0.03) and more than 3 cm from every wall plane. Region-grow over a 5 cm voxel grid from the clicked voxel. Fit a box aligned with the room yaw. Then adjust it with handles, choose a category and label, and toggle **Kept**. The `partParams` default by category. |
| 6. Fill Captures (Phase 2) | For each Fill Capture: click the same 3–4 floor-level corners in it and in the Main Capture; then click each moved Original's copy in it and pick the Original. **Save** | Floor height found automatically; turn and position solved from the corners, then refined by ICP on the floor and walls of both. Each copy is auto-boxed and registered with its Original (4 starting turns, then ICP). Saving writes `manifest.captures` and rebuilds `room.glb` (`POST /api/scans/:id/merge`, ADR-0007). |
| 7. Bake | Click "Bake" | For each Original, compute `floorColor`: render a top-down orthographic view with Originals hidden, then average the floor pixels in a 15 cm ring around the footprint. *Phase 2:* Patch v2 decals for the gaps no Capture saw (§11.2). |

Lamps, wall art, plants, rugs, and anything else are tagged the same way, by clicking. Polycam doesn't detect furniture.

### 9.4 Load-time split: `web/src/scene/splitScan.ts`

Apply `meshTransform` first. Then, for each triangle, with `c` its centroid and `n` its normal, take the first rule that matches:

0. *Phase 2:* from a primitive the merge tagged as fill (ADR-0007) → **that Original's Patch** (`kind: "patch"`, hidden until the Original is lifted or removed) or **that Original** (`kind: "completion"`).
1. Inside an Original's box (grown by 2 cm), with c.y > 0.02 and more than 2 cm from every wall plane → **that Original**.
2. c.y > ceilingHeight − 0.05 → **Ceiling**.
3. \|c.y\| < 0.03, n.y > 0.8, and inside `floor.polygon` → **Floor**.
4. Within 4 cm of wall *w*'s plane, inside *w*'s extent, \|n · w.normal\| > 0.7, and **not** inside any Opening rectangle → **Wall *w***.
5. Everything else → **Shell**.

Each group becomes its own mesh, sharing the original textures; Polycam may export several primitives and textures, so handle every primitive. For each node, also compute `avgLuminance`: sample the texture at the UV centroids of up to 2,000 random triangles, using an OffscreenCanvas and `getImageData`. **Target: under 500 ms for 500k triangles.**

---

## 10. Editor (Phase 1)

### 10.1 Layout

```
┌──────────────────────────── TopBar: Scan ▾  Design ▾ (New · Duplicate · Rename)   [Dollhouse|Walk]  🛒 ≈$412 ┐
│ Catalog panel        │                                                           │ Inspector             │
│ [Chairs][Desks]…     │                     3D view                               │ (selection actions)   │
│ search  W≤ D≤ color  │                                                           │                       │
│ [thumb][thumb]…      │                                                           ├───────────────────────┤
│                      │                                                           │ History (Edit list)   │
└──────────────────────┴───────────────────────────────────────────────────────────┴───────────────────────┘
                                    footer: ABO attribution
```

### 10.2 Views

- **Dollhouse (default).** An orbiting camera (drei `CameraControls`) looks from above at about 45°.
  - The **Ceiling** node is hidden.
  - Each frame, a **wall fader** hides any Wall node whose plane faces away from the camera (`dot(cameraPos − wallPoint, wall.normal) < 0`), with a 150 ms fade.
  - Orbiting is limited to the room's bounding box plus 2 m.
- **Walk.** The camera sits at an eye height of 1.6 m. Drag to look around. Click the floor to glide there (a 400 ms tween), staying inside `floor.polygon`.

### 10.3 Interactions

| Action | How |
|---|---|
| Select | Click a Piece, Original, or Wall: a press released within `CLICK_TOLERANCE_PX`. An outline appears (drei `Outlines`); `Esc` deselects. Selecting takes the click, not the press, so a drag that starts on an item moves the view and selects nothing. A Piece just added from the Catalog is already selected. |
| Add Piece | Click a Catalog card's **Add**. The Piece is dropped at the floor point under the view center; if that violates a Fit rule, step outward in a 10 cm spiral to the nearest free spot. You can also drag the card into the view. |
| Move | Drag the selected Piece or movable Original; one finger on a touch screen. A drag that starts on any other item, on a Kept Original, or with Shift held moves the view instead, so furniture never moves by accident. The grabbed point stays under the pointer. The raycast hits the floor, or **any upward-facing surface** (normal.y > 0.8, like a desk top), giving `mount: 'surface'`. Wall items drag along wall planes. The cursor is `pointer` over an unselected item, `move` over the selected one, and `grabbing` while it moves. |
| Wall snap | If the Piece's back is within 10 cm of a wall and the angle is within 20° of the wall's normal, it snaps flush and aligns. |
| Rotate | `R` / `Shift+R` rotates ±15°, or use the rotation ring handle |
| Remove | `Delete`, or the Inspector button |
| Undo / Redo | `⌘Z` / `⇧⌘Z` |
| Autosave | Each Edit is appended to the Design and saved with PUT, debounced 500 ms |

Moves create **one Edit when the drag ends**, not one per frame.

### 10.4 Inspector actions (Phase 1)

| Selection | Actions |
|---|---|
| **Piece** | Title, real size (in inches and cm), "≈ $X (est.)", link · **Swap** (same-category list sorted by size closeness) · **Resize** (§10.5) · **Recolor** (pick a Part: legs, top, …, or All; then a color picker plus 12 curated swatches) · Rotate · Remove |
| **Original** | Label, size, Kept badge · **Replace** (Catalog picker, same category first, which creates a `replace` Edit with the Piece placed in the Original's box) · **Resize** (§10.5, creates a `replace` Edit) · *Recolor per Part: nearly free once Parts work, so pull it into Phase 1 if you're ahead* |
| **Wall** | **Paint**: a color picker plus curated swatches (Sage, Warm White, Navy, Terracotta, Greige, Blush, …), plus "Reset to scanned" |

### 10.5 Resize flow

1. Click **Resize**. A wireframe box with face handles appears on the selection; drag the handles to set width and depth. Height is free unless 🔒 is on.
2. As the handles move, the panel shows live candidates from `search({ category, targetSize })`: up to 3 "Fits" or 3 "Closest available," each with a thumbnail, size, and price. A category dropdown lets the Mover search a different category, such as table → desk.
3. Pick a candidate. A Piece gets a `swap` Edit with `via: 'resize'`; an Original gets a `replace` Edit with `via: 'resize'`. The new item keeps the *back-center* of the old one, so items against a wall stay against the wall.

### 10.6 Rendering

- **Scan nodes:** `MeshBasicMaterial` (unlit), because the texture already contains the room's real lighting.
- **Pieces:** keep their GLB `MeshStandardMaterial`, lit by drei `<Environment preset="apartment" />` plus a soft hemisphere light. In Phase 3 this becomes an environment captured from the Scan.
- **Recolor and Paint keep the real lighting** (`web/src/scene/materials/recolor.ts`, which patches the shader with `onBeforeCompile`):

  ```glsl
  float relLum = luminance(texel.rgb) / avgLuminance;     // keeps light and shadow, drops the old color
  vec3 outColor = targetColor * clamp(relLum, 0.0, 2.0);
  ```

  Walls, Originals, and Piece Parts all use this. Because it divides by the *average*, dark → light works, for example walnut → white.
- **Blob shadow:** a soft radial-gradient plane under each floor Piece, 110% of its footprint, at 35% opacity. Originals already have real shadows baked into the Scan.
- **Simple Patch** (Phase 1, for `replace`): a rounded rectangle on the floor at y = 0.002, the size of the footprint plus 10 cm, in the Original's `floorColor`, with a feathered alpha edge. In Phase 2 it is only the fallback: an Original's captured Patch (from a Fill Capture) draws on top of the floor and wall, over Patch v2 decals for any gaps.
- **Fit violations:** a red outline plus a short message chip ("Blocks the door"). **For manual edits they are warnings, never blocks.**

### 10.7 Shopping list (🛒)

It lists every Piece in the Design with its thumbnail, title, "≈ $X (est.)", and a **View on Amazon** link (`url`). The total is shown as "≈ $412 estimated." Originals and Kept items are listed separately as "Already in your room."

### 10.8 Designs

- `/` lists Scans and their Designs.
- **New Design** creates an empty Edit list. **Duplicate** copies the Edits. **Rename** edits the name inline.
- All are saved with PUT to `data/designs/<id>.json`.

---

## 11. Phase 2: Originals and Finishes

### 11.1 Scope

| Feature | Notes |
|---|---|
| **Move / rotate Originals** (Lift) | Originals are already separate nodes after the split, so they drag exactly like Pieces. Kept Originals show a lock and can't move. The old footprint gets a Patch. *Accepted flaw:* a moved Original keeps the lighting baked in at its old spot, and its unseen back or underside may show holes. |
| **Remove Original** | Hides it and shows its Patch |
| **Recolor Original Parts** | The same shader, using the rules from §7 on the cut-out geometry |
| **Finishes with materials** | **Material Library**: about 20 CC0 materials at 1K (ambientCG and Poly Haven): oak, walnut, maple, cherry, marble, concrete, linen, velvet, leather, brushed metal, and 3 carpets, 3 wallpapers, and 2 tiles. They're applied by **tri-planar projection** (custom GLSL in `onBeforeCompile`, because the TSL `triplanarTexture` needs node materials). The result is multiplied by `relLum` so the real lighting stays. Finishes can go on Walls (wallpaper), the Floor (carpet, wood, tile), and Original Parts ("oak top"). |
| **Patches from Fill Captures** (ADR-0007, `.plans/fill-captures-spec.md`) | The Fill Capture's floor and wall inside the Original's box grown by 10 cm, color-matched, shown once it's lifted or removed. Moved Originals also get their unseen backs and sides from the Fill Capture. Patch v2 (§11.2) covers only the gaps. |
| **Catalog to about 60 items**, **Material Library build** | `scripts/materials-build.ts` |

### 11.2 Patch v2: generated fill for the gaps no Capture saw, baked during Room Setup

Most of a Patch comes from a Fill Capture (§11.1, ADR-0007). Patch v2 fills only what no Capture saw, on the floor and on the walls behind the Original.

1. For each non-Kept Original, render a top-down orthographic view covering the footprint plus a 40 cm margin, at 512×512, with alpha. Draw the **Floor node with the Patch region (the box grown by 10 cm) cut out**, then the Original's **captured Patch** node.
2. Pixels with **alpha = 0** inside the region are the gaps. (Where there is no Fill Capture, that is the whole footprint, and the old mask of the footprint plus 5 cm still applies, to remove the contact shadow.)
3. Fill the masked pixels in the browser with **push-pull diffusion**: average inward from the boundary across a few mip levels. This handles plain floors (carpet, vinyl, wood) well.
4. Do the same for each wall within 10 cm of the grown box, with an orthographic camera facing the wall over the strip behind the Original.
5. *Optional upgrade:* send the same image and mask to an inpainting model on fal. Choose the model during the spike; this isn't required.
6. Save `patches/<id>.floor.png` and `patches/<id>.<wallId>.png`, and set `original.patch = { floor, walls }`. Render them as decals (floor at y = 0.002, walls 2 mm in front of their wall) with a feathered edge, under the captured Patch.

---

## 12. Phase 3: Photoreal (time-boxed to Sun 4:00 AM)

| Step | Details |
|---|---|
| **Get the splat** (start Polycam's cloud processing **right after the lounge capture**, around 5 PM) | Upload the Space capture's video as a Gaussian Splat, or use a separate Object Mode splat capture (§9.1). Polycam builds it in its cloud, in a few minutes to an hour. Export it as **Splat PLY** to the M3 Pro. **Fallback**, if Polycam's splat looks poor indoors: train one from the Developer Mode raw data with msplat (`pip install "msplat[cli]"`, then `msplat-train data/scans/lounge-v1/raw -n 30000`; roughly 25–45 minutes on the M3 Pro, estimated). The raw data carries the LiDAR capture's own camera poses, so a msplat splat needs almost no fitting. It will likely look softer. |
| **Level, clean, and compress** | First, in SuperSplat:<br>• level the splat (its Orient tool fixes a tilted capture)<br>• set a rough real-world scale by measuring a known length, such as the door width<br>• remove floaters<br>• export a PLY<br>Then run `@playcanvas/splat-transform`:<br>• crop to the room box<br>• decimate to ≤ 1.5M splats (`-d`)<br>• strip the higher spherical-harmonic bands (`-H`)<br>• write `data/scans/<id>/splat.spz`<br>Add `"splat": "splat.spz"` to the manifest. |
| **Align** | The editor's Align panel (#16):<br>• click the same 3–4 points on the splat and on the mesh (room corners at floor level work well)<br>• solve for yaw, uniform scale, and translation (the splat is already level)<br>• fine-tune with sliders<br>• save the result as `splatTransform` in the manifest<br>The "180° about Y, ×100 scale" step in Polycam's Unity guide fits a splat to *its own capture's* mesh inside Unity, so it doesn't apply here. |
| **Render** | Spark 2.3.1 in R3F: `extend({ SparkRenderer, SplatMesh })`, a `<sparkRenderer args={[{ renderer: gl }]}>` with a `<splatMesh args={[{ url }]}>` inside. Use **Vite**: Spark's R3F examples break under Webpack. |
| **Touched means mesh** (ADR-0005) | For every touched Original, Wall, or the Floor: add a `SplatEditSdf` of type BOX with **opacity 0** over its region, and show its mesh node with the change. For a lifted or removed Original, the box is its box grown by 10 cm, the same region as its Patch. A painted wall uses a thin box over the wall slab. **Verify in the spike** how to keep Opening splats visible: a second SDF with opacity 1 per Opening, or showing the Opening's mesh instead. |
| **Room lighting for Pieces** | A `CubeCamera` at the room center, 1.2 m high, renders the mesh look once, run through `PMREMGenerator`, and is used as the `envMap` for Piece materials only |
| **Realism levels** (TopBar toggle) | **Quick:** mesh look plus blob shadows. **Real** (default when a splat exists): splat look, room environment lighting, and blob shadows. **Max:** Real plus a directional light from the largest window casting shadows onto a `ShadowMaterial` copy of the Shell, Floor, and Wall nodes. |
| **Fallback** | If the splat isn't convincing by 4:00 AM, ship Quick only. The editor and Edits don't change. |

---

## 13. Phase 4: Claude (Brief → 3 Designs)

> When implementing, load the `claude-api` skill and use the TypeScript SDK's Tool Runner (`client.beta.messages.toolRunner` with `betaZodTool`) for exact usage. **Never guess SDK calls.**

### 13.1 Flow

1. The Brief dialog takes free text, style chips (Japandi, Minimal, Mid-century, Cozy, Industrial, Boho), and an optional budget. It sends `POST /api/generate { scanId, brief }`.
2. The server builds a **Room Summary** (JSON): the room size, each wall's name and length, the Openings, each Original (id, label, category, size, Kept, and position in words like "against North wall, left side"), the largest free floor rectangles, and the Catalog categories with item counts.
3. It runs **3 agent loops in parallel**, each with a different direction:
   - **1:** the most literal reading of the Brief
   - **2:** a bolder take
   - **3:** budget-conscious
4. Each loop edits an in-memory Design through the tools below. The tools call the *same* `replay`, `fit`, `catalog-search`, and `anchors` modules from `shared/`.
5. The server saves the 3 Designs (`origin: 'claude'`, with `brief`, `rationale`, and `palette`) and returns them. If one fails, the other two are still returned.
6. The editor shows 3 cards. Opening one **replays its Edits with animation**, about 350 ms each:
   - paint fades in
   - Pieces drop in from 0.3 m above
   - replaced Originals fade out

   A **Replay** button runs it again.
7. **Refine:** `POST /api/designs/:id/refine { text }` runs one loop with the current Design as context and appends Claude's Edits (`by: 'claude'`).

### 13.2 Tools (all `strict: true`)

| Tool | Input | Output |
|---|---|---|
| `search_catalog` | `{ category, text?, color?, max_width_m?, max_depth_m?, max_price_usd?, limit? }` | Items: id, title, size, colors, styles, est. price |
| `place_piece` | `{ catalog_id, anchor }` | `{ piece_id, placement }`, or an error listing Fit violations |
| `replace_original` | `{ original_id, catalog_id }` | `{ piece_id }`, or an error (Kept, or a Fit violation) |
| `recolor` | `{ target_id, part_id, color }` | ok, or an error |
| `apply_finish` | `{ target, finish }` (walls only until Phase 2 ships Finish materials) | ok, or an error |
| `remove` | `{ target_id }` | ok, or an error |
| `finish_design` | `{ name, rationale, palette }` | ends the Design |

**Anchors** (`shared/anchors.ts` resolves an Anchor to a Placement; raw coordinates are stored in the Edit):

| Anchor | Means |
|---|---|
| `against_wall { wall_id, along: 'left' \| 'center' \| 'right' \| 0..1 }` | Back flush to the wall, at that position along it |
| `beside { target_id, side: 'left' \| 'right' \| 'front' }` | Next to an Original or Piece |
| `under_window { opening_id }` | Centered below a window |
| `on_wall { wall_id, along, center_height_m? }` | Wall-mounted. The default center height is 1.45 m (57″, the gallery standard). |
| `on_top_of { target_id }` | Resting on a furniture top (`mount: 'surface'`) |
| `centered_under { target_id }` | Rugs: centered under a bed or sofa, about 1/3 under it |
| `open_floor { near_id? }` | The largest free spot, optionally near something |

If the resolved Placement violates a Fit rule, the resolver **slides it along the wall or anchor in 10 cm steps, up to ±1 m**, before returning an error. That saves the model from retrying.

**Fit rules for Claude** are **enforced**. They are the Phase 1 rules plus `walkway`: on a 5 cm occupancy grid, inflate floor items (except rugs) by 0.30 m; then a path must exist from each door to the front of the bed, the desk, and the dresser.

### 13.3 Model and parameters

| Setting | Value |
|---|---|
| Model | **`claude-opus-5-5`** (Claude Opus 5.5) |
| Effort | `output_config: { effort: "low" }`, for speed. Raise it to `"medium"` if Designs look sloppy. Thinking stays adaptive, which is the default. |
| Tool choice | `tool_choice: { type: "auto" }`. Forced tool choice returns a 400 on this model; the system prompt tells Claude to act only through tools and to finish with `finish_design`. |
| Refusal fallback | `fallbacks: "default"` with the beta `server-side-fallback-2026-07-01`, as the claude-api skill recommends by default |
| Limits | At most 14 tool calls per Design, and a 45 s timeout per loop |
| If it's too slow (over 30 s for 3 Designs) | Fast mode (`speed: "fast"`, beta `fast-mode-2026-02-01`, Claude API only): up to 2.5× faster output at 2× the price |

**System prompt outline:**

- **Role:** an interior designer for people moving into a new space.
- **Use only the tools;** never invent IDs or coordinates.
- **Respect Kept** furniture and the **budget** (sum of estimated prices).
- **Make 5–9 Edits:** one wall color *or* an accent wall, at least one rug or lighting Piece, wall art, and at most 2 large-furniture changes.
- **Commit to a Palette first** and choose Pieces whose colors and styles match it.
- **The direction** for this loop (1, 2, or 3).
- **Finish** by calling `finish_design` with a name of 3 words or fewer and a one-line rationale that mentions the Brief.

**Stretch: text-to-3D.** When a search returns nothing for a category the Mover asked for, call TRELLIS.2 on fal (about $0.25–0.35 per object, returns a GLB with PBR materials, roughly 30–90 s). Normalize it into the target box and add it to the Catalog as `source: 'generated'`. It's never on the demo path.

---

## 14. Schedule (Sat 2:15 PM → Sun 10:00 AM)

| Time | Person A (Scan and rendering) | Person B (editor, Catalog, Claude) |
|---|---|---|
| 2:15–2:45 | **Both:** scaffold the repo, paste `shared/types.ts`, get `npm run dev` working | ← same |
| 2:45–3:15 | Test scan of the venue table (mesh, Developer Mode ON; upload its video as a splat) → `scan-import` → fixture | ABO metadata download; pick 15 items; start `catalog-build` |
| 3:15–5:00 | **Lounge Main Capture ×2, then Fill Captures** (including travel) → AirDrop → `scan-import lounge-v1` | Editor shell: Canvas, fixture mesh, Dollhouse camera, hand-written fixture `setup.json`, Catalog panel, Add Piece |
| 5:00–6:00 | Start Polycam's splat processing; it runs in Polycam's cloud. Room Setup steps 1–3 (level, ceiling, corners → walls). | Selection + Inspector; Move / Rotate drag, wall snap, drop onto surfaces; Remove |
| 6:00–7:00 | Dinner | Dinner |
| 7:00–8:30 | Room Setup steps 4–6 (Openings, auto-box Originals, Bake), Save; `splitScan` | `replay` + `describe` + History panel + Undo; Designs save and load through Hono |
| 8:30–10:00 | Paint (`recolor.ts` + `avgLuminance`); `parts.ts` + per-Part Recolor; simple Patch + Replace | Swap; Resize flow; `fit.ts` (overlap, outside-floor, door-swing, blocks-window) with red highlight; Shopping list |
| 10:00–10:30 | **Both:** submit the **Devpost draft**: both members with Discord names, and tracks (§15.3) | ← same |
| **10:30 PM** | ✅ **Checkpoint 1: Phase 1 works end to end on the lounge Scan** | |
| 10:30–2:00 | Phase 2: Fill Captures (align, merge, captured Patches; ADR-0007); Material Library + tri-planar Finishes on walls, the floor, and Original Parts | Phase 2: Move and Remove Originals + Kept; Patch v2 bake; Catalog to about 60 items |
| 2:00–4:00 | Phase 3: Spark splat look, alignment, touched-means-mesh | Phase 3: Realism toggle, room environment lighting, Max cast shadows |
| **4:00 AM** | ⏱ **Time-box:** cut whatever isn't working in Phase 3. **Phase 4 starts.** | |
| 4:00–7:30 | `anchors.ts`, the walkway Fit rule, the reveal animation, Refine | `/api/generate`: Room Summary, tools, 3 parallel loops, Brief dialog, Design cards |
| 7:30–9:00 | **Feature freeze.** Rehearse the demo; record the demo video. | Devpost write-up, README, screenshots |
| 9:00–9:45 | **Final submission** (the deadline is 10:00 AM; don't cut it close) | ← same |

Plan one staggered 90-minute nap each, during Phase 2 or Phase 3, where the schedule has the most slack.

---

## 15. Demo and submission

### 15.1 Demo script (about 3 minutes, on the M3 Pro)

1. **Hook (15 s):** "Every freshman furnishes a dorm blind. Will this desk fit? Will this rug clash with the school's dresser? Mise lets you try it in *your* room first."
2. **The Scan (20 s):** Walk view through the real lounge. "Scanned with an iPhone in two minutes."
3. **Customize (75 s):**
   - Select the lounge armchair → **Replace** it with an ABO chair.
   - **Recolor** its legs black.
   - **Paint** the accent wall sage; the real window light stays on the wall.
   - **Add** a rug and a desk lamp onto the desk.
   - **Resize** the desk 6″ wider; 3 real desks that fit appear; pick one.
   - Drag a dresser into the door's path: it glows red, "Blocks the door."
   - Recolor the dresser's fronts.
4. **Generate (45 s):** Brief: "cozy Japandi, under $400, I need a reading corner." Three Designs appear. Open one; the room assembles itself, Edit by Edit.
5. **Decide and buy (20 s):** Shopping list: "≈ $386 estimated," with links. "Discovery, decision-making, personalization: in your actual room."
6. **Realism (5 s):** Quick → Real toggle, if Phase 3 shipped.

### 15.2 Backup plan

- Two pre-generated Claude Designs are already saved, in case the network fails.
- The demo video is recorded by 9:00 AM.
- The fixture scan is the fallback room.

### 15.3 Devpost checklist

- [ ] **Draft by Sat 10:30 PM:** both members as contributors, **Discord names**, and tracks.
- [ ] **Tracks:**
  - **Visa: Reimagine Shopping**. Ask on the DubHacks Discord whether it's a *title* or *side* track. If it's a side track, the title track is **Chef's Choice**.
  - Side tracks: **CloudForce Most Viral / Most Interesting**.
  - The MLH Gemini track no longer applies, because the Photo button was dropped.
- [ ] A public GitHub repo, with the code written during the event (the 70/30 rule). ABO attribution goes in the README.
- [ ] A demo video; some side tracks judge by video.
- [ ] The write-up uses Visa's words: generative AI, discovery, decision-making, personalization.

---

## 16. Risks and hour-1 spikes

| # | Risk | Spike (owner, when) | If it fails |
|---|---|---|---|
| 1 | The Polycam mesh export is too heavy, has many textures, or has an unexpected up-axis or scale | A, test scan, 2:45 PM: run `scan-import` and inspect the printout | `gltf-transform simplify`; fix the axis in `meshTransform` |
| 2 | Polycam's splat looks poor indoors, or can't be fitted to the mesh closely enough | A, test scan: upload the Space video as a splat, export the Splat PLY, and try a 4-point fit against `room.glb` | Train from the raw data with msplat: it lines up with the mesh almost automatically, but looks softer. If that fails too, cut Phase 3 and ship the mesh look. |
| 3 | Load-time split is too slow or misassigns triangles | A, ~7 PM, on the lounge mesh | Run the split once in Room Setup and save the per-Original index lists in `setup.json` |
| 4 | Texture readback for `avgLuminance` fails (CORS, compressed textures) | A, ~8:30 PM | Use a fixed `avgLuminance` of 0.5 per node, tuned by eye |
| 5 | Some ABO GLBs fail to optimize, or come out bigger than 2 MB | B, 2:45 PM, on 15 items | Drop those items; there are about 1,200 chairs to choose from |
| 6 | The height rules for Parts look wrong on real items | A/B, ~9 PM | Tune `partParams` per item or Original |
| 7 | Spark 2.x inside R3F (`extend`, `SplatEdit` BOX, Opening exclusion) | A, start of Phase 3 | Ship the Quick level only (ADR-0005 fallback) |
| 8 | 3 Claude Designs take more than 30 s | B, early in Phase 4 | Fast mode; fewer Edits per Design; stream the cards in as each one finishes |
| 9 | Too little sleep causes demo-day bugs | Both | Feature freeze at 7:30 AM is non-negotiable |
| 10 | A Fill Capture doesn't line up within about 1 cm (each Capture drifts differently), or Captures are exposed differently | A, first Fill Capture: align it and check the residual and the Patch seams | Per-Patch color gain hides exposure; Patch v2 decals under the captured Patch hide small gaps; at worst, fall back to Patch v2 alone |

---

## 17. Cut order

If behind, cut from the top of this list down.

1. Text-to-3D fallback
2. Max realism (cast shadows)
3. Refine
4. Room environment lighting
5. Splat look (Phase 3 entirely). Ship the mesh look.
6. Wallpaper and floor Finishes
7. Completing moved Originals from Fill Captures
8. Patches from Fill Captures and Patch v2. Keep the simple Patch.
9. Move and Remove Originals

**Never cut:**

- Phase 1 in full: Scan → Room Setup → editor → Place, Move, Swap, Resize, Recolor per Part, Paint, Replace, History, Designs, shopping list
- A minimal **Brief → 3 Designs**

---

## 18. Open items (decided later, low stakes)

- The exact Catalog items. Deferred by the user; the category mix in §8.1 is the default.
- Whether Visa is a title track or a side track. Ask on Discord before 10:30 PM.
- Who is Person A and who is Person B.
- The fal inpainting model for the optional Patch v2 upgrade, and confirming TRELLIS.2 for text-to-3D.
- **Resolved, Sat 4:30 PM: we won't import Polycam's floor plan.** Its furniture detection skips beds, desks, chairs, tables, and sofas. The plan is 2D, and nothing documents how it lines up with the mesh. Room Setup stays manual; for a dorm it's about 10 minutes of clicking, against 2–3 hours to build an importer. Details: `docs/research/polycam-business.md`.
- Later, after the hackathon: our own RoomPlan or AI auto-setup that writes the same `RoomSetup`.
