import { describe, expect, it } from 'vitest';
import { assignPart, partsFor } from './parts';
import type { Category, Vec3 } from './types';

const up: Vec3 = [0, 1, 0];
const front: Vec3 = [0, 0, 1];

describe('partsFor', () => {
  it.each<[Category[], string[]]>([
    [['table', 'desk'], ['top', 'legs']],
    [['chair'], ['seat_back', 'legs']],
    [['bed'], ['frame', 'bedding']],
    [['dresser', 'wardrobe', 'nightstand', 'storage'], ['body', 'fronts']],
    [['sofa'], ['frame', 'cushions']],
    [['shelf', 'rug', 'lamp', 'wall_art', 'mirror', 'plant', 'decor'], ['body']],
  ])('gives %j the Parts %j (§7)', (categories, partIds) => {
    for (const category of categories) expect(partsFor(category).map((part) => part.id)).toEqual(partIds);
  });

  it('names each Part for the Recolor picker', () => {
    expect(partsFor('chair')).toEqual([{ id: 'seat_back', name: 'Seat and back' }, { id: 'legs', name: 'Legs' }]);
  });
});

// Every rule runs in the object's own frame: bottom-center origin, +Z front, size [w, h, d].
describe('assignPart', () => {
  describe('table and desk: the top band', () => {
    const desk: Vec3 = [1.2, 0.75, 0.6];

    it('makes everything within 6 cm of the top the top, and the rest legs', () => {
      expect(assignPart('desk', desk, undefined, [0.3, 0.74, 0.1], up)).toBe('top');
      expect(assignPart('desk', desk, undefined, [0.55, 0.7, -0.25], [1, 0, 0])).toBe('top');
      expect(assignPart('desk', desk, undefined, [0.55, 0.66, -0.25], [1, 0, 0])).toBe('legs');
      expect(assignPart('table', desk, undefined, [0.55, 0.05, 0.25], [1, 0, 0])).toBe('legs');
    });

    it('takes the band from partParams.topThickness', () => {
      expect(assignPart('desk', desk, { topThickness: 0.2 }, [0.55, 0.6, -0.25], [1, 0, 0])).toBe('top');
      expect(assignPart('desk', desk, { topThickness: 0.02 }, [0.55, 0.72, -0.25], [1, 0, 0])).toBe('legs');
    });
  });

  describe('dresser, wardrobe, nightstand and storage: the fronts', () => {
    const dresser: Vec3 = [1, 0.8, 0.45]; // its front face is at z = 0.225

    it('makes forward-facing triangles in the 3 cm front slab the fronts, and the rest body', () => {
      for (const category of ['dresser', 'wardrobe', 'nightstand', 'storage'] as const) {
        expect(assignPart(category, dresser, undefined, [0.2, 0.5, 0.225], front)).toBe('fronts');
        expect(assignPart(category, dresser, undefined, [0.2, 0.5, 0.2], [0, 0.6, 0.8])).toBe('fronts');
      }
      expect(assignPart('dresser', dresser, undefined, [0.2, 0.5, 0.18], front)).toBe('body'); // recessed, behind the slab
      expect(assignPart('dresser', dresser, undefined, [0.5, 0.5, 0.21], [1, 0, 0])).toBe('body'); // a side, in the slab
      expect(assignPart('dresser', dresser, undefined, [0.2, 0.8, 0.21], up)).toBe('body'); // the top, in the slab
      expect(assignPart('dresser', dresser, undefined, [0.2, 0.5, 0.225], [0, 0.75, 0.66])).toBe('body'); // faces mostly up
    });

    it('takes the slab depth from partParams.frontDepth', () => {
      expect(assignPart('dresser', dresser, { frontDepth: 0.06 }, [0.2, 0.5, 0.18], front)).toBe('fronts');
    });
  });

  describe('chair', () => {
    const chair: Vec3 = [0.6, 0.9, 0.6]; // 45% of its height is 0.405

    it('makes everything below 45% of the height the legs, and the rest the seat and back', () => {
      expect(assignPart('chair', chair, undefined, [0.25, 0.2, 0.25], [1, 0, 0])).toBe('legs');
      expect(assignPart('chair', chair, undefined, [0, 0.45, 0.1], up)).toBe('seat_back');
      expect(assignPart('chair', chair, undefined, [0, 0.85, -0.28], front)).toBe('seat_back');
    });

    it('takes the fraction from partParams.seatFraction', () => {
      expect(assignPart('chair', chair, { seatFraction: 0.6 }, [0, 0.45, 0.1], up)).toBe('legs');
    });
  });

  describe('bed', () => {
    const bed: Vec3 = [1, 1, 2]; // bedding needs |x| < 0.47 and z > −0.88, away from the headboard at −Z

    it('makes the bedding the band 0.22–0.70 m up, inside the rails and away from the headboard; the rest is frame', () => {
      expect(assignPart('bed', bed, undefined, [0, 0.5, 0], up)).toBe('bedding');
      expect(assignPart('bed', bed, undefined, [0.4, 0.3, 0.9], [1, 0, 0])).toBe('bedding');
      expect(assignPart('bed', bed, undefined, [0, 0.1, 0], [0, -1, 0])).toBe('frame'); // under the mattress
      expect(assignPart('bed', bed, undefined, [0, 0.9, -0.95], front)).toBe('frame'); // the headboard
      expect(assignPart('bed', bed, undefined, [0, 0.5, -0.95], front)).toBe('frame'); // against the headboard
      expect(assignPart('bed', bed, undefined, [0.49, 0.5, 0], [1, 0, 0])).toBe('frame'); // a side rail
    });

    it('takes the band from partParams.beddingRange', () => {
      expect(assignPart('bed', bed, { beddingRange: [0.3, 0.9] }, [0, 0.25, 0], up)).toBe('frame');
      expect(assignPart('bed', bed, { beddingRange: [0.3, 0.9] }, [0, 0.8, 0], up)).toBe('bedding');
    });
  });

  describe('sofa', () => {
    const sofa: Vec3 = [2, 0.8, 0.9]; // cushions need 0.2 ≤ y ≤ 0.48, |x| < 0.9 and z > −0.3

    it('makes the cushions the band 25–60% of the height, inside the arms and in front of the back; the rest is frame', () => {
      expect(assignPart('sofa', sofa, undefined, [0, 0.4, 0.1], up)).toBe('cushions');
      expect(assignPart('sofa', sofa, undefined, [0, 0.1, 0.1], front)).toBe('frame'); // the base
      expect(assignPart('sofa', sofa, undefined, [0, 0.7, -0.4], up)).toBe('frame'); // the top of the back
      expect(assignPart('sofa', sofa, undefined, [0, 0.4, -0.35], front)).toBe('frame'); // the back
      expect(assignPart('sofa', sofa, undefined, [0.95, 0.4, 0], up)).toBe('frame'); // an arm
    });
  });

  it('puts every triangle of a category without a rule in body', () => {
    expect(assignPart('lamp', [0.2, 0.45, 0.2], undefined, [0, 0.44, 0], up)).toBe('body');
    expect(assignPart('shelf', [0.8, 1.8, 0.3], { topThickness: 1 }, [0, 1.79, 0], up)).toBe('body');
  });
});
