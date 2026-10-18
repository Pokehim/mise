import type { LibraryEntry, ScanManifest } from '@shared/types';

/** A Scan of the floor plan library: a dorm room built from the plan its school publishes (ADR-0010). */
export type LibraryScan = ScanManifest & { library: LibraryEntry };

/** "Move-in layout", the room furnished as it comes; a library Scan's folder name is its id up to the first "-". */
export const moveInLayoutId = (scanId: string) => `ds_${scanId.split('-')[0]}`;

/** A library room's plan image from its university, without the extension: data/floor-plans/<school>/plan. */
export const planImageBase = (scanId: string) => `/data/floor-plans/${scanId.split('-')[0]}/plan`;

/** "U.C. Berkeley's Urbana-Champaign" → ["uc", "berkeleys", "urbana", "champaign"]: no case, no punctuation. */
export const words = (text: string) =>
  text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ'’.]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The library Scans that match what the Mover typed, best first: every word typed must start a word
 * of the room's school, aliases, hall or room, or start one of those run together ("udub", "gatech").
 * A word that names the school counts more than one that names the hall, and a whole word more than
 * its start. An empty query lists the whole library, by school.
 */
export function searchLibrary(scans: ScanManifest[], query: string): LibraryScan[] {
  const typed = words(query);
  const library = scans
    .filter((scan): scan is LibraryScan => !!scan.library)
    .sort((a, b) => a.library.school.localeCompare(b.library.school));
  if (!typed.length) return library;

  const ranked = library.flatMap((scan) => {
    const { school, aliases, hall, room } = scan.library;
    const fields = [{ names: [school, ...aliases], weight: 2 }, { names: [hall, room], weight: 1 }]
      .map(({ names, weight }) => ({ words: names.flatMap((name) => [...words(name), words(name).join('')]), weight }));
    let score = 0;
    for (const word of typed) {
      const best = Math.max(...fields.map((field) =>
        field.words.includes(word) ? field.weight * 2 : field.words.some((w) => w.startsWith(word)) ? field.weight : 0));
      if (!best) return [];
      score += best;
    }
    return [{ scan, score }];
  });
  return ranked.sort((a, b) => b.score - a.score).map(({ scan }) => scan);
}
