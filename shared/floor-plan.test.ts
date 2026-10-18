import { describe, expect, it } from 'vitest';
import { draftScale, emptyDraft, FloorPlanDraftSchema, formatFeet, parseLength } from './floor-plan';

describe('parseLength', () => {
  it.each([
    [`12'6"`, 3.81], [`12' 6"`, 3.81], [`12'-6"`, 3.81], ['12 ft', 3.6576], [`150"`, 3.81], ['150 in', 3.81],
    ['3.81 m', 3.81], ['381 cm', 3.81], ['3810 mm', 3.81],
    // As a plan prints them, fractions of an inch and all.
    [`13'-3 1/8"`, 4.0418], [`13'-3⅛"`, 4.0418], [`15'-11 1/16"`, 4.853], ['12’6”', 3.81],
  ])('reads %s as %f m', (text, meters) => {
    expect(parseLength(text)).toBeCloseTo(meters, 3);
  });

  it.each(['', 'twelve feet', '12', '3.8.1 m', "12'6'"])('is null for %j', (text) => {
    expect(parseLength(text)).toBeNull();
  });
});

describe('formatFeet', () => {
  it('prints feet and inches, rounded to the inch', () => {
    expect(formatFeet(4.0418)).toBe('13′ 3″');
    expect(formatFeet(0.229)).toBe('9″');
  });
});

describe('draftScale', () => {
  const room = { label: 'Room', corners: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }, { x: 0, y: 400 }], openings: [], furniture: [] };
  const hint = (meters: number, pixels: number) => ({ text: '', meters, from: { x: 0, y: 0 }, to: { x: pixels, y: 0 } });

  it("prefers a printed dimension as long as one of the room's edges", () => {
    // The first hint is a door's width; the second spans the room.
    const draft = { ...emptyDraft(), rooms: [room], scaleHints: [hint(0.9, 70), hint(4, 300)] };
    expect(draftScale(draft, room)).toBeCloseTo(4 / 300);
  });

  it('falls back to the first usable hint, then to none', () => {
    expect(draftScale({ ...emptyDraft(), scaleHints: [hint(1, 0), hint(0.9, 70)] }, room)).toBeCloseTo(0.9 / 70);
    expect(draftScale(emptyDraft(), room)).toBeNull();
  });
});

describe('FloorPlanDraftSchema', () => {
  it('accepts an empty draft, and leaves out furniture, which a room built from a plan starts without', () => {
    expect(FloorPlanDraftSchema.parse(emptyDraft())).toEqual(emptyDraft());
    const bed = { label: 'Bed', category: 'bed', center: { x: 1, y: 1 }, width: 1, depth: 1, rotation: 0, builtIn: false };
    const room = { label: 'Room', corners: [], openings: [] };
    const draft = { ...emptyDraft(), rooms: [{ ...room, furniture: [bed] }] };
    expect(FloorPlanDraftSchema.parse(draft).rooms).toEqual([room]);
  });
});
