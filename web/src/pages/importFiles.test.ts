import { describe, expect, it } from 'vitest';
import { addScanFiles, missingFile, nameFromFile } from './importFiles';

const file = (name: string) => new File(['x'], name);

describe('addScanFiles', () => {
  it('takes a GLB as the mesh and a PLY as the splat, in either case', () => {
    const glb = file('Room.GLB');
    const ply = file('room.ply');
    expect(addScanFiles({}, [ply, glb])).toEqual({ files: { mesh: glb, splat: ply }, refused: [] });
  });

  it('lets a later drop add the PLY, or take the place of the GLB', () => {
    const first = file('first.glb');
    const second = file('second.glb');
    const ply = file('room.ply');
    const { files } = addScanFiles({ mesh: first }, [ply]);
    expect(files).toEqual({ mesh: first, splat: ply });
    expect(addScanFiles(files, [second]).files).toEqual({ mesh: second, splat: ply });
  });

  it('turns away any other file, with why, and keeps the rest of the drop', () => {
    const glb = file('room.glb');
    expect(addScanFiles({}, [glb, file('plan.png'), file('notes.txt'), file('room.gltf')])).toEqual({
      files: { mesh: glb },
      refused: [
        'plan.png is an image, not a scan. For a floor plan, find your dorm above.',
        "notes.txt isn't a GLB or a PLY.",
        "room.gltf isn't a GLB or a PLY.",
      ],
    });
  });

  it('turns away two GLBs, or two PLYs, in one drop', () => {
    const ply = file('room.ply');
    expect(addScanFiles({ splat: ply }, [file('a.glb'), file('b.glb')])).toEqual({
      files: { splat: ply },
      refused: ['a.glb and b.glb are both GLBs: drop one room at a time.'],
    });
    expect(addScanFiles({}, [file('a.ply'), file('b.ply')]).refused).toEqual(['a.ply and b.ply are both PLYs: drop one room at a time.']);
  });
});

describe('missingFile', () => {
  it('turns away a PLY alone', () => {
    expect(missingFile({ splat: file('room.ply') })).toBe("A PLY needs its room's GLB: drop both.");
  });

  it('asks for the GLB first, and is satisfied by a GLB with or without its PLY', () => {
    expect(missingFile({})).toBe('Drop the GLB of your room.');
    expect(missingFile({ mesh: file('room.glb') })).toBeUndefined();
    expect(missingFile({ mesh: file('room.glb'), splat: file('room.ply') })).toBeUndefined();
  });
});

describe('nameFromFile', () => {
  it('names the room after the file', () => {
    expect(nameFromFile(file('Maple_Hall-412.glb'))).toBe('Maple Hall 412');
  });
});
