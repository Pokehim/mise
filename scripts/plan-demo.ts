// The seeded Floor Plan Scan for the demo (#68, ADR-0011): CMU's Donner House double, built from
// its published plan as Room Setup would build it from Claude's reading, and empty, ready to
// furnish. The reading is the hand-checked draft web/src/plan/fixtures/cmu-draft.json, so the demo
// needs no API call, and doubles as the backup if Claude is slow or offline.
//
// Run: npx tsx scripts/plan-demo.ts
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { draftScale, type FloorPlanDraft } from '../shared/floor-plan';
import type { Design, RoomSetup, ScanManifest } from '../shared/types';
import { planToSetup } from '../web/src/plan/planToSetup';
import { writeJson } from './scan-import';

const SCAN_ID = 'plan-demo';

/** The room as the plan builds it: carpet and off-white drywall, as CMU's room photos show. */
export function demoSetup(draft: FloorPlanDraft): { setup: RoomSetup; metersPerPixel: number } {
  const [room] = draft.rooms;
  const metersPerPixel = draftScale(draft, room)!;
  const surfaces = { walls: 'drywall', wallColor: '#ece6da', floor: 'carpet-grey', ceiling: 'drywall', baseboard: 'rubber' } as const;
  return { setup: planToSetup(SCAN_ID, room, { metersPerPixel, surfaces }), metersPerPixel };
}

async function main() {
  const root = join(import.meta.dirname, '..');
  const draft: FloorPlanDraft = JSON.parse(await readFile(join(root, 'web/src/plan/fixtures/cmu-draft.json'), 'utf8'));
  const { setup, metersPerPixel } = demoSetup(draft);
  const dir = join(root, 'data/scans', SCAN_ID);
  await mkdir(join(dir, 'plan'), { recursive: true });
  await copyFile(join(root, 'data/floor-plans/cmu/plan.png'), join(dir, 'plan/floor-plan.png'));
  await writeJson(join(dir, 'plan/draft.json'), draft);
  const manifest: ScanManifest = {
    version: 1, id: SCAN_ID, name: 'CMU · Donner double, from its floor plan', mesh: 'room.glb',
    meshTransform: { position: [0, 0, 0], rotationY: 0 },
    floorPlan: { image: 'plan/floor-plan.png', draft: 'plan/draft.json', metersPerPixel: Math.round(metersPerPixel * 1e7) / 1e7 },
  };
  await writeJson(join(dir, 'manifest.json'), manifest);
  await writeJson(join(dir, 'setup.json'), setup);

  // Opens looking finished: oak underfoot, and the window wall painted sage.
  const at = '2026-10-18T09:00:00.000Z';
  const north = setup.walls.find(({ name }) => name === 'North wall')!;
  const design: Design = {
    version: 1, id: 'ds_plan_demo', scanId: SCAN_ID, name: 'Oak and sage', createdAt: at, updatedAt: at, origin: 'mover',
    edits: [
      { id: 'ed_1', at, by: 'mover', type: 'finish', target: { kind: 'floor' }, finish: { kind: 'material', materialId: 'oak' } },
      { id: 'ed_2', at, by: 'mover', type: 'finish', target: { kind: 'wall', wallId: north.id }, finish: { kind: 'paint', color: '#a3b39a' } },
    ],
  };
  await writeJson(join(root, 'data/designs/ds_plan_demo.json'), design);
  console.log(`${SCAN_ID}: ${setup.walls.length} walls, ${setup.openings.length} openings, empty; ${metersPerPixel.toFixed(5)} m/px`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
