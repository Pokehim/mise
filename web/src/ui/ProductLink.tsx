import type { CatalogItem } from '@shared/types';

/** The sites the Catalog links to, by hostname; any other goes by its hostname. */
const SITES: Record<string, string> = {
  'amazon.com': 'Amazon', 'polyhaven.com': 'Poly Haven', 'sketchfab.com': 'Sketchfab', 'artic.edu': 'the Art Institute of Chicago',
  'clevelandart.org': 'the Cleveland Museum of Art', 'metmuseum.org': 'the Met', 'loc.gov': 'the Library of Congress',
  'app.gazebosim.org': 'Gazebo', 'commons.wikimedia.org': 'Wikimedia Commons',
};

/** A Piece's link to where it comes from: "View on Amazon", "View on Poly Haven"… or why there is none. */
export function ProductLink({ item }: { item: CatalogItem }) {
  if (!item.url) return <span className="muted">Generated, so no product link</span>;
  const host = new URL(item.url).hostname.replace(/^www\./, '');
  return <a href={item.url} target="_blank" rel="noreferrer">View on {SITES[host] ?? host}</a>;
}
