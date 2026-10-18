/**
 * The 16 rooms on the landing page: Designs Claude made of the study lounge, each from a one-line
 * Brief asking for a different kind of room. Each image is the Design from the door (?shot=door). The
 * Designs themselves are kept in docs/landing/designs, off the Scans, for when each room animates
 * assembling itself Edit by Edit.
 */
export const ROOMS = [
  { id: 'ds_xzjjooha', room: 'Dorm bedroom', name: 'Golden Hour Dorm' },
  { id: 'ds_07ps5jt7', room: 'Game room', name: 'Neon Arcade Lounge' },
  { id: 'ds_kjigih9i', room: 'Library', name: 'Oxblood Reading Room' },
  { id: 'ds_zk55s7lc', room: 'Music lounge', name: 'Cabaret Vinyl Lounge' },
  { id: 'ds_chaepniv', room: 'Study room', name: 'Quiet Wave Study' },
  { id: 'ds_tivq6e6m', room: 'Guest bedroom', name: 'Indigo Night Snow' },
  { id: 'ds_nlwxbact', room: 'Game room', name: 'Insert Coin Lounge' },
  { id: 'ds_suxtyo7h', room: 'Reading corner', name: 'Clay Hour' },
  { id: 'ds_37n12kc3', room: 'Music lounge', name: 'Velvet Groove' },
  { id: 'ds_o8dpfq5d', room: 'Dorm bedroom', name: 'Clay Wall Nook' },
  { id: 'ds_7p2rrif3', room: 'Library', name: 'Green Velvet Library' },
  { id: 'ds_a5pt0u76', room: 'Game room', name: 'Player Two Room' },
  { id: 'ds_uq96k7k7', room: 'Guest bedroom', name: 'Quiet Fuji' },
  { id: 'ds_k2jhhzx9', room: 'Study room', name: 'Cabaret Study Hall' },
  { id: 'ds_dymlzff4', room: 'Library', name: 'Green Study' },
  { id: 'ds_x82lyiiw', room: 'Dorm bedroom', name: 'Clay Wave Dorm' },
];

const images = import.meta.glob<string>('./*.webp', { eager: true, import: 'default' });

/** A room's image, by its Design's id. */
export const imageOf = (id: string) => images[`./${id}.webp`];
