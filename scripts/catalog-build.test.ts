import { describe, expect, it } from 'vitest';
import type { CatalogItem, Category } from '../shared/types';
import {
  type AboListing, type AboModel, type CatalogPick, creditsMarkdown, findListings, type Listing, listedRugInches, sizeFromInspect,
  toCatalogItem, toSourcedItem, trianglesFromInspect,
} from './catalog-build';

// ABO listing B07BWJCZJX from listings_*.json.gz, keeping only the en_US and de_DE entries.
const LUMMI_CHAIR: AboListing = {
  item_id: 'B07BWJCZJX',
  domain_name: 'amazon.com',
  product_type: [{ value: 'CHAIR' }],
  main_image_id: '71mTAUFojML',
  '3dmodel_id': 'B07BWJCZJX',
  color_code: ['#40474E'],
  item_name: [
    { language_tag: 'de_DE', value: 'Stone & Beam Lummi Moderner Armloser Stuhl' },
    { language_tag: 'en_US', value: 'Amazon Brand – Stone & Beam Lummi Modern Armless Living Room Accent Chair, 21.6" W, Denim' },
  ],
  brand: [{ language_tag: 'en_US', value: 'Stone & Beam' }],
  color: [{ language_tag: 'en_US', standardized_values: ['Blue'], value: 'Denim' }],
  // "stone" is ABO copying a word of the brand name, as it does in 929 Stone & Beam listings.
  material: [{ language_tag: 'en_US', value: 'denim' }, { language_tag: 'en_US', value: 'stone' }],
  style: [{ language_tag: 'en_US', value: 'Transitional' }],
};

describe('toCatalogItem', () => {
  it('maps an ABO listing and its measured size to a CatalogItem', () => {
    const item: CatalogItem = {
      id: 'B07BWJCZJX',
      source: 'abo',
      title: 'Stone & Beam Lummi Modern Armless Living Room Accent Chair, 21.6" W, Denim',
      brand: 'Stone & Beam',
      category: 'chair',
      mount: 'floor',
      size: [0.513, 0.804, 0.592],
      model: '/data/catalog/models/B07BWJCZJX.glb',
      thumbnail: '/data/catalog/thumbs/B07BWJCZJX.jpg',
      colors: ['Denim'],              // not ABO's standardized_values, which can be wrong: "Beige" for walnut
      colorHex: '#40474e',
      materials: ['Denim'],
      styleTags: ['Transitional'],
      priceEstimateUsd: 120,
      url: 'https://www.amazon.com/dp/B07BWJCZJX',
      attribution: 'Amazon Berkeley Objects (CC BY 4.0), Amazon.com',
    };
    expect(toCatalogItem({ id: 'B07BWJCZJX', category: 'chair' }, LUMMI_CHAIR, [0.513, 0.804, 0.592])).toEqual(item);
  });

  it("uses the pick's price instead of the §8.3 default when it has one", () => {
    const item = toCatalogItem({ id: 'B07BWJCZJX', category: 'chair', price: 95 }, LUMMI_CHAIR, [0.5, 0.8, 0.6]);
    expect(item.priceEstimateUsd).toBe(95);
  });

  it("uses the pick's colors, materials and styleTags, for listings where ABO has none", () => {
    const overrides = { colors: ['Antique Espresso'], materials: ['Pine'], styleTags: ['Casual'] };
    expect(toCatalogItem({ id: 'B07BWJCZJX', category: 'chair', ...overrides }, LUMMI_CHAIR, [0.5, 0.8, 0.6])).toMatchObject(overrides);
  });

  it('mounts wall art and mirrors on the wall, and everything else on the floor', () => {
    const mount = (category: Category) => toCatalogItem({ id: 'B0', category }, LUMMI_CHAIR, [1, 1, 0.05]).mount;
    expect((['wall_art', 'mirror', 'lamp', 'rug'] as const).map(mount)).toEqual(['wall', 'wall', 'floor', 'floor']);
  });

  it('reads British English when a listing has no en_US text', () => {
    // ABO listing B07HPQ7HB5 from amazon.co.uk: every English entry is en_GB.
    const sofa: AboListing = {
      item_id: 'B07HPQ7HB5',
      domain_name: 'amazon.co.uk',
      item_name: [
        { language_tag: 'en_GB', value: 'Amazon Brand - Alkove Elvas Hand-Crafted Leather Sofa, 2 Seater Maxi, 102 x 193 x 93cm, Taupe' },
      ],
      brand: [{ language_tag: 'en_GB', value: 'Alkove' }],
      color: [{ language_tag: 'en_GB', standardized_values: ['Ivory'], value: 'Ecru' }],
      material: [
        { language_tag: 'en_GB', value: 'Leather' },
        { language_tag: 'en_GB', value: 'Alloy Steel' },
        { language_tag: 'en_GB', value: 'Polyurethane' },
      ],
      style: [{ language_tag: 'en_GB', value: 'Modern' }],
    };
    expect(toCatalogItem({ id: 'B07HPQ7HB5', category: 'sofa' }, sofa, [1.93, 0.86, 1.02])).toMatchObject({
      title: 'Alkove Elvas Hand-Crafted Leather Sofa, 2 Seater Maxi, 102 x 193 x 93cm, Taupe',
      brand: 'Alkove',
      colors: ['Ecru'],
      materials: ['Leather', 'Alloy Steel', 'Polyurethane'],
      styleTags: ['Modern'],
    });
  });

  it('tidies the free text: repeats, snake_case and letterless styles such as "0"', () => {
    const listing: AboListing = {
      ...LUMMI_CHAIR,
      color: [{ language_tag: 'en_US', standardized_values: ['Beige'], value: 'Beige' }],
      material: ['Wood', 'wood', 'faux_leather'].map((value) => ({ language_tag: 'en_US', value })),
      style: ['Mid-Century modern', 'Mid-Century Modern', '0', 'Y'].map((value) => ({ language_tag: 'en_US', value })),
    };
    expect(toCatalogItem({ id: 'B07BWJCZJX', category: 'chair' }, listing, [0.5, 0.8, 0.6])).toMatchObject({
      colors: ['Beige'],
      materials: ['Wood', 'Faux leather'],
      styleTags: ['Mid-Century modern'],
    });
  });

  it('takes the style words in the title when ABO has no style', () => {
    const styleTags = (name: string) =>
      toCatalogItem({ id: 'B0', category: 'sofa' }, { item_id: 'B0', item_name: [{ language_tag: 'en_US', value: name }] }, [1, 1, 1]).styleTags;
    expect([
      'Amazon Brand – Rivet Revolve Modern Upholstered Loveseat Sofa, 56"W, Heritage Green',             // B07P8SRVPN
      'Amazon Brand – Rivet Adjustable Arm Mid-Century Modern Living Room Standing Floor Lamp - 59 Inches', // B07374SBFL
      'Amazon Brand – Rivet Mid Century Modern Abstract Mountain Landscape Wall Art Decor on Canvas',       // B075HWHVN6
      'Amazon Brand – Stone & Beam Casual Wood Office Computer Desk, 60"W, Birch',                          // B07B7DL3GX
      'Furniture 247 2 Tier (4 Cube) Shelving Unit - White',                                               // B0754KHKCX
    ].map(styleTags)).toEqual([['Modern'], ['Mid-Century Modern'], ['Mid-Century Modern'], ['Casual'], []]);
  });

  it('decodes the HTML entities in ABO text, such as the "&amp;" in 57 product names', () => {
    // ABO listing B07B4VGZ9B.
    const name = 'Amazon Brand – Rivet Mid-Century Modern Curved Task Desk Table Lamp With USB Port And Light Bulb - 26 Inches, Matte Black &amp; Brushed Steel';
    const lamp: AboListing = { item_id: 'B07B4VGZ9B', item_name: [{ language_tag: 'en_US', value: name }] };
    expect(toCatalogItem({ id: 'B07B4VGZ9B', category: 'lamp' }, lamp, [0.19, 0.65, 0.29]).title)
      .toBe('Rivet Mid-Century Modern Curved Task Desk Table Lamp With USB Port And Light Bulb - 26 Inches, Matte Black & Brushed Steel');
  });

  it("uses the pick's title, for words a Mover searches by that the listing's name lacks", () => {
    const pick = { id: 'B07BWJCZJX', category: 'chair' as const, title: 'Beanbag Chair' };
    expect(toCatalogItem(pick, LUMMI_CHAIR, [0.9, 0.6, 0.9]).title).toBe('Beanbag Chair');
  });

  it('rejects a pick whose category is not a Category, such as a typo in catalog-picks.json', () => {
    const typo = { id: 'B07BWJCZJX', category: 'wallart' as Category };
    expect(() => toCatalogItem(typo, LUMMI_CHAIR, [0.5, 0.8, 0.6])).toThrow(/wallart/);
  });
});

describe('findListings', () => {
  const MODEL: AboModel = { path: 'X/B0.glb', extent: [1, 1, 1] };
  const listing = (item_id: string, productType: string, name: string, more: Partial<Listing> = {}): Listing => ({
    item_id,
    product_type: [{ value: productType }],
    item_name: [{ language_tag: 'en_US', value: name }],
    model: MODEL,
    ...more,
  });
  const ids = (listings: Listing[]) => listings.map((l) => l.item_id);

  it("finds a Category's listings by ABO product type", () => {
    const listings = [
      listing('desk', 'DESK', 'Writing Desk'),
      listing('chair', 'CHAIR', 'Accent Chair'),
      listing('stool', 'STOOL_SEATING', 'Adjustable Swivel Stool'),
      listing('table', 'TABLE', 'Coffee Table'),
    ];
    expect(ids(findListings(listings, 'chair')).sort()).toEqual(['chair', 'stool']);
  });

  it('keeps only the listings that contain every keyword, in any case', () => {
    const listings = [
      listing('writing', 'DESK', 'Mid-Century Writing Desk'),
      listing('computer', 'DESK', 'Mid-Century Computer Desk'),
      listing('vanity', 'DESK', 'Writing Desk and Vanity'),
    ];
    expect(ids(findListings(listings, 'desk', 'WRITING mid-century'))).toEqual(['writing']);
  });

  it('matches keywords in the color, material and style too', () => {
    const en = (value: string) => [{ language_tag: 'en_US', value }];
    const listings = [
      listing('walnut', 'DESK', 'Classic Desk', { color: en('Walnut') }),
      listing('oak', 'DESK', 'Classic Desk', { material: en('Oak') }),
      listing('farmhouse', 'DESK', 'Classic Desk', { style: en('Farmhouse') }),
    ];
    expect(['walnut', 'oak', 'farmhouse'].map((word) => ids(findListings(listings, 'desk', word))))
      .toEqual([['walnut'], ['oak'], ['farmhouse']]);
  });

  it('lists the listings with a 3D model first, then by title', () => {
    const listings = [
      listing('no-model', 'CHAIR', 'Armchair', { model: undefined }),
      listing('zeta', 'CHAIR', 'Zeta Chair'),
      listing('beta', 'CHAIR', 'Beta Chair'),
    ];
    expect(ids(findListings(listings, 'chair'))).toEqual(['beta', 'zeta', 'no-model']);
  });
});

// `gltf-transform inspect --format csv` of ABO chair B082BL4G1J after center and optimize, cut after SCENES.
const CHAIR_INSPECT = `
 OVERVIEW
 ────────────────────────────────────────────
key,value
version,2.0
generator,glTF-Transform v4.5.1
extensionsUsed,"EXT_meshopt_compression, EXT_texture_webp, KHR_mesh_quantization"
extensionsRequired,"EXT_meshopt_compression, EXT_texture_webp, KHR_mesh_quantization"




 SCENES
 ────────────────────────────────────────────
#,name,rootName,bboxMin,bboxMax,renderVertexCount,uploadVertexCount,uploadNaiveVertexCount
0,Root Scene,RootNode,"-0.32066, 0, -0.3175","0.32066, 0.90805, 0.3175",154839,31205,31205
`;

describe('sizeFromInspect', () => {
  it('measures [W, H, D] in meters, to the millimeter, from the scene bounding box', () => {
    expect(sizeFromInspect(CHAIR_INSPECT)).toEqual([0.641, 0.908, 0.635]);
  });

  it('fails when the output has no scene bounding box, instead of returning NaN', () => {
    const overviewOnly = CHAIR_INSPECT.slice(0, CHAIR_INSPECT.indexOf(' SCENES'));
    expect(() => sizeFromInspect(overviewOnly)).toThrow(/bounding box/);
  });
});

describe('toSourcedItem', () => {
  // scripts/catalog-picks.json: a Poly Haven plant set in a Google Scanned Objects pot.
  const ANTHURIUM: CatalogPick = {
    id: 'ph-anthurium',
    category: 'plant',
    source: 'polyhaven',
    asset: 'anthurium_botany_01',
    nodes: ['anthurium_botany_01_b'],
    pot: { source: 'gso', asset: 'Cole_Hardware_Flower_Pot_1025', name: 'Cole Hardware 10.25" Flower Pot' },
    title: 'Anthurium Plant in 10" Brown Flower Pot',
    colors: ['Green', 'Brown'],
    materials: ['Plastic'],
    styleTags: ['Casual'],
    price: 40,
  };

  it('maps a pick from another source to a CatalogItem, crediting the plant and its pot', () => {
    const item: CatalogItem = {
      id: 'ph-anthurium',
      source: 'polyhaven',
      title: 'Anthurium Plant in 10" Brown Flower Pot',
      category: 'plant',
      mount: 'floor',
      size: [0.757, 0.659, 0.572],
      model: '/data/catalog/models/ph-anthurium.glb',
      thumbnail: '/data/catalog/thumbs/ph-anthurium.jpg',
      colors: ['Green', 'Brown'],
      materials: ['Plastic'],
      styleTags: ['Casual'],
      priceEstimateUsd: 40,
      url: 'https://polyhaven.com/a/anthurium_botany_01',
      attribution: 'Poly Haven (CC0): anthurium_botany_01; pot: Google Scanned Objects (CC BY 4.0), Google LLC: Cole_Hardware_Flower_Pot_1025',
    };
    expect(toSourcedItem(ANTHURIUM, [0.757, 0.659, 0.572])).toEqual(item);
  });

  it("links a Google Scanned Objects item to its Fuel page, and keeps the pick's brand", () => {
    const clock: CatalogPick = {
      id: 'gso-alarm-clock', category: 'decor', source: 'gso', asset: 'Crosley_Alarm_Clock_Vintage_Metal',
      title: 'Crosley Vintage Metal Alarm Clock', brand: 'Crosley', colors: ['Bronze'], materials: ['Metal'],
      styleTags: ['Vintage'], price: 20,
    };
    expect(toSourcedItem(clock, [0.109, 0.162, 0.054])).toMatchObject({
      source: 'gso',
      brand: 'Crosley',
      url: 'https://app.gazebosim.org/GoogleResearch/fuel/models/Crosley_Alarm_Clock_Vintage_Metal',
      attribution: 'Google Scanned Objects (CC BY 4.0), Google LLC: Crosley_Alarm_Clock_Vintage_Metal',
    });
  });

  it('rejects a pick missing a field that ABO would have given, such as its colors', () => {
    const { colors: _, ...noColors } = ANTHURIUM;
    expect(() => toSourcedItem(noColors, [0.5, 0.5, 0.5])).toThrow(/colors/);
  });
});

describe('trianglesFromInspect', () => {
  it('counts the triangles of every mesh instance in the MESHES table', () => {
    // `gltf-transform inspect --format csv` of ph-anthurium after optimize, cut to its MESHES table, with a second
    // mesh drawn twice added.
    const inspect = `
 MESHES
 ────────────────────────────────────────────
#,name,mode,meshPrimitives,glPrimitives,vertices,indices,attributes,instances,size
0,anthurium_botany_01_b,TRIANGLES,2,19882,12063,u16,"NORMAL:i8_norm, POSITION:i16_norm, TEXCOORD_0:u16_norm",1,321532
1,soil,TRIANGLES,1,32,33,u16,"NORMAL:i8_norm, POSITION:i16_norm",2,624



 MATERIALS
`;
    expect(trianglesFromInspect(inspect)).toBe(19882 + 2 * 32);
  });
});

describe('listedRugInches', () => {
  it("reads a rug listing's item_dimensions as width × length, the shorter side first", () => {
    const rug: AboListing = {
      item_id: 'B0',
      item_dimensions: { length: { normalized_value: { value: 48 } }, width: { normalized_value: { value: 72 } } },
    };
    expect(listedRugInches(rug)).toEqual([48, 72]);
  });

  it('gives nothing when the listing has no item_dimensions, as no rug listing without a 3D model does', () => {
    expect(listedRugInches({ item_id: 'B075LFMQM6' })).toBeUndefined();
  });
});

describe('creditsMarkdown', () => {
  const item = (id: string, source: CatalogItem['source'], title: string, attribution: string): CatalogItem => ({
    id, source, title, attribution, category: 'decor', mount: 'floor', size: [0.1, 0.1, 0.1], model: '', thumbnail: '',
    colors: [], materials: [], styleTags: [], priceEstimateUsd: 10, url: `https://example.com/${id}`,
  });
  const credits = creditsMarkdown({
    version: 1,
    items: [
      item('B0', 'abo', 'Rivet Vase', 'Amazon Berkeley Objects (CC BY 4.0), Amazon.com'),
      item('gso-clock', 'gso', 'Crosley Clock | Bronze', 'Google Scanned Objects (CC BY 4.0), Google LLC: Crosley'),
      item('ph-fern', 'polyhaven', 'Fern', 'Poly Haven (CC0): fern_02; pot: Google Scanned Objects (CC BY 4.0), Google LLC: QP12'),
    ],
  });

  it('states every source with its license and how many items credit it, a plant in a scanned pot among them', () => {
    expect(credits).toMatch(/\| \[Amazon Berkeley Objects\]\(.*\) \| \[CC BY 4\.0\]\(.*\) \| 1 \|/);
    expect(credits).toMatch(/\| \[Poly Haven\]\(.*\) \| \[CC0 1\.0\]\(.*\) \| 1 \|/);
    expect(credits).toMatch(/\| \[Google Scanned Objects\]\(.*\) \| \[CC BY 4\.0\]\(.*\) \| 2 \|/);
  });

  it("credits every item, escaping a '|' in its title so the table holds", () => {
    expect(credits).toContain('| B0 | [Rivet Vase](https://example.com/B0) | Amazon Berkeley Objects (CC BY 4.0), Amazon.com |');
    expect(credits).toContain('| gso-clock | [Crosley Clock \\| Bronze](https://example.com/gso-clock) |');
  });
});
