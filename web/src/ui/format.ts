/** A count with its noun: "1 Edit", "3 Edits". */
export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Whole dollars, as "$1,240". */
export const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;

/** A Catalog price, which is always an estimate (spec §8.3): "≈ $1,240 (est.)". */
export const priceEstimate = (usd: number) => `≈ ${dollars(usd)} (est.)`;

/** A length in inches, to a tenth, without a trailing ".0": "47", "29.9". */
export const inches = (meters: number) => String(+(meters / 0.0254).toFixed(1));

/** A length in whole centimeters. */
export const cm = (meters: number) => Math.round(meters * 100);

/** A size as width × depth × height in centimeters, the order a size is read in: "119 × 61 × 43 cm". */
export const cmSize = ([width, height, depth]: [number, number, number]) => `${cm(width)} × ${cm(depth)} × ${cm(height)} cm`;

/** A Catalog price in a list (cards, the shopping list's rows): "≈ $1,240". The ≈ says it's an estimate. */
export const approxDollars = (usd: number) => `≈ ${dollars(usd)}`;

/**
 * A Catalog item's name, for the cards, the Inspector, the shopping list and the 3D callout: its
 * title without the brand in front or the listing's keywords after. "AmazonBasics Classic, Adjustable,
 * Swivel Office Desk Chair with Casters and Twill Fabric, Navy" reads "Swivel Office Desk Chair". Show
 * the full title too, as a tooltip.
 */
export function productName({ title, brand }: { title: string; brand?: string }) {
  // Amazon's own lines say so first: "Amazon Brand - Solimo …", "Amazon Brand Movian …".
  let name = title.replace(/^Amazon Brand\s*[-–]?\s*/i, '');
  // The brand leads most titles: "Rivet …", and "Solimo …" for the brand "Amazon Brand - Solimo".
  for (const prefix of brand ? [brand, brand.split(' - ').at(-1)!] : []) {
    if (name.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  // A listing's parts are the name, then size, color and features: the first of more than one word
  // is the name ("Classic, Adjustable, Swivel Office Desk Chair, Navy"), cut before " with" or "(".
  const parts = name.replace(/^[\s\-–]+/, '').split(/,| - | – /).map((part) => part.trim()).filter(Boolean);
  const head = parts.find((part) => part.includes(' ')) ?? parts[0];
  return head?.split(/ with | \(/i)[0].trim() || title;
}
