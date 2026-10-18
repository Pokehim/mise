import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ScanManifest } from '@shared/types';
import { moveInLayoutId, searchLibrary, words } from './library';

// Every Scan in data/, as GET /api/scans lists them: the library's ten rooms and the rest.
const scansDir = new URL('../../../data/scans/', import.meta.url);
const scans: ScanManifest[] = readdirSync(scansDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    try {
      return [JSON.parse(readFileSync(new URL(`${entry.name}/manifest.json`, scansDir), 'utf8'))];
    } catch {
      return [];
    }
  });

const ids = (query: string) => searchLibrary(scans, query).map(({ id }) => id);
const first = (query: string) => ids(query)[0];

describe('the library', () => {
  it('is the ten school rooms, none of them the Mover\'s yet, each with its Move-in layout', () => {
    expect(ids('').sort()).toEqual([
      'berkeley-blackwell-double', 'cmu-donner-double', 'columbia-carman-double-507a', 'gatech-peterson-double',
      'mit-new-vassar-double', 'stanford-wilbur-double', 'ucla-dykstra-triple', 'uiuc-wassaja-double-2a',
      'umich-wolverine-village-double', 'uw-lander-double',
    ]);
    for (const scan of searchLibrary(scans, '')) {
      expect(scan.mine).toBeUndefined();
      expect(readdirSync(new URL('../../../data/designs/', import.meta.url))).toContain(`${moveInLayoutId(scan.id)}.json`);
    }
  });

  it('leaves out the Scans that aren\'t school rooms', () => {
    expect(ids('study lounge')).toEqual([]);
    expect(ids('fixture')).toEqual([]);
  });
});

describe('searchLibrary', () => {
  it.each([
    ['uw', 'uw-lander-double'],
    ['UDub', 'uw-lander-double'],
    ['University of Washington', 'uw-lander-double'],
    ['UC Berkeley', 'berkeley-blackwell-double'],
    ['cal', 'berkeley-blackwell-double'],
    ['CMU', 'cmu-donner-double'],
    ['Carnegie Mellon', 'cmu-donner-double'],
    ['uiuc', 'uiuc-wassaja-double-2a'],
    ['Illinois', 'uiuc-wassaja-double-2a'],
    ['Urbana-Champaign', 'uiuc-wassaja-double-2a'],
    ['UMich', 'umich-wolverine-village-double'],
    ['u of m', 'umich-wolverine-village-double'],
    ['Georgia Tech', 'gatech-peterson-double'],
    ['GT', 'gatech-peterson-double'],
    ['gatech', 'gatech-peterson-double'],
    ['MIT', 'mit-new-vassar-double'],
    ['Massachusetts Institute of Technology', 'mit-new-vassar-double'],
    ['UCLA', 'ucla-dykstra-triple'],
  ])('finds an alias or full name: %s', (query, id) => {
    expect(first(query)).toBe(id);
  });

  it.each([
    ['washington', 'uw-lander-double'],
    ['carnegie', 'cmu-donner-double'],
    ['wash', 'uw-lander-double'],
    ['stan', 'stanford-wilbur-double'],
    ['mich', 'umich-wolverine-village-double'],
    ['colum', 'columbia-carman-double-507a'],
  ])('finds the start of a word: %s', (query, id) => {
    expect(ids(query)).toEqual([id]);
  });

  it.each([
    ['lander', 'uw-lander-double'],
    ['Lander Hall', 'uw-lander-double'],
    ['wilbur', 'stanford-wilbur-double'],
    ['donner house', 'cmu-donner-double'],
    ['new vassar', 'mit-new-vassar-double'],
    ['dykstra', 'ucla-dykstra-triple'],
    ['carman 507a', 'columbia-carman-double-507a'],
    ['wolverine village', 'umich-wolverine-village-double'],
    ['peterson', 'gatech-peterson-double'],
  ])('finds a hall or room: %s', (query, id) => {
    expect(ids(query)).toEqual([id]);
  });

  it('matches across school and hall, in any order', () => {
    expect(ids('lander uw')).toEqual(['uw-lander-double']);
    expect(ids('stanford double')).toEqual(['stanford-wilbur-double']);
  });

  it('ignores case, punctuation and extra spaces', () => {
    expect(ids('  U.W.  ')).toEqual(['uw-lander-double']);
    expect(ids('CARNEGIE-MELLON')).toEqual(['cmu-donner-double']);
    expect(ids('univ. of washington!')).toEqual(['uw-lander-double']);
  });

  it('puts the school a word names before rooms whose words only start with it', () => {
    // "Cal" is Berkeley; it also starts "California, Los Angeles".
    expect(ids('cal')).toEqual(['berkeley-blackwell-double', 'ucla-dykstra-triple']);
  });

  it.each(['Harvard', 'Princeton', 'Yale', 'Lander Yale', 'zzz'])('finds nothing for %s', (query) => {
    expect(ids(query)).toEqual([]);
  });
});

describe('words', () => {
  it('drops case and punctuation, and splits at the rest', () => {
    expect(words("U.C. Berkeley's Urbana-Champaign, N303")).toEqual(['uc', 'berkeleys', 'urbana', 'champaign', 'n303']);
  });
});
