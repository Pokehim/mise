import { describe, expect, it } from 'vitest';
import type { CatalogItem, Category } from '../shared/types';
import { type AboListing, type AboModel, findListings, type Listing, sizeFromInspect, toCatalogItem } from './catalog-build';

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

  it("uses the pick's colors and styleTags, for listings where ABO has none", () => {
    const pick = { id: 'B07BWJCZJX', category: 'chair' as const, colors: ['Antique Espresso'], styleTags: ['Casual'] };
    expect(toCatalogItem(pick, LUMMI_CHAIR, [0.5, 0.8, 0.6])).toMatchObject({ colors: ['Antique Espresso'], styleTags: ['Casual'] });
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
