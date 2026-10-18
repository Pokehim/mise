// Reading a Floor Plan with Claude (ADR-0011): the stored plan image in, a FloorPlanDraft out, in that
// image's pixels. Room Setup shows the draft over the plan for the Mover to correct, so a reading
// that fails, or one Claude isn't asked for, is an empty draft the Mover traces by hand.
import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { type DraftPoint, emptyDraft, type FloorPlanDraft, FloorPlanDraftSchema, type PlanReading } from '../../shared/floor-plan';

const MODEL = 'claude-opus-5-5';
/** A plan can take Claude a while to measure; past this, the Mover traces it instead. */
const TIMEOUT_MS = 120_000;

const SYSTEM = `You read architectural floor plans of student housing for an interior design app. A student \
uploads the plan of the room they'll live in; you report its walls, doors and windows, as coordinates in \
the image's pixels, and the app builds the empty room in 3D from them. The student then checks your reading over the \
plan and corrects it, so an honest gap is better than a confident guess: leave out anything you can't see, \
and say what you left out in notes.`;

/** What to read off the plan, and how to report it. */
function request({ width, height }: { width: number; height: number }) {
  return `This floor plan image is ${width} × ${height} pixels. Report every coordinate in its pixels: the \
origin is the top-left corner, x runs right and y runs down.

- rooms: every room enclosed by walls all the way around (a bedroom, and a bathroom or closet if the plan \
draws one as its own room). label: as printed, or what it is ("Bedroom").
  - corners: the room's INTERIOR wall faces (the inside line of each thick wall, not its centerline), in \
order around the room. Include every corner, including notches and recesses that are part of its floor.
  - openings: each door and window in the room's walls. from and to are its two ends, on the interior wall \
face. A door's swing is its hinge side, read from the swing arc, as seen standing inside the room facing \
the door: "in-left" or "in-right"; "none" for a door that slides or opens outward. A window's swing is null.
  - Don't report furniture or fixtures: the room is built empty.
- scaleHints: every printed dimension you can tie to two points: text as printed (13'-3 1/8"), meters \
(converted exactly: 1 in = 0.0254 m), and from and to, the ends of the length it labels.
- ceilingHeight: in meters, only if the plan prints it; otherwise null.
- notes: anything you were unsure of or left out. Never invent a dimension.`;
}

/** The draft, trimmed to what's usable: points on the image, and rooms of 3 or more corners. */
export function cleanDraft(draft: FloorPlanDraft, { width, height }: { width: number; height: number }): FloorPlanDraft {
  const onImage = ({ x, y }: DraftPoint) => Number.isFinite(x) && Number.isFinite(y) && x >= -2 && y >= -2 && x <= width + 2 && y <= height + 2;
  return {
    ...draft,
    rooms: draft.rooms
      .map((room) => ({
        ...room,
        openings: room.openings.filter(({ from, to }) => onImage(from) && onImage(to)),
      }))
      .filter((room) => room.corners.length >= 3 && room.corners.every(onImage)),
    scaleHints: draft.scaleHints.filter(({ from, to, meters }) => onImage(from) && onImage(to) && meters > 0),
    ceilingHeight: draft.ceilingHeight && draft.ceilingHeight > 1.8 && draft.ceilingHeight < 6 ? draft.ceilingHeight : null,
  };
}

/**
 * Claude's reading of a plan image: a PNG, `size` pixels. With no client (no API key), an empty
 * draft at once. A refusal, a reading cut off, or one that doesn't parse is a failed read.
 */
export async function readFloorPlan(client: Anthropic | null, png: Buffer, size: { width: number; height: number }): Promise<PlanReading> {
  if (!client) return { draft: emptyDraft(), read: 'skipped', seconds: 0 };
  const started = performance.now();
  const seconds = () => Math.round((performance.now() - started) / 100) / 10;
  try {
    // create, not parse, so a refusal or a cut-off reading is told apart from one that doesn't parse.
    const message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
          { type: 'text', text: request(size) },
        ],
      }],
      // Measuring a drawing rewards care.
      output_config: { format: betaZodOutputFormat(FloorPlanDraftSchema), effort: 'high' },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    }, { timeout: TIMEOUT_MS });
    if (message.stop_reason === 'refusal') throw new Error('Claude declined to read this plan');
    if (message.stop_reason === 'max_tokens') throw new Error('The reading was cut off');
    const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Claude's reading isn't JSON");
    }
    const checked = FloorPlanDraftSchema.safeParse(parsed);
    if (!checked.success) throw new Error(`Claude's reading doesn't fit the draft: ${checked.error.issues[0]?.message}`);
    const draft = cleanDraft(checked.data, size);
    console.log(`Floor plan read in ${seconds()} s: ${draft.rooms.length} rooms, ${draft.scaleHints.length} dimensions`);
    return { draft, read: 'ok', seconds: seconds() };
  } catch (error) {
    console.warn(`Floor plan reading failed after ${seconds()} s: ${(error as Error).message}`);
    return { draft: emptyDraft(), read: 'failed', seconds: seconds(), error: (error as Error).message };
  }
}
