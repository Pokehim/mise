// How the tools and the first message write things for Claude to read.
import type { CatalogItem } from '../../shared/types';

/** Meters rounded to the centimeter. */
export const m = (meters: number) => Math.round(meters * 100) / 100;

/** A Catalog item as Claude reads it: size_m is [width, height, depth], and prices are estimates. */
export const catalogEntry = ({ id, title, category, size, colors, styleTags, priceEstimateUsd }: CatalogItem) =>
  ({ id, title, category, size_m: size.map(m), colors, styles: styleTags, price_usd: priceEstimateUsd });
