import { describe, expect, it } from 'vitest';
import { checkFit } from './fit';
import { replay } from './replay';
import { catalog, edit, item, onFloor, place, setup, withLampAndMirror } from './test-room';
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
        type: 'replace', originalId: 'og_desk', pieceId: 'pc_desk', catalogId: 'desk-walnut', via: 'replace',
        placement: onFloor(1.75, -0.6, -Math.PI / 2),
      })])).toEqual([]);
    });

    it('skips an item standing on furniture: a lamp on the desk', () => {
      const onDesk: Placement = { position: [1.7, 0.76, -0.6], rotationY: 0, mount: 'surface' };

      expect(fitAfter([place('pc_lamp', 'lamp-brass', onDesk)])).toEqual([]);
    });

    it('still reports two items standing in the same spot on furniture', () => {
      const onDesk = (z: number): Placement => ({ position: [1.7, 0.76, z], rotationY: 0, mount: 'surface' });

      const lamps = (z1: number, z2: number) => [place('pc_lamp', 'lamp-brass', onDesk(z1)), place('pc_lamp2', 'lamp-brass', onDesk(z2))];

      expect(fitAfter(lamps(-0.6, -0.5), ['pc_lamp2'])).toEqual([
        { rule: 'overlap', subjectId: 'pc_lamp2', otherId: 'pc_lamp', message: 'Overlaps Brass Desk Lamp' },
      ]);
      expect(fitAfter(lamps(-0.8, -0.4))).toEqual([]);
    });

    describe('wall items, such as a lamp hung as a sconce', () => {
      /** On the North wall (z = −1.5), x along it, y up from the floor. The lamp is 0.2 deep. */
      const onNorthWall = (x: number, y: number): Placement =>
        ({ position: [x, y, -1.4], rotationY: 0, mount: 'wall', wallId: 'wl_north' });

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

  describe('walkway', () => {
    // A walkway lets someone 0.6 m wide walk from each door to the front of every bed, desk and
    // dresser. The door is at x 0.8–1.7 on the South wall (z = 1.5).
    const furniture = {
      ...catalog,
      items: [
        ...catalog.items,
        item('sofa-gray', 'sofa', 'Gray Sofa', [2, 0.85, 0.9]),
        item('dresser-oak', 'dresser', 'Oak Dresser', [0.8, 0.8, 0.45]),
        item('nightstand-oak', 'nightstand', 'Oak Nightstand', [0.45, 0.6, 0.4]),
        item('bench-storage', 'storage', 'Storage Bench', [2.45, 0.5, 0.9]),
      ],
    };
    const walkwayAfter = (edits: Edit[], subjectIds?: string[]) =>
      checkFit(setup, furniture, replay(setup, furniture, edits), subjectIds).filter(({ rule }) => rule === 'walkway');

    it('reports a sofa that closes off the path from the door to the bed', () => {
      // Turned to run north–south, the sofa takes x −0.65 to 0.25 and z −1.05 to 0.95: 0.36 m from the bed's
      // side, 0.45 m from the North wall and 0.55 m from the South wall. Nobody 0.6 m wide gets past it.
      const sofa = place('pc_sofa', 'sofa-gray', onFloor(-0.2, -0.05, Math.PI / 2));

      expect(walkwayAfter([sofa], ['pc_sofa'])).toEqual([
        { rule: 'walkway', subjectId: 'pc_sofa', otherId: 'og_bed', message: 'Blocks the path to your bed' },
      ]);
      expect(walkwayAfter([sofa])).toEqual([
        { rule: 'walkway', subjectId: 'og_bed', otherId: 'op_door', message: 'No clear path from the door' },
        { rule: 'walkway', subjectId: 'pc_sofa', otherId: 'og_bed', message: 'Blocks the path to your bed' },
      ]);
    });

    it("still counts an item in the door's swing, when people can come in past it", () => {
      // Run north–south, the bench takes x 0 to 0.9 and z −1.05 to 1.4: its south end is in the swing, by the
      // hinge at x = 0.8. It shuts the bed off from the door, and leaves 0.5 m in front of the desk.
      // Past x = 1.2, the doorway is open.
      const bench = place('pc_bench', 'bench-storage', onFloor(0.45, 0.175, Math.PI / 2));

      expect(checkFit(setup, furniture, replay(setup, furniture, [bench]), ['pc_bench'])).toEqual([
        { rule: 'door-swing', subjectId: 'pc_bench', otherId: 'op_door', message: 'Blocks the door' },
        { rule: 'walkway', subjectId: 'pc_bench', otherId: 'og_bed', message: 'Blocks the path to your bed' },
        { rule: 'walkway', subjectId: 'pc_bench', otherId: 'og_desk', message: 'Blocks the path to your desk' },
      ]);
    });

    it("counts a bed's long side as its front: a sofa across its foot leaves the side to walk up to", () => {
      // Back to the South wall, x −2 to 0 and z 0.6 to 1.5: 7 cm from the foot of the bed, which ends at z = 0.53.
      expect(walkwayAfter([place('pc_sofa', 'sofa-gray', onFloor(-1, 1.05, Math.PI))])).toEqual([]);
    });

    it("reports a desk whose own front can't be reached", () => {
      // Facing the bed's side from 0.4 m away: its front, at x = −0.61, is too close to the bed to walk up to.
      expect(walkwayAfter([place('pc_desk', 'desk-walnut', onFloor(-0.36, -0.5, -Math.PI / 2))], ['pc_desk'])).toEqual([
        { rule: 'walkway', subjectId: 'pc_desk', otherId: 'op_door', message: 'No clear path from the door' },
      ]);
    });

    it('finds nothing wrong with a normal dorm layout', () => {
      const dorm = [
        place('pc_nightstand', 'nightstand-oak', onFloor(-0.785, -1.3)), // beside the bed's head
        place('pc_chair', 'chair-ergo', onFloor(1.1, -0.6, Math.PI / 2)), // pulled up to the desk
        place('pc_dresser', 'dresser-oak', onFloor(-0.2, 1.275, Math.PI)), // against the South wall, west of the door
        place('pc_rug', 'rug-gray', onFloor(0.2, 0, Math.PI / 2)), // mid-room
        place('pc_lamp', 'lamp-brass', { position: [1.7, 0.76, -0.6], rotationY: 0, mount: 'surface' }), // on the desk
      ];

      expect(checkFit(setup, furniture, replay(setup, furniture, dorm))).toEqual([]);
    });

    it('takes under 5 ms in the test room, even when it has to find what blocks the path', () => {
      const state = replay(setup, furniture, [place('pc_sofa', 'sofa-gray', onFloor(-0.2, -0.05, Math.PI / 2))]);
      checkFit(setup, furniture, state); // warm up
      const times = Array.from({ length: 21 }, () => {
        const start = performance.now();
        checkFit(setup, furniture, state);
        return performance.now() - start;
      });

      expect(times.toSorted((a, b) => a - b)[10]).toBeLessThan(5);
    });

    it('lets a chair stand pulled up to a desk: it gets pulled out to sit down', () => {
      expect(walkwayAfter([place('pc_chair', 'chair-ergo', onFloor(1.1, -0.6, Math.PI / 2))])).toEqual([]);
    });
  });
});
