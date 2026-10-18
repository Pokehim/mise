/** What the Mover has dropped into Import so far: the room's mesh, and its PLY if they have one. */
export interface ScanFiles {
  mesh?: File;
  splat?: File;
}

const IMAGE = /\.(png|jpe?g|webp|gif|heic|pdf)$/i;
const fieldOf = (file: File) => (/\.glb$/i.test(file.name) ? 'mesh' : /\.ply$/i.test(file.name) ? 'splat' : undefined);

/** Why a file can't be part of a scan, by its name alone, so it is turned away before anything uploads. */
function refusal(file: File) {
  if (IMAGE.test(file.name)) return `${file.name} is an image, not a scan. For a floor plan, find your dorm below.`;
  return `${file.name} isn't a GLB or a PLY.`;
}

/**
 * Adds a drop to the files already dropped: a GLB is the room's mesh, and a PLY its splat, each
 * taking the place of the one before. Any other file is turned away, with why, and so are two
 * GLBs or two PLYs in one drop, since only one of each can be the room's.
 */
export function addScanFiles(files: ScanFiles, dropped: File[]): { files: ScanFiles; refused: string[] } {
  const next = { ...files };
  const refused: string[] = [];
  for (const field of ['mesh', 'splat'] as const) {
    const ofField = dropped.filter((file) => fieldOf(file) === field);
    if (ofField.length === 1) next[field] = ofField[0];
    else if (ofField.length > 1) refused.push(`${ofField.map((file) => file.name).join(' and ')} are both ${field === 'mesh' ? 'GLBs' : 'PLYs'}: drop one room at a time.`);
  }
  refused.push(...dropped.filter((file) => !fieldOf(file)).map(refusal));
  return { files: next, refused };
}

/** Why the files dropped so far can't be imported yet, or undefined when they can. */
export function missingFile({ mesh, splat }: ScanFiles) {
  if (!mesh && splat) return "A PLY needs its room's GLB: drop both.";
  if (!mesh) return 'Drop the GLB of your room.';
  return undefined;
}

/** "POLYCAM_ROOM_GLB_1.glb" → "POLYCAM ROOM GLB 1": a first name for the room, which the Mover can change. */
export const nameFromFile = (file: File) => file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
