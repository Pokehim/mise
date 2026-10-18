/**
 * The 16 rooms on the landing page: Designs Claude made of the study lounge, each from a one-line
 * Brief asking for a different kind of room. Each room's clip is its reveal (scene/Reveal.tsx) recorded
 * from the door (?shot=door): the lounge as it is, its Originals going and Pieces coming Edit by Edit. Its still is the clip's
 * last frame, and empty.webp the first, which every clip shares. The Designs themselves are kept in
 * docs/landing/designs, off the Scans; docs/landing/README.md says how the clips were made.
 */
export const ROOMS = [
  { id: 'ds_5ov52t8d', room: 'Dorm bedroom', name: 'Sage Golden Hour' },
  { id: 'ds_99q2v2yt', room: 'Game room', name: 'Golden Hour Games' },
  { id: 'ds_w73jn43v', room: 'Library', name: 'Oxblood Reading Room' },
  { id: 'ds_t45f88xj', room: 'Music lounge', name: 'Olive Groove Lounge' },
  { id: 'ds_chaepniv', room: 'Study room', name: 'Quiet Wave Study' },
  { id: 'ds_o8dpfq5d', room: 'Dorm bedroom', name: 'Clay Wall Nook' },
  { id: 'ds_1ueec8sv', room: 'Game room', name: 'Grand Tour Lounge' },
  { id: 'ds_suxtyo7h', room: 'Reading corner', name: 'Clay Hour' },
  { id: 'ds_8iuqyadz', room: 'Music lounge', name: 'Olive Listening Room' },
  { id: 'ds_7p2rrif3', room: 'Library', name: 'Green Velvet Library' },
  { id: 'ds_ra7m1wns', room: 'Dorm bedroom', name: 'Rust Golden Hour' },
  { id: 'ds_tivq6e6m', room: 'Guest bedroom', name: 'Indigo Night Snow' },
  { id: 'ds_x82lyiiw', room: 'Dorm bedroom', name: 'Clay Wave Dorm' },
  { id: 'ds_uq96k7k7', room: 'Guest bedroom', name: 'Quiet Fuji' },
  { id: 'ds_xr6p7zr6', room: 'Study room', name: 'Quiet Sage Study' },
  { id: 'ds_dymlzff4', room: 'Library', name: 'Green Study' },
];

const stills = import.meta.glob<string>('./*.webp', { eager: true, import: 'default' });
const clips = import.meta.glob<string>('./*.webm', { eager: true, import: 'default' });

/** A room's finished still, by its Design's id. */
export const stillOf = (id: string) => stills[`./${id}.webp`];
/** A room's clip of its reveal. */
export const clipOf = (id: string) => clips[`./${id}.webm`];
/** The lounge as it is, Originals and all: the first frame of every clip. */
export const EMPTY = stills['./empty.webp'];
