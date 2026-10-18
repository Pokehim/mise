// A Floor Plan, as Claude reads it (ADR-0011): the rooms it draws, each with its corners and
// Openings, and the printed dimensions that give it a scale. Furniture drawn on the plan isn't read,
// as a room built from a plan starts empty. Everything is in pixels of the stored image: origin
// top-left, x right, y down. The server asks Claude for exactly this shape (server/floor-plan/read.ts);
// Room Setup corrects it, and planToSetup builds the room from it.
import { z } from 'zod';

const Point = z.object({ x: z.number(), y: z.number() });

const DraftOpening = z.object({
  kind: z.enum(['door', 'window']),
  /** Its two ends, on the wall's interior face. */
  from: Point,
  to: Point,
  /** A door's hinge side, from its swing arc, seen from inside the room; null for a window. */
  swing: z.enum(['in-left', 'in-right', 'none']).nullable(),
});

const DraftRoom = z.object({
  /** As printed: "Bedroom", "412". */
  label: z.string(),
  /** The room's interior wall faces, in order around it. */
  corners: z.array(Point),
  openings: z.array(DraftOpening),
});

export const FloorPlanDraftSchema = z.object({
  rooms: z.array(DraftRoom),
  /** Each printed dimension Claude could tie to two points, in meters. */
  scaleHints: z.array(z.object({ text: z.string(), meters: z.number(), from: Point, to: Point })),
  /** Meters, only when printed. */
  ceilingHeight: z.number().nullable(),
  /** What Claude was unsure of. */
  notes: z.string(),
});

export type FloorPlanDraft = z.infer<typeof FloorPlanDraftSchema>;
export type DraftRoom = z.infer<typeof DraftRoom>;
export type DraftOpening = z.infer<typeof DraftOpening>;
export type DraftPoint = z.infer<typeof Point>;

/** A draft with nothing in it, for a plan Claude couldn't read, or wasn't asked to: the Mover traces it by hand. */
export const emptyDraft = (): FloorPlanDraft => ({ rooms: [], scaleHints: [], ceilingHeight: null, notes: '' });

/* ───────────── Lengths ───────────── */

const FRACTIONS: Record<string, string> = { '¼': ' 1/4', '½': ' 1/2', '¾': ' 3/4', '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8' };
const INCH = 0.0254;

/** A whole number with an optional fraction after it, "11 1/16", as a number. */
function mixed(whole: string | undefined, numerator?: string, denominator?: string) {
  return Number(whole ?? 0) + (numerator && denominator ? Number(numerator) / Number(denominator) : 0);
}

/**
 * A length as a plan prints it or a Mover types it, in meters: 12'6", 12' 6", 12'-6", 13'-3⅛",
 * 12 ft, 150", 150 in, 3.81 m, 381 cm, 3810 mm. Null when it isn't one.
 */
export function parseLength(text: string): number | null {
  const t = text.trim().toLowerCase()
    .replace(/[¼½¾⅛⅜⅝⅞]/g, (fraction) => FRACTIONS[fraction])
    .replace(/[’′]/g, "'").replace(/[”″]|''/g, '"').replace(/\s+/g, ' ');
  const metric = /^(\d+(?:\.\d+)?) ?(m|cm|mm)$/.exec(t);
  if (metric) return Number(metric[1]) / { m: 1, cm: 100, mm: 1000 }[metric[2] as 'm' | 'cm' | 'mm'];
  const feet = /^(\d+(?:\.\d+)?) ?(?:'|ft|feet)(?: ?-? ?(\d+(?:\.\d+)?)(?: (\d+)\/(\d+))? ?(?:"|in|inches)?)?$/.exec(t);
  if (feet) return Number(feet[1]) * 12 * INCH + mixed(feet[2], feet[3], feet[4]) * INCH;
  const inches = /^(\d+(?:\.\d+)?)(?: (\d+)\/(\d+))? ?(?:"|in|inches)$/.exec(t);
  if (inches) return mixed(inches[1], inches[2], inches[3]) * INCH;
  return null;
}

/** A length in meters as a plan in the US would print it: 13' 3", or 9" under a foot. */
export function formatFeet(meters: number): string {
  const inches = Math.round(meters / INCH);
  const [feet, rest] = [Math.floor(inches / 12), inches % 12];
  return feet ? `${feet}′ ${rest}″` : `${rest}″`;
}

/* ───────────── Scale ───────────── */

/** The meters per pixel a scale hint gives, or null when its ends are the same point. */
export function hintScale({ meters, from, to }: FloorPlanDraft['scaleHints'][number]): number | null {
  const pixels = Math.hypot(to.x - from.x, to.y - from.y);
  return pixels > 1 && meters > 0 ? meters / pixels : null;
}

/**
 * The plan's scale, from its printed dimensions: the first hint as long as an edge of the room
 * (within 5%), which is most likely a room dimension rather than a detail; else the first usable
 * hint; else null, and the Mover sets the scale by hand.
 */
export function draftScale(draft: FloorPlanDraft, room: DraftRoom | undefined): number | null {
  const edges = (room?.corners ?? []).map((a, i, corners) => {
    const b = corners[(i + 1) % corners.length];
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
  const usable = draft.scaleHints.filter((hint) => hintScale(hint) !== null);
  const matching = usable.find((hint) => {
    const pixels = Math.hypot(hint.to.x - hint.from.x, hint.to.y - hint.from.y);
    return edges.some((edge) => Math.abs(edge - pixels) <= 0.05 * edge);
  });
  const hint = matching ?? usable[0];
  return hint ? hintScale(hint) : null;
}
