// How the tools and the first message write things for Claude to read.
import type { CatalogItem } from '../../shared/types';

/** Meters rounded to the centimeter. */
export const m = (meters: number) => Math.round(meters * 100) / 100;

/** Whether Claude may choose the item: the Catalog's placeholder boxes, stand-ins for real products, are never shown to it (from #97). */
export const offeredToClaude = ({ id }: CatalogItem) => !id.startsWith('placeholder-');

/** A Catalog item as Claude reads it: size_m is [width, height, depth], and prices are estimates. */
export const catalogEntry = ({ id, title, category, size, colors, styleTags, priceEstimateUsd }: CatalogItem) =>
  ({ id, title, category, size_m: size.map(m), colors, styles: styleTags, price_usd: priceEstimateUsd });
