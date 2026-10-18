import { describe, expect, it } from 'vitest';
import type { Box, Wall } from '@shared/types';
import { floorFrame, IMAGE_MARGIN, inRegion, REGION_GROW, wallFrame } from './patchFrames';

const box = (over: Partial<Box> = {}): Box => ({ position: [2, 0, 3], size: [1, 0.8, 0.5], rotationY: 0, ...over });

// A 4 × 3 m room: the north wall runs from (0, 0) to (4, 0), facing +Z into the room.
const north: Wall = { id: 'wl_n', name: 'North wall', start: [0, 0], end: [4, 0], normal: [0, 1], height: 2.5 };
const east: Wall = { id: 'wl_e', name: 'East wall', start: [4, 0], end: [4, 3], normal: [-1, 0], height: 2.5 };

describe('floorFrame', () => {
  it('is a square centered on the box that reaches the margin past its longer side', () => {
    const frame = floorFrame(box())!;

    expect(frame.center).toEqual([2, 3]);
    expect(frame.side).toBeCloseTo(1 + 2 * IMAGE_MARGIN);
  });

  it('grows to hold a turned box', () => {
    const turned = floorFrame(box({ rotationY: Math.PI / 4 }))!;

    expect(turned.side).toBeCloseTo(2 * ((1 + 0.5) * Math.SQRT1_2 / 2 + IMAGE_MARGIN));
  });

  it('is null for something hanging on a wall', () => {
    expect(floorFrame(box({ position: [2, 1.4, 3] }))).toBeNull();
  });
});

describe('wallFrame', () => {
  it('covers the grown box plus the margin along the wall, and up to the margin above it', () => {
    const frame = wallFrame(box({ position: [2, 0, 0.25] }), north)!;

    expect(frame.along[0]).toBeCloseTo(2 - 0.5 - REGION_GROW - IMAGE_MARGIN);
    expect(frame.along[1]).toBeCloseTo(2 + 0.5 + REGION_GROW + IMAGE_MARGIN);
    expect(frame.up[0]).toBe(0);
    expect(frame.up[1]).toBeCloseTo(0.8 + REGION_GROW + IMAGE_MARGIN);
  });

  it('includes a wall the grown box almost touches, and skips one it is far from', () => {
    // Centered 0.4 m out: its back is 0.15 m from the north wall, so the grown box is 0.05 m from it.
    expect(wallFrame(box({ position: [2, 0, 0.4] }), north)).not.toBeNull();
    expect(wallFrame(box({ position: [2, 0, 1.5] }), north)).toBeNull();
  });

  it('gives a corner Original an image on both walls', () => {
    const corner = box({ position: [3.7, 0, 0.3], size: [0.5, 1, 0.5] });

    expect(wallFrame(corner, north)).not.toBeNull();
    expect(wallFrame(corner, east)).not.toBeNull();
  });

  it('keeps to the wall’s own length and height', () => {
    const frame = wallFrame(box({ position: [0.3, 0, 0.25], size: [0.6, 3, 0.5] }), north)!;

    expect(frame.along[0]).toBe(0);
    expect(frame.up[1]).toBe(2.5);
  });
});

describe('inRegion', () => {
  it('is the box grown by 10 cm on every side', () => {
    const b = box();

    expect(inRegion(b, [2, 0.4, 3])).toBe(true);
    expect(inRegion(b, [2 + 0.5 + 0.09, 0.4, 3])).toBe(true);
    expect(inRegion(b, [2 + 0.5 + 0.11, 0.4, 3])).toBe(false);
    expect(inRegion(b, [2, 0.4, 3 + 0.25 + 0.11])).toBe(false);
    expect(inRegion(b, [2, 0.8 + 0.11, 3])).toBe(false);
  });

  it('follows the box’s turn', () => {
    // Turned a quarter: its width now runs along z.
    const b = box({ rotationY: Math.PI / 2 });

    expect(inRegion(b, [2, 0.4, 3 + 0.5 + 0.09])).toBe(true);
    expect(inRegion(b, [2 + 0.5 + 0.09, 0.4, 3])).toBe(false);
  });
});
