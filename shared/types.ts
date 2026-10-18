// shared/types.ts — Mise contract v1. Meters, +Y up, floor at y = 0.

import type { Direction } from './generate';

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
  id: string;                        // "lounge"
  name: string;                      // "Maple Hall 412"
  mesh: string;                      // file in the scan folder: "room.glb"
  meshTransform: YawTransform;       // Polycam frame → room frame (set by Room Setup step 1)
  splat?: string;                    // Phase 3: "splat.spz"
  splatTransform?: YawTransform & { scale: number }; // Phase 3: splat frame → room frame
  captures?: ScanCaptures;           // Phase 2 (ADR-0007): what room.glb was merged from
  floorPlan?: FloorPlanSource;       // ADR-0011: built from a Floor Plan; there are no Captures and no room.glb

  mine?: boolean;                    // the Mover's own: listed under "Your Scans" on Home
  library?: LibraryEntry;            // a room of the floor plan library, which Home's "Import" searches
}

/** Who a library room is for, as the Mover would search for it. */
export interface LibraryEntry {
  school: string;                    // "University of Washington"
  aliases: string[];                 // ["UW", "UDub"]
  hall: string;                      // "Lander Hall"
  room: string;                      // "Double, private bath"
}

export interface FloorPlanSource {
  image: string;                     // "plan/floor-plan.png": what Claude read, and Room Setup's backdrop
  draft: string;                     // "plan/draft.json": Claude's reading of it, in that image's pixels
  metersPerPixel: number;            // set in Room Setup from a printed dimension
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
  surfaces?: RoomSurfaces;           // ADR-0010: a room with no Capture, drawn from this setup alone
  wholeEmptyRoom?: true;             // the mesh has the floor and walls whole behind every Original (a synthetic Scan), so
                                     // the Empty Room shows where an Original stood, and no Patch is drawn
}

/**
 * What a room with no Capture is made of, so the editor can draw it as it really is (ADR-0010).
 * Its light is computed when it loads, so paint and Finishes keep the room's light and shadows.
 */
export interface RoomSurfaces {
  walls: 'drywall' | 'cinderblock';
  wallColor: Hex;                    // the paint on the walls now: "#ece8df"
  floor: string;                     // a Material Library id ("carpet-grey", "oak"), or "vct": vinyl tile
  ceiling: 'drywall' | 'acoustic-tile';
  baseboard: 'rubber' | 'wood';
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

/** A solid part of an item, in its own frame: meters from its bottom-center pivot, +X its right, +Z its front. */
export interface CollisionBox { min: Vec3; max: Vec3 }

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
  model?: string;                    // Master Copy file in the Scan folder, e.g. "models/chair.glb" (ADR-0009). When set, the
                                     // Original is drawn from it at box.position / box.rotationY, and its Parts are the file's
                                     // top-level node names except "shadow". Category Part rules (ADR-0006) don't apply.
  collision?: CollisionBox[];        // its Master Copy's solid parts, at most 12, inside box.size; absent: one solid box (#129)
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
  source: 'abo' | 'polyhaven' | 'gso' | 'sketchfab' | 'generated' | 'publicdomain';   // gso: Google Scanned Objects
  title: string;
  brand?: string;
  category: Category;
  mount: 'floor' | 'wall';           // floor items may also be dropped onto furniture tops
  size: Vec3;                        // meters [W, H, D] after normalization
  collision?: CollisionBox[];        // its solid parts, at most 12, fitted to its model, inside size; absent: one solid box (#129)
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
  | { type: 'recolor'; targetId: string; partId: string; color: Hex | null;  // '*' = all Parts; null = clear
                       sameModel?: true }                                   // every Original with the same `model` (ADR-0009)
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
  direction?: Direction;             // Phase 4: which of the Brief's three takes Claude made it as
  rationale?: string;                // Phase 4: one line from Claude
  palette?: Palette;                 // Phase 4
  startedFrom?: { designId: string; edits: number };  // Phase 4: made by Claude on top of that Design, from its first `edits` Edits
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
