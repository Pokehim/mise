import { describe, expect, it } from 'vitest';
import { checkFit } from './fit';
import { replay } from './replay';
import { catalog, edit, onFloor, place, setup, withLampAndMirror } from './test-room';
import type { Edit, Opening, Placement, Vec2 } from './types';

// The room's floor is x −2 to 2, z −1.5 to 1.5. The bed covers x −2 to −1.01, z −1.5 to 0.53;
// the desk x 1.4 to 2, z −1.135 to −0.065. The chair is 0.6 × 0.6 m, the lamp 0.2 × 0.2 m.

/** The Fit violations of the room after these Edits. */
const fitAfter = (edits: Edit[], subjectIds?: string[], room = setup) =>
  checkFit(room, catalog, replay(room, catalog, edits), subjectIds);

describe('checkFit', () => {
  it('finds nothing wrong with the room as scanned', () => {
    expect(fitAfter([])).toEqual([]);
  });

  it('takes a scanned lamp on the desk as standing on it, and a scanned mirror as hanging on its wall', () => {
    expect(fitAfter([], undefined, withLampAndMirror)).toEqual([]);
  });

  describe('overlap', () => {
    it('reports a Piece whose footprint overlaps another item', () => {
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(1.5, -0.6))], ['pc_chair'])).toEqual([
        { rule: 'overlap', subjectId: 'pc_chair', otherId: 'og_desk', message: 'Overlaps your desk' },
      ]);
    });

    it('reports an overlap for each item in it when no subjectIds are given', () => {
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(1.5, -0.6))])).toEqual([
        { rule: 'overlap', subjectId: 'og_desk', otherId: 'pc_chair', message: 'Overlaps Ergo Mesh Chair' },
        { rule: 'overlap', subjectId: 'pc_chair', otherId: 'og_desk', message: 'Overlaps your desk' },
      ]);
    });

    it('allows 1 cm of overlap, so things can stand flush', () => {
      // The desk's front edge is at x = 1.4; the chair is 0.6 wide.
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(1.1, -0.6))])).toEqual([]);
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(1.108, -0.6))])).toEqual([]);
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(1.12, -0.6))], ['pc_chair'])).toMatchObject([{ rule: 'overlap' }]);
    });

    it('lets a rug go under furniture, but not over another rug', () => {
      const underBed = place('pc_rug', 'rug-gray', onFloor(-1.2, -0.4));

      expect(fitAfter([underBed])).toEqual([]);
      expect(fitAfter([underBed, place('pc_rug2', 'rug-gray', onFloor(-1, 0.2))], ['pc_rug2'])).toEqual([
        { rule: 'overlap', subjectId: 'pc_rug2', otherId: 'pc_rug', message: 'Overlaps Mainstays 5×7 Rug' },
      ]);
    });

    it('ignores an Original that is no longer visible: the desk a Piece replaced', () => {
      expect(fitAfter([edit('ed_1', {
        type: 'replace', originalId: 'og_desk', pieceId: 'pc_desk', catalogId: 'desk-walnut', placement: onFloor(1.75, -0.6, -Math.PI / 2), via: 'replace',
      })])).toEqual([]);
    });

    it('skips an item standing on furniture: a lamp on the desk', () => {
      const onDesk: Placement = { position: [1.7, 0.76, -0.6], rotationY: 0, mount: 'surface' };

      expect(fitAfter([place('pc_lamp', 'lamp-brass', onDesk)])).toEqual([]);
    });

    describe('wall items, such as a lamp hung as a sconce', () => {
      /** On the North wall (z = −1.5), x along it, y up from the floor. The lamp is 0.2 deep. */
      const onNorthWall = (x: number, y: number): Placement => ({ position: [x, y, -1.4], rotationY: 0, mount: 'wall', wallId: 'wl_north' });

      it('meets only wall items on the same wall: not the bed below', () => {
        expect(fitAfter([
          place('pc_left', 'lamp-brass', onNorthWall(-1.5, 1.2)),
          place('pc_right', 'lamp-brass', onNorthWall(-1.4, 1.2)),
        ], ['pc_left'])).toEqual([
          { rule: 'overlap', subjectId: 'pc_left', otherId: 'pc_right', message: 'Overlaps Brass Desk Lamp' },
        ]);
      });

      it('lets wall items hang one above the other, like a gallery wall', () => {
        // The lamp is 0.45 tall: one spans y 0.8–1.25, the other 1.6–2.05.
        expect(fitAfter([
          place('pc_low', 'lamp-brass', onNorthWall(-1.5, 0.8)),
          place('pc_high', 'lamp-brass', onNorthWall(-1.5, 1.6)),
        ])).toEqual([]);
      });
    });
  });

  describe('outside-floor', () => {
    it('reports a floor item that reaches past the walls, allowing 1 cm', () => {
      // The East wall is at x = 2; the chair is 0.6 wide.
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(1.9, 0.3))])).toEqual([
        { rule: 'outside-floor', subjectId: 'pc_chair', message: 'Outside the room' },
      ]);
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(1.72, 0.3))])).toMatchObject([{ rule: 'outside-floor' }]);
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(1.705, 0.3))])).toEqual([]);
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(1.7, 0.3))])).toEqual([]);
    });

    it('catches an item over the inner corner of an L-shaped room, though all its corners are on the floor', () => {
      // The room without its north-east quarter (x 0 to 2, z −1.5 to 0): the inner corner is at 0, 0.
      const lShaped = { ...setup, floor: { polygon: [[-2, -1.5], [0, -1.5], [0, 0], [2, 0], [2, 1.5], [-2, 1.5]] as Vec2[] } };
      // Turned 45°, the chair is a diamond reaching 0.42 m from its center: its points are all on the floor.
      const overCorner = place('pc_chair', 'chair-ergo', onFloor(-0.05, 0.05, Math.PI / 4));

      expect(fitAfter([overCorner], ['pc_chair'], lShaped)).toEqual([
        { rule: 'outside-floor', subjectId: 'pc_chair', message: 'Outside the room' },
      ]);
    });
  });

  describe('door-swing', () => {
    // The door spans x 0.8–1.7 on the South wall (z = 1.5) and swings into the room from its hinge at x = 0.8.
    it('reports a floor item in the swing of a door', () => {
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(1.2, 1.1))])).toEqual([
        { rule: 'door-swing', subjectId: 'pc_chair', otherId: 'op_door', message: 'Blocks the door' },
      ]);
    });

    // The lamp spans x 1.5–1.7, z 0.6–0.8: inside the square in front of the door, but its nearest
    // corner is 0.99 m from the hinge, past the 0.9 m reach of the door leaf.
    const farCornerLamp = place('pc_lamp', 'lamp-brass', onFloor(1.6, 0.7));

    it('sweeps a quarter-disc, as wide as the door, from the hinge: the far corner of its square is clear', () => {
      expect(fitAfter([farCornerLamp])).toEqual([]);
    });

    /** The room with its door changed. */
    const withDoor = (door: Partial<Opening>) =>
      ({ ...setup, openings: setup.openings.map((opening) => (opening.id === 'op_door' ? { ...opening, ...door } : opening)) });

    it('swings on the hinge side: hinged on the left, at x = 1.7, the door reaches the lamp', () => {
      expect(fitAfter([farCornerLamp], undefined, withDoor({ swing: 'in-left' }))).toEqual([
        { rule: 'door-swing', subjectId: 'pc_lamp', otherId: 'op_door', message: 'Blocks the door' },
      ]);
    });

    it("needs a 0.6 m deep rectangle clear in front of a door that doesn't swing, or has no swing set", () => {
      const chair = place('pc_chair', 'chair-ergo', onFloor(1.2, 0.5)); // z 0.2–0.8: in the swing, but over 0.6 m out
      expect(fitAfter([chair])).toMatchObject([{ rule: 'door-swing' }]);

      for (const swing of ['none', undefined] as const) {
        expect(fitAfter([chair], undefined, withDoor({ swing }))).toEqual([]);
        expect(fitAfter([place('pc_lamp', 'lamp-brass', onFloor(1.6, 1.1))], undefined, withDoor({ swing })))
          .toMatchObject([{ rule: 'door-swing', otherId: 'op_door' }]);
      }
    });

    it('lets a rug lie in the swing: rugs only collide with rugs, and a door sweeps over them', () => {
      expect(fitAfter([place('pc_rug', 'rug-gray', onFloor(1.2, 0.4))])).toEqual([]);
    });

    it('checks a moved Original where it stands now: the desk dragged into the swing', () => {
      expect(fitAfter([edit('ed_1', { type: 'move', targetId: 'og_desk', placement: onFloor(1.2, 1) })])).toEqual([
        { rule: 'door-swing', subjectId: 'og_desk', otherId: 'op_door', message: 'Blocks the door' },
      ]);
    });
  });

  describe('blocks-window', () => {
    // The window spans x −0.6 to 0.6 on the North wall (z = −1.5), with its sill 0.9 m up.
    it('reports a floor item taller than the sill in the 0.4 m in front of a window', () => {
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(0, -1.2))])).toEqual([ // 0.95 m tall
        { rule: 'blocks-window', subjectId: 'pc_chair', otherId: 'op_window', message: 'Blocks the window' },
      ]);
    });

    it('lets an item lower than the sill stand under a window, and anything stand past the 0.4 m', () => {
      expect(fitAfter([place('pc_desk', 'desk-walnut', onFloor(0, -1.25))])).toEqual([]); // 0.75 m tall
      expect(fitAfter([place('pc_chair', 'chair-ergo', onFloor(0, -0.7))])).toEqual([]); // z −1 to −0.4
    });
  });
});
