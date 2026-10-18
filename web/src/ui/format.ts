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
