// The room the shared/ tests run in, built in code so they don't depend on data/:
// a 4 × 3 m Scan with a door, a window, a Kept bed and a desk, plus a 4-item Catalog.
import type { Catalog, CatalogItem, Category, Edit, Placement, RoomSetup, Vec3 } from './types';

export const setup: RoomSetup = {
  version: 1,
  scanId: 'test-room',
  ceilingHeight: 2.6,
  floor: { polygon: [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]] },
  walls: [
    { id: 'wl_north', name: 'North wall', start: [-2, -1.5], end: [2, -1.5], normal: [0, 1], height: 2.6 },
    { id: 'wl_east', name: 'East wall', start: [2, -1.5], end: [2, 1.5], normal: [-1, 0], height: 2.6 },
    { id: 'wl_south', name: 'South wall', start: [2, 1.5], end: [-2, 1.5], normal: [0, -1], height: 2.6 },
    { id: 'wl_west', name: 'West wall', start: [-2, 1.5], end: [-2, -1.5], normal: [1, 0], height: 2.6 },
  ],
  openings: [
    // x 0.8–1.7, hinged at x = 0.8 (the right side, seen from inside), so it swings over z 0.6–1.5.
    { id: 'op_door', kind: 'door', wallId: 'wl_south', offset: 0.3, width: 0.9, bottom: 0, height: 2.03, swing: 'in-right' },
    // x −0.6–0.6, with its sill 0.9 m above the floor.
    { id: 'op_window', kind: 'window', wallId: 'wl_north', offset: 1.4, width: 1.2, bottom: 0.9, height: 1.2 },
  ],
  originals: [
    {
      // In the north-west corner, headboard against the North wall: x −2 to −1.01, z −1.5 to 0.53.
      id: 'og_bed', label: 'Bed', category: 'bed', kept: true, floorColor: '#a89f91',
      box: { position: [-1.505, 0, -0.485], size: [0.99, 0.6, 2.03], rotationY: 0 },
    },
    {
      // Back against the East wall, facing west: x 1.4–2, z −1.135 to −0.065.
      id: 'og_desk', label: 'Desk', category: 'desk', kept: false, floorColor: '#a89f91',
      box: { position: [1.7, 0, -0.6], size: [1.07, 0.76, 0.6], rotationY: -Math.PI / 2 },
    },
  ],
};

/** The room with two more Originals that aren't on the floor: a lamp on the desk, and a mirror over the bed. */
export const withLampAndMirror: RoomSetup = {
  ...setup,
  originals: [
    ...setup.originals,
    {
      id: 'og_lamp', label: 'Lamp', category: 'lamp', kept: false, floorColor: '#a89f91',
      box: { position: [1.7, 0.76, -0.6], size: [0.2, 0.45, 0.2], rotationY: 0 },
    },
    {
      // On the West wall, facing east: x −2 to −1.97.
      id: 'og_mirror', label: 'Mirror', category: 'mirror', kept: true, floorColor: '#a89f91',
      box: { position: [-1.985, 1, 0], size: [0.5, 0.8, 0.03], rotationY: Math.PI / 2 },
    },
  ],
};

const item = (id: string, category: Category, title: string, size: Vec3, details: Partial<CatalogItem>): CatalogItem => ({
  id, source: 'abo', title, category, mount: 'floor', size,
  model: `/data/catalog/models/${id}.glb`, thumbnail: `/data/catalog/thumbs/${id}.jpg`,
  colors: [], materials: [], styleTags: [], priceEstimateUsd: 100,
  url: `https://www.amazon.com/dp/${id}`, attribution: 'Amazon Berkeley Objects (CC BY 4.0)',
  ...details,
});

export const catalog: Catalog = {
  version: 1,
  items: [
    item('chair-ergo', 'chair', 'Ergo Mesh Chair', [0.6, 0.95, 0.6], { colors: ['Black'], colorHex: '#1c1c1c', styleTags: ['Modern'] }),
    item('desk-walnut', 'desk', '30″ Walnut Desk', [0.76, 0.75, 0.5], { colors: ['Walnut'], colorHex: '#5c4033', styleTags: ['Mid-Century Modern'] }),
    item('rug-gray', 'rug', 'Mainstays 5×7 Rug', [1.52, 0.01, 2.13], { colors: ['Light Gray'], styleTags: ['Contemporary'] }),
    item('lamp-brass', 'lamp', 'Brass Desk Lamp', [0.2, 0.45, 0.2], { colors: ['Brass'], colorHex: '#b5a642', styleTags: ['Industrial'] }),
  ],
};

// Omit applied to each member of the Edit union, so each Edit type keeps its own fields.
type EditFields = Edit extends infer E ? (E extends Edit ? Omit<E, 'id' | 'at' | 'by'> : never) : never;

/** An Edit by the Mover. Every Edit gets the same time: replay goes by list order, never by `at`. */
export const edit = (id: string, fields: EditFields): Edit => ({ id, at: '2026-10-17T21:00:00.000Z', by: 'mover', ...fields });

/** A floor Placement at x, z. */
export const onFloor = (x: number, z: number, rotationY = 0): Placement => ({ position: [x, 0, z], rotationY, mount: 'floor' });
