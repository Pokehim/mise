/** The tokens of styles/tokens.css that the 3D overlays read. */
export type Token = '--ink' | '--graphite' | '--wash' | '--red-pencil' | '--paper-raised' | '--desk' | '--draw';

const cache = new Map<Token, string>();

/**
 * A token of styles/tokens.css, for the 3D overlays: one source of color and timing for the DOM and
 * the scene. Read on first use, once the stylesheet is in.
 */
export function token(name: Token) {
  let value = cache.get(name);
  if (!value) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    cache.set(name, value);
  }
  return value;
}
