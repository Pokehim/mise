# Poster Sources 2: Art Nouveau, Vintage Travel, Nature & Science, Japanese Prints, US Government

Researched 2026-10-18 for issue #85, as a follow-up to `docs/research/poster-sources.md` (rounds 1 and 2). The goal is about 40 more real posters and wall prints, in styles that are popular as dorm and apartment decor, to add to the 43 posters in `scripts/posters.json`. Nothing below repeats a work used or listed in round 1 or round 2.

**Rights bar.** Every pick is either (a) public domain in the US, because it was published in 1930 or earlier (the longest US term is 95 years from publication, so 1930 works entered the public domain on 1 January 2026) or because it is a US federal government work (17 U.S.C. §105), and also released by its host without restrictions; or (b) explicitly CC0 from its host. The hosts used are the Library of Congress (LoC), the Art Institute of Chicago (AIC, CC0), The Met Open Access (CC0), the Cleveland Museum of Art (CMA, CC0), and images.nasa.gov. No shops, Pinterest, poster sellers or "personal use only" sites.

**Method.** Every rights flag and date comes from the host's own API or item record, and the source URL is given next to it. "Measured" means I downloaded the file today with plain `curl`, checked that it ends with the JPEG end bytes `FF D9`, and read its size with `sips`. I looked at every pick at about 1000 px, and at full-resolution crops of small text, stamps and seals. "Crop" is the region to keep, as fractions of the full image: left, top, width, height. After the three research passes, I fetched all 24 non-LoC URLs again with plain curl (all 200 `image/jpeg`, complete, same sizes) and read `info.json` for all 16 LoC masters (same sizes).

**Rights language by host** (quoted from the hosts):
- **CMA.** API field `share_license_status: "CC0"` (`https://openaccess-api.clevelandart.org/api/artworks/<id>`). The open-access page: "High-resolution images and data related to the CMA's collection are made available under a Creative Commons Zero (CC0) designation." And: "Open access content … is content that the CMA publishes digitally, free of charge, and without copyright and licensing restrictions." And: "Works designated as Creative Commons (CC0) do not require attribution or citation." And: "Citation of the CMA's CC0 or restricted content does not imply endorsement by the CMA, nor does it grant permission to use the CMA's trademarks without prior approval." (https://www.clevelandart.org/open-access)
- **AIC.** API flag `is_public_domain: true`; the API's `info.license_links` is `https://creativecommons.org/publicdomain/zero/1.0/`. Licensing page quoted in round 1 §2 (https://www.artic.edu/image-licensing).
- **The Met.** `isPublicDomain: true` in `https://collectionapi.metmuseum.org/public/collection/v1/objects/<id>`; Open Access is CC0 (https://metmuseum.github.io/).
- **LoC Prints & Photographs.** Item field `rights_advisory` from `https://www.loc.gov/item/<id>/?fo=json`. Most picks say "No known restrictions on publication." Many foreign travel posters say "Rights status not evaluated. For general information see "Copyright and Other Restrictions ...," https://www.loc.gov/rr/print/195_copr.html". LoC places no restriction of its own on those, but makes no rights claim either, so their status rests on the publication date. Absinthe Robette has no advisory at all (see §2).
- **LoC Geography & Map Division.** Item `rights` field: "The content of the Library of Congress Geography and Map Division digitized collections is free to use and reuse unless a Rights Advisory statement is present that indicates otherwise. Credit Line: Library of Congress, Geography and Map Division." None of the map picks has a Rights Advisory.
- **NASA.** Round 2 §R2.6 quotes the NASA media guidelines and NASA Ames' "Images are not copyrighted. Please credit photos to NASA Ames Research Center." The Don Davis picks also have the artist's own public-domain statement (§4).

---

## 1. Picks (40)

`…/iiif/master:` is short for `https://tile.loc.gov/image-services/iiif/master:`. `…gct00305:` is short for `https://tile.loc.gov/image-services/iiif/service:gmd:gmd3m:g3190m:g3190m:gct00305:`. LoC `master:` URLs must be fetched at `full/full` (scaled sizes return 500; see §6).

| # | Title | Artist | Published | Collection fit | Direct image URL | px (measured) | Orientation | Text in art? |
|---|---|---|---|---|---|---|---|---|
| A1 | Chocolate and Tea | Théophile-Alexandre Steinlen | 1895 | art nouveau (new) | `https://openaccess-cdn.clevelandart.org/1946.194/1946.194_print.jpg` | 2631×3400 | portrait | yes, title lettering |
| A2 | Poppies on Black | Alphonse Mucha | 1901–02 | art nouveau | `https://openaccess-cdn.clevelandart.org/1969.237/1969.237_print.jpg` | 2435×3400 | portrait | no (margin only) |
| A3 | Princess Ilsée | Alphonse Mucha | 1897 | art nouveau | `https://openaccess-cdn.clevelandart.org/1977.1018/1977.1018_print.jpg` | 2606×3400 | portrait | signature only |
| A4 | Palais de Glace | Jules Chéret | 1893 | art nouveau / gig posters | `https://openaccess-cdn.clevelandart.org/1978.1054/1978.1054_print.jpg` | 2385×3400 | portrait | yes |
| A5 | Jane | Louis Rhead | 1898 | art nouveau | `https://openaccess-cdn.clevelandart.org/2014.126/2014.126_print.jpg` | 2155×3400 | portrait | signature only |
| A6 | Absinthe Robette | Privat-Livemont | 1896 | art nouveau | `…/iiif/master:pnp:ppmsca:10000:10090u/full/full/0/default.jpg` | 9688×12962 | portrait | yes |
| A7 | Exhibition of Decorative Art | Eugène Grasset | 1894 | art nouveau | `…/iiif/master:pnp:ppmsca:10000:10098u/full/full/0/default.jpg` | 9894×15511 | portrait | yes, a lot |
| A8 | Improvisation No. 30 (Cannons) | Vasily Kandinsky | 1913 (reproduced 1913, 1914) | museum | `https://www.artic.edu/iiif/2/b5bc6b66-9e6e-fe57-dcec-fc49e820e904/full/3000,/0/default.jpg` | 2987×3000 | square | signature only |
| A9 | Tightrope Walker | Paul Klee | 1923 | museum | `https://openaccess-cdn.clevelandart.org/1961.154/1961.154_print.jpg` | 2120×3400 | portrait | no (margin only) |
| A10 | Map of Fairyland | Bernard Sleigh | [1920?] | vintage maps (new) | `https://tile.loc.gov/image-services/iiif/service:gmd:gmd9:g9930:g9930:ct001818/full/6000,/0/default.jpg` | 6000×1842 | very wide (≈3.7:1) | yes, many captions |
| A11 | Child's Map of the Ancient World | Alice York | 1926 | vintage maps | `https://tile.loc.gov/image-services/iiif/service:gmd:gmd5:g5672:g5672m:ct012050/full/4000,/0/default.jpg` | 4000×3055 | landscape | yes |
| A12 | The Twins (Chap-Book) | Will H. Bradley | 1894 | art nouveau | `…/iiif/master:pnp:ppmsca:42200:42208u/full/full/0/default.jpg` | 4398×6107 | portrait | yes, masthead |
| A13 | Harper's March | Edward Penfield | 1895 | art nouveau | `…/iiif/master:pnp:ppmsca:43100:43111u/full/full/0/default.jpg` | 5796×7924 | portrait | yes |
| T1 | Rome Express | Roger Broders | 1921 | vintage travel (new) | `…/iiif/master:pnp:cph:3g10000:3g12000:3g12900:3g12901u/full/full/0/default.jpg` | 4908×6095 (≈3789×5266 after crop) | portrait | yes |
| T2 | London, Flower of Cities | Herry Perry | 1929 | vintage travel / vintage maps | `…/iiif/master:pnp:ppmsca:84800:84816u/full/full/0/default.jpg` | 7608×12240 | portrait | yes |
| T3 | Norway in September | Freda Lingstrom | [1920s] | vintage travel | `…/iiif/master:pnp:ppmsca:18900:18920u/full/full/0/default.jpg` | 7548×11987 | portrait | yes |
| T4 | Far West National Parks | unsigned | [1920s] | vintage travel / parks & travel | `…/iiif/master:pnp:ds:11600:11688u/full/full/0/default.jpg` | 8508×12648 | portrait | yes |
| T5 | Weymouth | Kenneth D. Shoesmith | 1929 | vintage travel | `…/iiif/master:pnp:ppmsca:98900:98995u/full/full/0/default.jpg` | 7688×12220 | portrait | yes |
| T6 | Trans-Canada Limited | G. Y. Kauffman | 1924 | vintage travel | `…/iiif/master:pnp:ds:12200:12236u/full/full/0/default.jpg` | 10476×15324 | portrait | yes |
| T7 | Old Wooden Church, Poland | Stefan Norblin | [ca. 1924] | vintage travel | `…/iiif/master:pnp:cph:3g00000:3g07000:3g07100:3g07131u/full/full/0/default.jpg` | 3820×4684 (≈1876×3012 after crop) | portrait | yes |
| J1 | Evening on the Chikugo River | Hiroshi Yoshida | 1927 | anime sunsets / museum | `https://openaccess-cdn.clevelandart.org/1930.95/1930.95_print.jpg` | 3400×2295 | landscape | signature only |
| J2 | Plum Garden at Kameido | Utagawa Hiroshige | 1857 | museum | `https://www.artic.edu/iiif/2/89a2332f-be15-8e05-bc79-778738fdc1ef/full/,4000/0/default.jpg` | 2716×4000 | portrait | cartouches |
| J3 | Kirifuri Waterfall | Katsushika Hokusai | ca. 1832 | museum / parks & travel | `https://images.metmuseum.org/CRDImages/as/original/DP141256.jpg` | 2716×3844 | portrait | cartouches |
| J4 | Ghosts of the Taira | Utagawa Kuniyoshi | 1843–47 | museum | `https://images.metmuseum.org/CRDImages/as/original/DP146823.jpg` | 3939×1986 | wide (2:1) | cartouches |
| J5 | Hydrangeas | Kamisaka Sekka | 1909/10 | museum / japanese pattern (new) | `https://www.artic.edu/iiif/2/3900f05d-0468-6132-ccab-451f98429b21/full/3000,/0/default.jpg` | 3000×2019 | landscape | no |
| J6 | Puppies | Kamisaka Sekka | 1909 (drawing) | museum | `https://openaccess-cdn.clevelandart.org/1989.85.5/1989.85.5_print.jpg` | 3400×2385 | landscape | no |
| J7 | Dancing Fox | Ohara Koson | 1900–1919 | museum / nature & science | `https://openaccess-cdn.clevelandart.org/2016.546/2016.546_print.jpg` | 1773×3400 | tall (≈1:2) | signature only |
| C1 | Jellyfish (Haeckel) | Ernst Haeckel | 1904 | nature & science (new) | `…/iiif/master:pnp:ds:05300:05316u/full/full/0/default.jpg` | 6284×8632 | portrait | outside crop only |
| C2 | Mushrooms (Haeckel) | Ernst Haeckel | 1904 | nature & science | `…/iiif/master:pnp:ds:07500:07595u/full/full/0/default.jpg` | 6295×8540 | portrait | outside crop only |
| C3 | Pompon Rose | Pierre-Joseph Redouté | 1817–24 | nature & science | `https://openaccess-cdn.clevelandart.org/1943.142/1943.142_print.jpg` | 2573×3400 | portrait | caption (croppable) |
| C4 | Turban Lily | Pierre-Joseph Redouté | 1802–16 | nature & science | `https://openaccess-cdn.clevelandart.org/2020.164/2020.164_print.jpg` | 2336×3400 | portrait | caption (croppable) |
| C5 | Florida Jays | Havell after Audubon | 1830 | nature & science | `https://www.artic.edu/iiif/2/bf44e53f-9df4-3246-8acd-3af23625396a/full/,3000/0/default.jpg` | 2029×3000 (1704×2370 after crop) | portrait | small plate text |
| C6 | Copernican Planisphere | Andreas Cellarius | 1708 | nature & science / space | `…gct00305:ca000006/full/4000,/0/default.jpg` | 4000×3519 | landscape | yes, Latin cartouche |
| C7 | Moon Map | J. G. Doppelmayr / J. B. Homann | early 1700s (in a 1708 atlas) | nature & science / space | `…gct00305:ca000023/full/4000,/0/default.jpg` | 4000×3418 | landscape | yes, title and crater names |
| C8 | Torus Colony Interior | Don Davis for NASA Ames | 1975 | space | `https://images-assets.nasa.gov/image/ARC-1975-AC75-2621/ARC-1975-AC75-2621~orig.jpg` | 3393×2604 | landscape | signature only |
| C9 | Cylinder Colony at Eclipse | Don Davis for NASA Ames | 1975 | space | `https://images-assets.nasa.gov/image/ARC-1975-AC75-1920/ARC-1975-AC75-1920~orig.jpg` | 2476×3427 | portrait | signature only |
| C10 | Building the Torus | Don Davis for NASA Ames | 1975 | space | `https://images-assets.nasa.gov/image/ARC-1975-AC75-1886/ARC-1975-AC75-1886~orig.jpg` | 3460×2603 | landscape | signature only |
| C11 | Visit the Zoo (herons) | WPA Federal Art Project, Pennsylvania | [1936–41] | parks & travel / WPA modern (new) | `…/iiif/master:pnp:ds:08200:08248u/full/full/0/default.jpg` | 6008×7776 | portrait | yes |
| C12 | The Drama of the Heavens | "Beard", WPA FAP Chicago | [1939] | space | `…/iiif/master:pnp:cph:3b40000:3b48000:3b48700:3b48791u/full/full/0/default.jpg` | 2951×4360 (2331×3758 after crop) | portrait | yes |
| C13 | Visit the Aquarium (jellyfish) | Hugh Stevenson, WPA FAP Pennsylvania | [1936 or 1937] | parks & travel / WPA modern | `…/iiif/master:pnp:cph:3f00000:3f05000:3f05600:3f05602u/full/full/0/default.jpg` | 2749×4096 (≈2232×2884 after crop) | portrait | yes |

Object pages, full rights evidence, aspect ratios, crops and transcribed text are in the per-group tables below (§2–§4).

### 1.1 Suggested new collections

| Collection | Picks |
|---|---|
| **art nouveau** (new) | A1–A7, A12, A13 (alternates: Berthon *Les Boules de Neige*, de Feure *Retour*, Mucha *Oriental Poppies* / *Sweet Peas*) |
| **vintage travel** (new) | T1–T7 (T4 also fits parks & travel) |
| **nature & science** (new) | C1–C7, J7 (alternates: Haeckel hummingbirds and sea anemones, Thornton passion-flower, Redouté Moss Rose) |
| **vintage maps** (new, or fold into vintage travel) | A10, A11, T2 |
| museum (existing) | A8, A9, J2–J6 (J1 also fits) |
| space (existing) | C8–C10, C12; C6 and C7 also fit |
| parks & travel (existing) | C11, C13, T4, J3 |
| anime sunsets (existing) | J1 is a real 1927 dusk river scene that reads like one |

### 1.2 Things to decide before using

- **Still-existing brand or institution names in the art:** *Harper's* (A13, still published); Canadian Pacific (T6, now CPKC, in big type); "Great Western Railway" (T2, a live train-operator brand since 2015); "Southern Railway" (T5, close to today's "Southern" operator); Adler Planetarium and Chicago Park District (C12). Alternates: Olympia (Chéret, a working Paris music hall), Wagons-Lits / Pullman (Étoile du Nord). All are historic uses, like the venue names in round 2's gig posters.
- **Nudity / alcohol / sensitive content:** A6 advertises absinthe and the figure wears sheer drapery; A7's figure has one breast bare; A11's border shows religious figures (Moses, Buddha, Confucius, Jesus); the Haere Mai alternate is a 1920s tourist stereotype of Māori women.
- **Weakest rights evidence:** A6 (LoC gives no rights advisory; PD by its 1896 date), A9 (CMA CC0, but no host names the 1923 portfolio it was published in), T1–T3, T5–T7 (LoC "Rights status not evaluated"; PD by date), T7 (date "ca. 1924" from LoC only), C8–C10 (NASA records have no copyright field; the artist's own PD page covers them).
- **Size:** C5 is the only pick below 2000 px on the long side after cropping (1704×2370; AIC's source is only 2029×3000). T7 keeps ≈1876×3012 after its mandatory crop. A8 is square, J4 is 2:1, J7 is about 1:2, and A10 is a 3.7:1 banner, so those need a matching frame or a mat.

---

## 2. Art Nouveau posters (group 1) and other public-domain decor (group 6)

### 2.1 Picks

| # | Title | Artist | Published | Host + object page | Direct image URL | px (measured) | Orientation / ratio | Collection fit | Text in art? | Crop (l, t, w, h) |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Chocolate and Tea (girl, mother and black cat) | Théophile-Alexandre Steinlen | 1895 | CMA 1946.194, https://clevelandart.org/art/1946.194 | `https://openaccess-cdn.clevelandart.org/1946.194/1946.194_print.jpg` | 2631×3400 | portrait, 0.77 (after crop ≈ 3:4) | art nouveau | Yes: large title lettering | 0.07, 0.05, 0.87, 0.90 |
| A2 | Poppies on Black (Documents Décoratifs pl. 38) | Alphonse Mucha | 1901–02 | CMA 1969.237, https://clevelandart.org/art/1969.237 | `https://openaccess-cdn.clevelandart.org/1969.237/1969.237_print.jpg` | 2435×3400 | portrait, 0.72 (after crop ≈ 2:3) | art nouveau | Only "PL. 38" in the margin (cropped off) | 0.09, 0.07, 0.82, 0.87 |
| A3 | Ilsée, Princess of Tripoli | Alphonse Mucha | 1897 | CMA 1977.1018, https://clevelandart.org/art/1977.1018 | `https://openaccess-cdn.clevelandart.org/1977.1018/1977.1018_print.jpg` | 2606×3400 | portrait, 0.77 (≈ 3:4) | art nouveau | Only a tiny "Mucha" signature | 0.05, 0.025, 0.92, 0.95 |
| A4 | Palais de Glace (ice skater) | Jules Chéret | 1893 | CMA 1978.1054, https://clevelandart.org/art/1978.1054 | `https://openaccess-cdn.clevelandart.org/1978.1054/1978.1054_print.jpg` | 2385×3400 | portrait, 0.70 | art nouveau (or gig posters) | Yes: "PALAIS DE GLACE / Champs Elysées" | 0.01, 0.005, 0.98, 0.99 |
| A5 | Jane (woman before lilies) | Louis Rhead | 1898 | CMA 2014.126, https://clevelandart.org/art/2014.126 | `https://openaccess-cdn.clevelandart.org/2014.126/2014.126_print.jpg` | 2155×3400 | portrait, 0.63 (after crop 0.61) | art nouveau | Only a "LOUIS RHEAD" signature | 0.045, 0.03, 0.91, 0.945 |
| A6 | Absinthe Robette | Privat-Livemont | 1896 | LoC 93506832, https://www.loc.gov/item/93506832/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ppmsca:10000:10090u/full/full/0/default.jpg` | 9688×12962 | portrait, 0.75 (3:4) | art nouveau | Yes: "ABSINTHE ROBETTE" | 0.015, 0.005, 0.975, 0.99 |
| A7 | Exhibition of Decorative Art (woman with lilacs) | Eugène Grasset | 1894 | LoC 2002720179, https://www.loc.gov/item/2002720179/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ppmsca:10000:10098u/full/full/0/default.jpg` | 9894×15511 | portrait, 0.64 (≈ 11:17) | art nouveau | Yes: a lot (title, dates, prices) | 0.02, 0.008, 0.965, 0.98 |
| A8 | Improvisation No. 30 (Cannons) | Vasily Kandinsky | painted 1913; reproduced in print 1913 and 1914 | AIC 8991, https://www.artic.edu/artworks/8991 | `https://www.artic.edu/iiif/2/b5bc6b66-9e6e-fe57-dcec-fc49e820e904/full/3000,/0/default.jpg` | 2987×3000 (source 10199×10244) | square, 1:1 | museum (or a new "modern art" set) | Only a "Kandinsky 1913" signature, lower left | none (full-bleed canvas) |
| A9 | Tightrope Walker | Paul Klee | 1923 (editioned lithograph) | CMA 1961.154, https://clevelandart.org/art/1961.154 | `https://openaccess-cdn.clevelandart.org/1961.154/1961.154_print.jpg` | 2120×3400 | portrait, 0.62 | museum / modern art | Only pencil marks in the margin (cropped off) | 0.045, 0.02, 0.91, 0.915 |
| A10 | An Anciente Mappe of Fairyland | Bernard Sleigh | [1920?] per LoC | LoC 2006628749, https://www.loc.gov/item/2006628749/ | `https://tile.loc.gov/image-services/iiif/service:gmd:gmd9:g9930:g9930:ct001818/full/6000,/0/default.jpg` | 6000×1842 (source 17861×5484) | very wide landscape, ≈ 3.7:1 after crop | new "vintage maps" | Yes: dozens of mock-medieval captions | 0.012, 0.055, 0.978, 0.865 |
| A11 | A Child's Map of the Ancient World | Alice York | 1926 ("Copyright/1926 Alice York") | LoC 94681976, https://www.loc.gov/item/94681976/ | `https://tile.loc.gov/image-services/iiif/service:gmd:gmd5:g5672:g5672m:ct012050/full/4000,/0/default.jpg` | 4000×3055 (source 10183×7779) | landscape, 4:3 after crop | vintage maps | Yes: place names and a border of historical figures | 0.03, 0.025, 0.94, 0.925 |
| A12 | The Twins (The Chap-Book) | Will H. Bradley | 1894 | LoC 2014647783, https://www.loc.gov/item/2014647783/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ppmsca:42200:42208u/full/full/0/default.jpg` | 4398×6107 | portrait, 0.72 (after crop 0.70) | art nouveau (magazine poster) | Yes: "The Chap-Book" masthead | 0.03, 0.015, 0.94, 0.97 |
| A13 | Harper's March (lady and white rabbit) | Edward Penfield | 1895 | LoC 2015646474, https://www.loc.gov/item/2015646474/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ppmsca:43100:43111u/full/full/0/default.jpg` | 5796×7924 | portrait, 0.73 | art nouveau (magazine poster) | Yes: "HARPER'S / MARCH" | 0.015, 0.012, 0.965, 0.97 |

**Group mapping.** Group 1 (Art Nouveau posters) is A1–A7. Group 6 (other PD decor) is A8–A13: modern art (A8–A9), vintage maps (A10–A11) and pre-1931 magazine posters (A12–A13), which also suit the art nouveau collection. I found no clean sheet-music cover or New Yorker cover (see §2.3).

### 2.2 Notes per work

**A1. Steinlen, *Compagnie Française des Chocolats et des Thés* (CMA 1946.194).**
- CMA record: "lithograph", "Sheet: 30.7 x 23.2 cm", Gift of The Print Club of Cleveland, `share_license_status: "CC0"`, dated 1895.
- At full resolution there is a blind stamp in the bottom-right margin reading "…MAÎTRES DE L'AFFICHE". So this is the small reduction printed for *Les Maîtres de l'Affiche* (1895–1900), not the full-size street poster. It is still a pre-1931 publication.
- Text: "COMPAGNIE FRANCAISE DES CHOCOLATS ET DES THÉS"; on the tin, "THÉ DE CHINE … COMPAGNIE …"; printer line "IMP. COURMONT Frères, 10, Rue Bréguet, PARIS"; a "COURMONT FRÈRES IMPRIMEURS PARIS" cartouche; the "Steinlen" signature with monogram.
- The company is long defunct. The cat is the famous Steinlen black cat. The crop trims the cream sheet margin and the blind stamp.

**A2. Mucha, *Documents Décoratifs*, plate 38 (CMA 1969.237).**
- CMA record: "lithograph", dated 1901–2, Mr. and Mrs. Charles G. Prasse Collection, CC0. It is a plate from Mucha's pattern book *Documents Décoratifs* (Paris, 1902).
- Composition: a band of red poppy pattern and a cream tile motif at the top, over tall orange poppies on a dark brown ground. Very decorative, no figure.
- The only text is "PL. 38", top right, in the margin. The crop removes it with the cream margin.
- Alternates from the same book, all CC0 with ≈2400×3400 print JPGs: **Oriental Poppies** on a cream ground (CMA 1969.236, `…/1969.236/1969.236_print.jpg`, 2400×3400) and **Sweet Peas** (CMA 1969.238, 2397×3400).

**A3. Mucha, *Ilsée, Princesse de Tripoli* (CMA 1977.1018).**
- CMA record: "color lithograph", 1897, creators "Alphonse Mucha" and "by Robert de Flers [record misspells it "Lfers"], published by H. Piazza", sheet 32 × 50 cm, image 20.1 × 14.9 cm. CC0.
- It is a full-page plate from the 1897 illustrated book. A seated princess sits in a knotwork frame with two doves at the top. Muted teal, rose and gold.
- Text: a tiny "Mucha" signature only, lower left inside the frame. No stamps. The crop trims the paper margin.

**A4. Chéret, *Palais de Glace* (CMA 1978.1054).**
- CMA record: "lithograph", 1893, sheet 123.7 × 86.9 cm (full street-poster size). The Harold T. Clark Educational Extension Fund. CC0.
- Text: "PALAIS DE GLACE / Champs Elysées"; the "J. Chéret" signature, right; a tiny vertical printer's line, lower left (Imp. Chaix, Ateliers Chéret, Paris).
- **Mark:** the hexagonal French poster-tax stamp ("RÉPUBLIQUE FRANÇAISE … SEINE … 20"). It sits inside the art at about x 0.90, y 0.85, about 3.5% wide. No crop removes it without cutting the image, so leave it or retouch it.
- The Palais de Glace was a Champs-Élysées skating rink. The building is now the Théâtre du Rond-Point, so the name is historic, not a current brand.
- Alternate: Chéret, **Olympia, anciennes Montagnes Russes** (1892, CMA 1987.1063, `…/1987.1063/1987.1063_print.jpg`, 2471×3400, crop 0.02, 0.01, 0.965, 0.98). **Flag:** L'Olympia on Boulevard des Capucines is still a famous working Paris music hall.

**A5. Louis Rhead, *Jane* (CMA 2014.126).**
- CMA record: "color lithograph", 1898, creators "Louis Rhead (American, 1857–1926)" and "Imprimerie Champenois", sheet 40 × 30.5 cm. Bequest of John Bonebrake. CC0.
- A mat inscription quoted in the record says it was "Published by L'Estampe Moderne, No. 19, 1898, their blindstamp lower right corner".
- Text: a "LOUIS RHEAD" signature, lower right, inside the keyline. The blind stamp is outside the crop.
- Composition: a woman in green before a wall of orange lilies on blue. A keyline frame; the crop keeps it.

**A6. Privat-Livemont, *Absinthe Robette* (LoC 93506832).**
- LoC record: "Bruxelles : Des Presses de J.L. Goffart, 1896." Call number POS - Bel .L58, no. 6 (C size), LC-DIG-ppmsca-10090.
- **Rights caveat:** this record has **no `rights_advisory` field.** The general LoC statement applies: "The Library of Congress does not own rights to material in its collections … it is the researcher's obligation to assess copyright". The poster was published in 1896, so it is public domain in the US. But it lacks the explicit "No known restrictions" line that the other LoC picks have. If that matters, use AIC 16876, Privat-Livemont *J.C. Boldoot Eau de Cologne* (c. 1899, `is_public_domain: true`, source 1668×3000, a narrow 0.56). **Flag:** Boldoot is a Dutch perfume brand, and I did not check whether it is still sold.
- Text: "ABSINTHE ROBETTE"; the printer's block "DES PRESSES DE J.L. GOFFART LITHOGRAPHE BRUXELLES", lower left; the signature "Privat-Livemont 96", lower right. Robette is a defunct absinthe brand (absinthe was banned in Belgium in 1906). **It advertises alcohol**, and the woman wears only sheer drapery, with her breast visible in outline.
- The scan has a thin dark surround, mostly on the left. The crop removes it. Fetch: `full/full` returned 503 twice, a truncated 200 twice, then a complete 16.8 MB file.

**A7. Grasset, *1e Exposition d'Art Décoratif* (LoC 2002720179).**
- LoC record: "Paris : G. de Malherbe, 12 Passage des Favorites, 1894." "1 print (poster) : lithograph, color ; 130 x 82 cm (image)". LC-DIG-ppmsca-10098. Rights: "No known restrictions on publication."
- Text, in full: "SOCIÉTÉ DES ARTISTES DÉCORATEURS / 1e EXPOSITION D'ART DÉCORATIF / ouverte de 9 h. à 6 h. au PETIT PALAIS DES CHAMPS-ÉLYSÉES DU 16 JANVIER au 15 FÉVRIER / PRIX D'ENTRÉE: VERNISSAGE 15 JANVIER 5 Fr. / JOUR D'OUVERTURE 16 JANVIER 2 Fr. / DIMANCHE APRÈS-MIDI 0.50 / LES AUTRES JOURS 1 Fr."; the "EG" monogram; a tiny vertical printer's line at lower left. About a quarter of the sheet is lettering.
- **The figure is partly nude** (one breast bare under pink drapery).
- The sheet's ratio, 0.638, is close to 11:17. The crop only trims the grey board edges. Fetch: `full/full` failed six times in a row (503 or truncated) before a complete 17 MB file arrived. Use the retry loop from R2.2.
- Rejected Grasset alternate: CMA 1976.1071, *L'Andalousie au temps des Maures* (c. 1900). The CMA combined image shows a visible seam between its two sheets, the left half alone cuts "MAURES" off, and it has a tax stamp.

**A8. Kandinsky, *Improvisation No. 30 (Cannons)* (AIC 8991).**
- AIC API: `is_public_domain: true`, accession 1931.511, "Oil on canvas", 111 × 111.3 cm. Arthur Jerome Eddy Memorial Collection. `copyright_notice: null`. Image id `b5bc6b66-9e6e-fe57-dcec-fc49e820e904`.
- **Published before 1931.** AIC's own `publication_history` lists *Kandinsky, 1901-1913* (Berlin: Der Sturm, 1913), p. 8 (ill.), and Eddy, *Cubists and Post-Impressionism* (Chicago: A. C. McClurg & Co., 1914), opp. p. 124 (color ill.). Source: `https://api.artic.edu/api/v1/artworks/8991?fields=publication_history`.
- `full/3000,/` returned 2987×3000: AIC capped the long side at 3000. Plain curl worked without a custom UA this time, but keep `mise-poster/1.0` because of round 1's Node 403. Text: "Kandinsky 1913", lower left. Full-bleed, no crop.
- Alternate: **Painting with Troika** (AIC 8983, 1911, image `a45e5f55-d02b-ce98-8bab-3af549684f58`, source 9871×7247, landscape, in the artist's painted frame). It is also published in *Kandinsky, 1901-1913* (Der Sturm, 1913), p. 56 (ill.), per AIC. Not downloaded at full size.

**A9. Klee, *Tightrope Walker* (CMA 1961.154).**
- CMA record: "color lithograph", 1923, state "IVc", catalogue raisonné "Kornfeld 95". Gift via the Print Club of Cleveland, 1961. `share_license_status: "CC0"`, `copyright: null`.
- **Caveat:** the CMA record does not name the edition or portfolio it was published in. The case for pre-1931 publication rests on its being an editioned 1923 lithograph (Kornfeld 95, a numbered state), together with CMA's CC0 designation. I did not find a host page that states the publication.
- Composition: a pink field with a white cross. A thin line-drawn acrobat stands on a rope over a scaffold of ladders.
- Text: the pencil "1923 138" (lower left) and "Klee" (lower right) sit in the margin under the image; the crop removes them.
- Rejected: the CMA Klee *Small World* (1914) and *Calculating Old Man* (1929) are black-and-white etchings, which work less well as decor.

**A10. Bernard Sleigh, *An Anciente Mappe of Fairyland* (LoC 2006628749).**
- LoC record: "London : Sidgwick & Jackson, [1920?]", "1 view : col. ; 36 x 144 cm", call number G9930 1920 .S51. G&M rights statement as above, no advisory. Published 1920 or earlier, so it is public domain in the US.
- Text: "AN ANCIENTE MAPPE OF FAIRY LAND newly discovered and set forth", and a legend ("A Wishing Well. Dwarf's Treasure. An Inn. A Temple. A Fairie Shrine. A Village Inn."). There are dozens of captions in mock-medieval English ("The Bay of Dreames", "Here is Mermaides Rock where they doe singe", "This is the Shippe of Solomon wherein are ye Sacred Spindles").
- Below the border, outside the crop: "DESIGNED BY BERNARD SLEIGH", a printer's line ("Printed in Great Britain by Vincent Brooks Day & Son"), a publisher's line ("Published by Sidgwick & Jackson … 44 Museum Street, London"), an LoC "G & M Division 25 FEB 1972" receipt stamp, and a collection stamp. **Flag:** Sidgwick & Jackson survives as a Pan Macmillan imprint, but that text sits outside the crop.
- **Ratio about 3.7:1.** Use it as an over-bed or long-wall banner, not a standard poster. The other LoC copy, 93684824 (`ct007669`, source 22024×6343), has visible fold seams. Use 2006628749.
- G&M service images accept scaled IIIF sizes (`full/6000,/` and `full/4000,/` returned 200 in about 10 s), unlike P&P masters.

**A11. Alice York, *A Child's Map of the Ancient World* (LoC 94681976).**
- LoC record: "New York : John Day Company, c1926." The notes say "Pictorial historical map." and quote "Copyright/1926 Alice York." G&M rights statement, no advisory. Published 1926, so it is public domain in the US.
- A Mediterranean map on orange ground with ships, armies and camels. A border of figures runs from "PYRAMID AGE" through Moses, Homer, Socrates, Cleopatra, Buddha, Confucius and Jesus Christ. It is colourful and reads well from a distance. **It depicts religious figures**, which is worth knowing for a public catalog.
- Outside the crop: the publisher's line "THE JOHN DAY COMPANY INC. PUBLISHERS … NEW YORK" (a defunct firm), a red LoC receipt stamp, and a pencil call number, all bottom right.

**A12. Will H. Bradley, *The Chap-Book: The Twins* (LoC 2014647783).**
- LoC record: "[Chicago] : [Stone & Kimball], 1894." "1 print : color ; sheet 51 x 36 cm (poster format)". LC-DIG-ppmsca-42208. Rights: "No known restrictions on publication."
- Text: "The Chap-Book" masthead, top; the "WILL H BRADLEY '94" signature, lower left. *The Chap-Book* was an 1890s literary magazine, long defunct.
- A flatbed scan on a dark surround. The crop removes it.
- Alternate: Bradley, *The Chap Book—Thanksgiving No.* (1895, LoC 97507377). The master `ppmsca:05900:05938u` is only 2010×2964.

**A13. Edward Penfield, *Harper's March* (LoC 2015646474).**
- LoC record: "[New York] : [Harper's & Brothers], 1895." Sheet 44 × 31 cm, LC-DIG-ppmsca-43111. Gift, J.H. Corning estate. Rights: "No known restrictions on publication."
- Text: "HARPER'S / MARCH"; the "EDWARD PENFIELD" signature; a flying magazine whose upside-down cover reads "HARPER'S MAGAZINE". **Flag:** *Harper's Magazine* is still published, so this names a current brand.
- A small paper loss at the bottom-right corner, at about x 0.97, y 0.95, sits just inside the crop. Tighten to 0.015, 0.012, 0.95, 0.93 to drop it.
- LoC has many more Penfield *Harper's* posters as 4000–8000 px `ppmsca:43xxx` masters. For example, *Harper's February* 1896 (2015646455, 4530×7935) has a skating couple.

### 2.3 Rejected or could not verify
- **Met (any item).** The Met API returned an Incapsula bot-wall page ("Request unsuccessful. Incapsula incident ID …") to `collectionapi.metmuseum.org` after a burst of parallel lookups, probably from several forks at once. So I could not check Met posters. Round 1 found all Met Muchas `isPublicDomain: false` anyway.
- **LoC Mucha, *Job* (1898), 95504874,** and ***Lorenzaccio* (1896), 95504816.** Their ppmsca masters (10089, 85245) returned HTTP 500 on both `info.json` and `full/full`. The cph copies are only about 1130×1440. CMA also has *Lorenzaccio* (1973.1018), but it is the small *Maîtres de l'Affiche* reduction on a big sheet, and the art is only about 30% of the image width.
- **LoC Mucha, *La Dame aux Camélias*,** 00652382. It is split into top and bottom film-copy scans (two masters), so it would need stitching.
- **LoC Grasset, *Encre L. Marquet*** (2002720172) and ***Salon des Cent*** (2002720085). "Rights status not evaluated" and slide scans only.
- **LoC Privat-Livemont, *Cercle artistique de Schaerbeek*** (2002721255) and ***Rajah*** (2002721243). "Rights status not evaluated", slide scans only. ***Helm Cocoa*** (2005693040) has "No known restrictions" and a 7826×18020 master, but it is very tall (0.43). Not downloaded.
- **Kandinsky *Klänge* (AIC 44014, published 1913).** The image is a whole book page; the woodcut fills only about half of it (about 1000 px).
- **Malevich, Sonia Delaunay, Hilma af Klint.** Nothing PD/CC0 at AIC or CMA. I did not pursue af Klint: her paintings were not published in her lifetime, so their US status depends on when they were first published, which is unclear.
- **Sheet-music covers.** Smithsonian Open Access returned about 3,900 "sheet music" records, but the 1910s–1930s NMAH covers I sampled carry no CC0 media flag (`usage.access` was empty). Only one NMAAHC 1890s item was CC0. I did not search the LoC "Historic Sheet Music" collection in depth.
- **New Yorker covers (1925–1930).** None of the allowed hosts offers them with a PD/CC0 flag. Not pursued.
- **Berthon, *Les Boules de Neige*** (CMA 1991.175, c. 1900, CC0, 3400×2819, landscape) and **de Feure, *Retour*** (CMA 2016.171, 1897, CC0, 2669×3400). Both are clean and usable; I left them out only to hold the count at 13. Berthon text: "LES BOULES DE NEIGE", "PAUL BERTHON", "Imprimerie Chaix Paris"; crop about 0.04, 0.12, 0.92, 0.76. De Feure crop about 0.02, 0.01, 0.96, 0.98; tiny signature at left. Chéret *Viviane* (1886) and *Musée Grévin* (1887) at CMA are also CC0 (about 2300–2400×3400).

### 2.4 Fetching notes (new versus poster-sources.md)
- **CMA is the best Art Nouveau source.** Each CC0 record has an `images.print.url` JPEG at 3400 px on the long side (`https://openaccess-cdn.clevelandart.org/<accession>/<accession>_print.jpg`). Plain curl worked first time on all nine I fetched, with no User-Agent needed. The API needs no key: `https://openaccess-api.clevelandart.org/api/artworks/?q=<text>&cc0=1&has_image=1`. `images.full` is a TIFF, which you don't need.
- **LoC G&M maps use `service:gmd:…` IIIF ids, and scaled sizes work there** (`full/6000,/`, `full/4000,/`). P&P masters still need `full/full` (poster-sources.md §1, R2.2).
- **LoC P&P masters were very flaky today.** `full/full` gave 503 or truncated bodies on most first tries. Two ppmsca masters (10089, 85245) returned HTTP 500 even on `info.json`. The FF D9 check plus retries (R2.2) remain essential. The loop needed up to 8 tries for the Grasset.
- **The Met API now blocks bursts.** About 60 object lookups in a few seconds (8 threads) triggered an Incapsula block on `collectionapi.metmuseum.org`. Throttle to about 1 request per second and avoid parallel runs.

---

## 3. Vintage travel posters (group 2) and Japanese prints (group 4)

### 3.1 Picks

| # | Title | Artist | Published | Host + object page | Direct image URL | px (measured) | Orientation / ratio | Collection fit | Text in art? | Crop (l, t, w, h) |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | Rome Express | Roger Broders | 1921 | LoC, https://www.loc.gov/item/2006675134/ | `https://tile.loc.gov/image-services/iiif/master:pnp:cph:3g10000:3g12000:3g12900:3g12901u/full/full/0/default.jpg` | 4908×6095 (poster area ≈3789×5266) | portrait, ≈0.72 (≈5:7) after crop | vintage travel | Yes: "CHEMINS DE FER PARIS-LYON-MÉDITERRANÉE / ROME / Par le train de luxe "ROME EXPRESS"" | 0.112, 0.080, 0.772, 0.864 (removes the KODAK grey bar, colour patches and black slide surround) |
| T2 | London, Flower of Cities (map poster) | Herry Perry | 1929 | LoC, https://www.loc.gov/item/2022654749/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ppmsca:84800:84816u/full/full/0/default.jpg` | 7608×12240 | portrait, 0.62 (≈5:8) | vintage travel | Yes: "LONDON / THOU·ART·THE·FLOWER / OF·CITIES·ALL / GREAT WESTERN RAILWAY", ribbon labels, map street names | 0.009, 0.007, 0.976, 0.978 (thin dark scan edge only) |
| T3 | Norway in September | Freda Lingstrom | [192-] | LoC, https://www.loc.gov/item/2008679876/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ppmsca:18900:18920u/full/full/0/default.jpg` | 7548×11987 | portrait, 0.63 (≈5:8) | vintage travel | Yes: "NORWAY in SEPTEMBER" plus a 4-line text block at the bottom | 0.008, 0.005, 0.985, 0.991. To drop the bottom text block too: 0.008, 0.005, 0.985, 0.875 |
| T4 | Visit Your Far West National Parks | unsigned (Newman-Monroe Co., printer) | [1920s] | LoC, https://www.loc.gov/item/2018646001/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ds:11600:11688u/full/full/0/default.jpg` | 8508×12648 | portrait, 0.65 (≈2:3) | vintage travel or parks & travel | Yes: "Travel by Train / visit your Far West National Parks / U.S.A.-CANADA" | 0.030, 0.019, 0.936, 0.962 |
| T5 | Weymouth | Kenneth D. Shoesmith | 1929 (print code on the sheet; LoC says [between 1920 and 1930]) | LoC, https://www.loc.gov/item/2025163035/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ppmsca:98900:98995u/full/full/0/default.jpg` | 7688×12220 | portrait, 0.62 (≈5:8) | vintage travel | Yes: "WEYMOUTH / Free Guide from Town Clerk, Weymouth, Dorset. / Express Trains and Holiday Fares by SOUTHERN RAILWAY." | 0.016, 0.011, 0.967, 0.978 |
| T6 | Trans-Canada Limited | G. Y. Kauffman | 1924 | LoC, https://www.loc.gov/item/2018648019/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ds:12200:12236u/full/full/0/default.jpg` | 10476×15324 | portrait, 0.67 (2:3) | vintage travel | Yes: "TRANS-CANADA LIMITED / FASTEST TRAIN ACROSS THE CONTINENT / SLEEPING CARS ONLY / CANADIAN PACIFIC" | 0.041, 0.029, 0.919, 0.941 (crops to the blue border and removes the paper margin) |
| T7 | Polish State Railways: Old Wooden Church | Stefan Norblin | [ca. 1924] | LoC, https://www.loc.gov/item/00650659/ | `https://tile.loc.gov/image-services/iiif/master:pnp:cph:3g00000:3g07000:3g07100:3g07131u/full/full/0/default.jpg` | 3820×4684 (poster area ≈1876×3012) | portrait, 0.62 after crop | vintage travel | Yes: "CHEMINS DE FER DE L'ETAT POLONAIS" plus 4 lines in Polish, French, English and German | 0.252, 0.165, 0.491, 0.643 (**mandatory**: the scan is a photo of the poster on a light table with KODAK bars) |
| J1 | Evening on the Chikugo River | Yoshida Hiroshi | 1927 | Cleveland Museum of Art, https://clevelandart.org/art/1930.95 | `https://openaccess-cdn.clevelandart.org/1930.95/1930.95_print.jpg` | 3400×2295 (TIFF `…/1930.95_full.tif` is 7284×4916) | landscape, 1.50 (3:2) after crop | anime sunsets or museum | Margin only (title and date, left). Inside the art: the signature "Yoshida" and a red seal | 0.033, 0.077, 0.889, 0.875 (removes the paper margin, the margin text and the jizuri seal) |
| J2 | Plum Garden at Kameido | Utagawa Hiroshige | 1857 | AIC, https://www.artic.edu/artworks/26577 | `https://www.artic.edu/iiif/2/89a2332f-be15-8e05-bc79-778738fdc1ef/full/,4000/0/default.jpg` | 2716×4000 (source 4211×6202) | portrait, 0.67 (2:3) | museum | Yes: the red title cartouche and series cartouche (top right), the signature cartouche (left) | 0.056, 0.061, 0.899, 0.910 (removes the margin, the round date seal and the publisher seal) |
| J3 | Kirifuri Waterfall | Katsushika Hokusai | ca. 1832 | The Met, https://www.metmuseum.org/art/collection/search/56139 | `https://images.metmuseum.org/CRDImages/as/original/DP141256.jpg` | 2716×3844 | portrait, 0.70 (≈5:7) | museum or parks & travel | Yes: the series and title cartouche (top right), signature and seals (bottom right) | 0.011, 0.007, 0.974, 0.982 (thin margin only) |
| J4 | Ghosts of the Taira at Daimotsu Bay | Utagawa Kuniyoshi | 1843–47 | The Met, https://www.metmuseum.org/art/collection/search/55743 | `https://images.metmuseum.org/CRDImages/as/original/DP146823.jpg` | 3939×1986 | wide landscape, 2.0 (2:1) | museum | Yes: the title cartouche (top right), three signature cartouches with seals | 0.009, 0.024, 0.986, 0.958 |
| J5 | Hydrangeas (Momoyogusa) | Kamisaka Sekka | 1909/10 | AIC, https://www.artic.edu/artworks/127737 | `https://www.artic.edu/iiif/2/3900f05d-0468-6132-ccab-451f98429b21/full/3000,/0/default.jpg` | 3000×2019 (source 3534×2378) | landscape, 1.50 (3:2) | museum or a new "japanese pattern" set | No | 0.004, 0.015, 0.992, 0.981 (paper edge only) |
| J6 | Puppies (Momoyogusa sketch) | Kamisaka Sekka | 1909 (preparatory drawing) | Cleveland, https://clevelandart.org/art/1989.85.5 | `https://openaccess-cdn.clevelandart.org/1989.85.5/1989.85.5_print.jpg` | 3400×2385 | landscape, 1.43 (≈10:7) | museum | No | 0.015, 0.016, 0.969, 0.968 (sheet edge) |
| J7 | Dancing Fox | Ohara Koson | 1900–1910s | Cleveland, https://clevelandart.org/art/2016.546 | `https://openaccess-cdn.clevelandart.org/2016.546/2016.546_print.jpg` | 1773×3400 | tall portrait, 0.54 (≈1:2, a hanging-scroll format) | museum or nature & science | Only the signature "Koson" and a red seal (right, inside the art) | 0.030, 0.079, 0.943, 0.907 (removes the top paper strip and the margins) |

**Alternates that also passed:**
- **Étoile du Nord**, A. M. Cassandre, published 1928 by Chemin de fer du Nord (signed "A.M. CASSANDRE 27"), https://www.loc.gov/item/2002718933/. Master `cph:3b50000:3b52000:3b52200:3b52262u` is **only 1113×1536**. It only just clears 1500 px. Crop 0.008, 0.006, 0.985, 0.988. Text: "CHEMIN DE FER DU NORD / ÉTOILE DU NORD / PULLMAN / PARIS–BRUXELLES–AMSTERDAM / COMPAGNIE DES WAGONS-LITS", plus "NEDERLANDSCHE SPOORWEGEN" and "SOCIÉTÉ NATIONALE DES CHEMINS DE FER BELGES" up the sides. It is the most famous design here, but the file is soft. **Brands:** Wagons-Lits and Pullman are still used as brand names (Orient Express / Accor), and NS and SNCB still operate.
- **Haere Mai (Welcome) to New Zealand**, published [1920s] by W.A.G. Skinner, Government Printer, Wellington, https://www.loc.gov/item/2015647598/. Master `ds:07300:07349u` gives **7785×12288**. Crop 0.035, 0.011, 0.927, 0.896 (this also drops the blank strip at the bottom). Text: "HAERE MAI (Welcome) to NEW ZEALAND". It shows Māori women at a geyser. That is a 1920s tourist stereotype, so it may not suit the app.
- **Silvered Waves Against a Beach**, Sekka, Momoyogusa 1909/10, AIC 127738 (`is_public_domain: true`). `https://www.artic.edu/iiif/2/04397e86-bc62-6335-7459-cea2fd94ab6a/full/3000,/0/default.jpg` gives 3000×2023. A very pale, minimal wave pattern with no crop and no text. It suits a "quiet" wall.
- **Kirifuri Waterfall, Met 55019** (`DP141247.jpg`). It measures only 1359×1939, so use 56139.

### 3.2 Notes per work

**Rights.** See the host rights language at the top of this document. For the LoC travel posters marked "Rights status not evaluated", the reason they are free to use is the publication date: a work published in 1930 or earlier is public domain in the US as of 2026 (95 years from publication at most; 1930 works expired on 1 January 2026). This applies to foreign works too, including ones whose US copyright was restored under the URAA.

**T1. Rome Express (LoC 2006675134)**
- Record: "Rome, par le train de luxe "Rome Express" / Roger Broders, Rome, 1921." Published "Paris : Cornille & Serra, 1921." Lithograph, 108 × 78 cm. Call number POS - FR .B75, no. 18. Reproduction number LC-USZC4-12901.
- Rights: "Rights status not evaluated." It is free to use because it was published in 1921.
- Visible text: "CHEMINS DE FER PARIS-LYON-MÉDITERRANÉE", "ROME", "Par le train de luxe "ROME EXPRESS"", the signature "ROGER BRODERS / ROME 1921" (lower right of the art), and tiny "IMP. CORNILLE & SERRE … 19, Rue du Terrage PARIS". **Brands:** PLM was merged into SNCF in 1938 and is defunct. The Rome Express train no longer runs.
- The art shows the Colosseum through the Arch of Titus, with goats and a shepherd, in ochre and plum colours.
- The scan is a 4×5 colour transparency (the 3g… "cph" series). It shows a KODAK grey scale at the left, KODAK colour patches at the right, and the film edge code "Kodak EPY 7681". The crop keeps the poster sheet with its cream border.

**T2. London, Thou Art the Flower of Cities All (LoC 2022654749)**
- Record: "London : S.C. Allen & Company, Ltd., 4 Lisle St., 1929." Colour lithograph, sheet 74 × 49 cm. LC-DIG-ppmsca-84816. Call number POS - Gt Brit .G68, no. 1.
- Rights: "Rights status not evaluated." It is free to use because it was published in 1929.
- Text: the art credits itself: "THIS MAP was made by Herry Perry to show some of the main thorofares of London, and the manner of folk to be found there. Finished on the five of S. Andrew 1929." Ribbon labels read "MUSIC / MONUMENTS / PAGEANTS / RESTAURANTS / ART / THE STAGE / CITY CHURCHES / LECTURES / VISITS / BUSINESS CALLS / SHOPS / EXHIBITIONS / DANCING / CLUBS". The title is "LONDON THOU·ART·THE·FLOWER OF·CITIES·ALL", then "GREAT WESTERN RAILWAY". The footer reads "G.W.R. PADDINGTON STATION, LONDON, W.2." / "JAMES MILNE, GENERAL MANAGER." / "PRINTED IN ENGLAND BY S.C. ALLEN & COMPANY LTD." Two shields are present: the City of London arms and the arms of the County of London.
- **Brand flag:** the original GWR was nationalised in 1948, but **"Great Western Railway" (GWR) has been a live train-operator brand since 2015** (FirstGroup). The poster is a 1929 historic work, but it shows that name in large type.
- This is a direct flatbed scan with a clean cream sheet and no colour bar. At 7608×12240, resize it to about 3000 px.

**T3. Norway in September (LoC 2008679876)**
- Record: "London : Adams Bros. & Shadlow Ltd., [192-]" (sic; the firm was Adams Bros. & Shardlow). Lithograph, 101 × 63.2 cm. LC-DIG-ppmsca-18920. Call number POS - Gt Brit .L54, no. 1.
- Rights: "Rights status not evaluated." "[192-]" means the 1920s, so it was published in 1929 at the latest and is PD in the US.
- Text: "NORWAY in SEPTEMBER". Signature "Freda Lingstrom" (lower left of the art). Bottom block: "ILLUSTRATED HOLIDAY PROGRAMMES FREE / NORWEGIAN GOVERNMENT RAILWAYS TRAVEL BUREAU / 342 MADISON AVENUE, NEW YORK / WILL BE GLAD TO GIVE INFORMATION · IT HAS NOTHING TO SELL", and a tiny printer line. No logos. The travel bureau is defunct.
- The art shows orange and pink birches over a blue fjord with snow peaks. It is the strongest "decor" design in this set. A khaki border surrounds the art.

**T4. Visit Your Far West National Parks (LoC 2018646001)**
- Record: "Chicago : Newman-Monroe Co., [1920s]." Colour lithograph, sheet 104 × 68 cm. LC-DIG-ds-11688. Call number POS - US .A01, no. 194.
- Rights: **"No known restrictions on publication. Published without copyright notice."** This is the cleanest statement in the set. A US work published without notice in the 1920s entered the public domain at publication.
- Text: "Travel by Train" with a red dot (top right). "visit your Far West National Parks / U.S.A.-CANADA". Tiny lines: "LITHO. U.S.A." (bottom left) and "NEWMAN-MONROE CO. CHICAGO" (bottom right). **No railroad name or logo.** The round yellow drumhead on the car end has no legible lettering at full resolution.
- The art shows a golden peak, pines, a lodge porch, a rider, a torrent, and a green observation train. A direct flatbed scan. It also fits the existing "parks & travel" set.

**T5. Weymouth (LoC 2025163035)**
- Record: "London : Waterlow & Sons Ltd. Lith., [between 1920 and 1930]." Colour lithograph, sheet 102 × 63 cm. LC-DIG-ppmsca-98995. Call number POS - Gt Brit .S464, no. 4.
- Rights: "Rights status not evaluated." **The sheet itself carries the Southern Railway print-order code "Ad. 859 / 2000 / 1929"** (bottom centre, read at full resolution), meaning advert 859, 2,000 copies, 1929. So it was published in 1929, and LoC's own latest date is 1930. Either way it is PD in the US.
- Text: "WEYMOUTH" (big, in blue on a red-white band), the signature "KENNETH D SHOESMITH" (lower left), and "Free Guide from Town Clerk, Weymouth, Dorset. / Express Trains and Holiday Fares by SOUTHERN RAILWAY." Footer: "SOUTHERN RAILWAY ADVERTISING" (left), "Ad. 859 / 2000 / 1929" (centre) and "·WATERLOW & SONS LTD·LITH·LONDON·DUNSTABLE & WATFORD·" (right).
- **Brand flag:** the Southern Railway was nationalised in 1948. A different present-day operator is branded "Southern" (Govia), so the names are similar, not the same.
- The art shows a harbour with steamers, sailboats and Union flags, framed by dark tree trunks, under a lilac sky.

**T6. Trans-Canada Limited (LoC 2018648019)**
- Record: "[Montreal] : [Canadian Pacific], 1924." Colour lithograph, sheet 92 × 61 cm. LC-DIG-ds-12236. Call number POS - Can .K18, no. 1.
- Rights: "Rights status not evaluated." It is free to use because it was published in 1924.
- Text: "TRANS-CANADA LIMITED / FASTEST TRAIN ACROSS THE CONTINENT / SLEEPING CARS ONLY / CANADIAN PACIFIC". Signature "G.Y. Kauffman" (lower left). The observation car carries a small round CP crest and lettering.
- **Brand flag:** **Canadian Pacific is still a live company** (now CPKC), and its name runs across the bottom in big type. It is historic, but it is a current corporate name.
- The master is very large (10476×15324, 15 MB JPEG). The LoC IIIF server returned **HTTP 503 twice** before it delivered the file (see §3.4).

**T7. Polish State Railways: Old Wooden Church (LoC 00650659)**
- Record: "Chemins de fer de l'Etat Polonais / S. Norblin." "Varsovie - Pologne : Zakł. Graf. E. i Dr. K. Koziańskich, [ca. 1924]." Chromolithograph, 100 × 63 cm. Notes: "Promotional goal: Poland. E3. 1924." LC-USZC4-7131.
- Rights: "Rights status not evaluated." The date is given as "ca. 1924". Norblin's Polish railway posters are generally dated to the mid-1920s, but I did not find a second source for this exact sheet. **Treat the date as likely, not proven.**
- Text: "CHEMINS DE FER DE L'ETAT POLONAIS / POLSKA-GÓRNY ŚLĄSK · STARY KOŚCIÓŁ DREWNIANY / POLOGNE-HAUTE SILÉSIE · UNE ANTIQUE ÉGLISE EN BOIS / POLAND-UPPER SILESIA · OLD WOODEN CHURCH / POLEN-OBERSCHLESIEN · ALTE HOLZKIRCHE". Signature "S. NORBLIN" (lower left). Printer line at the bottom. **Brand:** Polish State Railways still operates as PKP, but the poster uses only the generic French name, with no logo.
- The scan is a colour transparency of the poster on a light table. The poster fills only the centre of the frame, so **the crop is required**, and it leaves about 1876×3012 px. The gold sky has a slight glare. It is the weakest scan of the seven.

**J1. Yoshida Hiroshi, Evening on the Chikugo River (Cleveland 1930.95)**
- API (https://openaccess-api.clevelandart.org/api/artworks/1930.95): `share_license_status: "CC0"`, `creation_date: "1927"`. Woodblock print, sheet 27.6 × 41.1 cm. Inscriptions: "Signature: Yoshida / Artist Seal: Hiroshi / Engraver: Yoshida (jizuri stamp at upper right)".
- **Why it is PD:** it was published in 1927. The left margin is dated 昭和二年作 ("made in Shōwa 2" = 1927). The accession number 1930.95 shows that the museum owned this impression by 1930, so **this is a first-period print, not a later restrike.** Yoshida died in 1950.
- Margin text (outside the crop): 自摺 (*jizuri*, "self-printed") in red, top left; 昭和二年作 (made 1927); and 日田筑後川の夕 ("Evening on the Chikugo River, Hita"). Inside the art: the brush signature "Yoshida" and a red seal "博" (Hiroshi), lower right.
- The scene is dusk on a river, with lit windows, a bridge with lamp reflections, and dark willow silhouettes. It reads as a real-world "anime sunset".
- Cleveland's *Kagurazaka Street after a Night Rain* (2014.359, 2016.78) is also CC0, but the impressions are dated "after 1929" (earliest 1930, latest 1960). They could be posthumous printings. **Not used.**

**J2. Hiroshige, Plum Garden at Kameido (AIC 26577)**
- API: `is_public_domain: true`, date 1857, accession 1925.3752, Clarence Buckingham Collection. "Color woodblock print; ōban". From *One Hundred Famous Views of Edo*. Van Gogh copied this print in 1887.
- Image: `full/,4000/` gives 2716×4000 measured (source 4211×6202).
- Text: series cartouche 名所江戸百景 (*One Hundred Famous Views of Edo*) and title 亀戸梅屋舗 (*Plum Estate, Kameido*), top right. Signature 廣重画 (Hiroshige ga) in a red cartouche, left. The round date/censor seal (top right, in the margin) and the publisher seal 下谷魚栄 (Uoei of Shitaya, bottom left margin) both fall outside the crop.
- It was not in round 1 or 2. Round 1's *Sudden Shower* is from the same series, so the two pair well.

**J3. Hokusai, Kirifuri Waterfall at Kurokami Mountain (Met 56139)**
- API: `isPublicDomain: true`, ca. 1832, accession JP2924, Henry L. Phillips Collection, Bequest of Henry L. Phillips, 1939. From *A Tour of Waterfalls in Various Provinces*.
- Image: `DP141256.jpg` gives 2716×3844 measured. Met 55019 (`DP141247.jpg`) is the same design at only 1359×1939.
- Text: cartouche 諸國瀧廻り / 下野黒髪山きりふりの滝 (*Tour of Waterfalls / Kirifuri Falls at Mt. Kurokami, Shimotsuke*), top right. Signature 前北斎為一筆 (*zen Hokusai Iitsu hitsu*), the publisher's seal and a censor's seal, bottom right. All of these are part of the print.
- A clean impression with no collector stamps in the image.

**J4. Kuniyoshi, Ghosts of the Taira at Daimotsu Bay (Met 55743)**
- API: `isPublicDomain: true`, 1843–47, accession JP1565, Fletcher Fund, 1929. "Triptych of woodblock-printed books (nishiki-e)". Each sheet is 37.5 × 25.1 cm.
- Image: `DP146823.jpg` gives 3939×1986 measured. A 2:1 panorama, good above a bed or desk.
- Text: the title cartouche, top right. Each of the three sheets has a red-and-black signature cartouche "一勇斎国芳画" (Ichiyūsai Kuniyoshi ga) with the paulownia (kiri) seal, plus small publisher and censor seals at the bottom. Small name labels hang on the warriors. **Two vertical seams** show where the three sheets meet (at about x 0.335 and 0.665).
- The scene shows the ghost army of the Taira rising from a huge indigo wave over Yoshitsune's boat.
- Met 893318 is a second impression (1852), `DP149159.jpg`. Not measured.

**J5. Sekka, Hydrangeas (AIC 127737)**
- API: `is_public_domain: true`, 1909/10, accession 1992.96.12, Mr. and Mrs. Hubert Fischer Fund. "Color woodblock print". From *Momoyogusa* (*A World of Things*), published 1909–10.
- Image: `full/3000,/` gives 3000×2019 measured (source 3534×2378).
- No text. Flat blue, lilac and green Rinpa-style blocks. It reads as a modern graphic print.
- AIC holds 18 *Momoyogusa* plates, all `is_public_domain: true`, sources about 3000×2000. Other candidates: 127733 *Plovers*, 127736 *Moon over Musashino*, 127730 *Flutist Among Cherry Petals*, 117199 *Peonies*, 127738 *Silvered Waves*.

**J6. Sekka, Puppies (Cleveland 1989.85.5)**
- API: `share_license_status: "CC0"`, 1909, "ink and color on paper". The description says: "Kamisaka Sekka made preparatory drawings for his *Flowers of a Hundred Worlds* series on tracing paper with ink and color."
- **This is a preparatory drawing, not the printed plate.** If the drawing counts as unpublished, the US term is life + 70 years. Sekka died in 1942, so that term ended in 2012. Either way it is PD in the US, and Cleveland marks it CC0.
- No text. A loose ink puppy with its mouth open at a snail, a brown puppy peeking over, and black bamboo trunks. It is playful and very "dorm".
- The same Cleveland set (1989.85.1–22) includes *God of Thunder*, *Dancing*, *Flower boat* and others, all CC0 at 3400×2385. The printed volumes are 1988.23.x.

**J7. Ohara Koson, Dancing Fox (Cleveland 2016.546)**
- API: `share_license_status: "CC0"`, `creation_date: "1900–1910s"` (earliest 1900, latest 1919). "Color woodcut". Inscription: "Signed and sealed by the artist".
- PD by date: it was published by 1919 at the latest. Koson died in 1945.
- Text: the signature 古邨 (Koson) and a red seal, right of the fox, inside the art. A fox dances on its hind legs under a lotus leaf on a grey ground with grasses.
- The file is 1773×3400, which is narrow (about 1:2). It suits a tall frame. AIC's many Koson bird prints (1926–1930) are all `is_public_domain: false`.

### 3.3 Rejected or could not verify

- **Kawase Hasui: none are usable.** AIC marks all ~40 of its Hasui prints (1919–1949) `is_public_domain: false`. Cleveland marks its 7 Hasui "Copyrighted". The Met's 39587 is `isPublicDomain: false`. The Rijksmuseum's Linked Art records (for example RP-P-1990-147, 1924) carry `rightsstatements.org/vocab/InC/1.0/` ("In Copyright") on the images. **Cooper Hewitt (Smithsonian, CC0) has three Hasui prints, but its dates are wrong.** *Saishoin Temple at Hirosaki* (1960-68-2) is catalogued "ca. 1920", but its margin reads 丁丑作 (made in the year *hinoto-ushi* = **1937**). *Zaimoku Island at Matsushima* (1960-68-3) is catalogued "May 8, 1920", but its margin reads 昭和八年五月作 (made **Shōwa 8 [1933], May**). *Snow at Nezu Gongen* (1960-68-1, "ca. 1920") has no date on the sheet, so I could not confirm it. Works published in 1933 and 1937 are still under US copyright (restored under the URAA, 95 years from publication), whatever CC0 label is attached. Do not use them.
- **Yoshida Hiroshi, other prints:** AIC marks all of them `false`, including the 1926–1930 ones. The Met's 55726 is `false`. Cleveland's *Kagurazaka* impressions are dated 1930–1960 (see J1). Cleveland's *Waterfall* (106780, 1924) is CC0 but only 1169×3400.
- **Hashiguchi Goyō and Itō Shinsui:** every AIC record is `is_public_domain: false`. Cleveland has none.
- **Superbagnères-Luchon, Sports d'hiver** (Cappiello, 1929, LoC 96508677): "**Publication may be restricted.**" It was the only ski poster found. Rejected.
- **Paris–Havre–New York** (Albert Sébille, LoC 2006675152): LoC dates it "[between 1920 and 1930]". But the locomotive is numbered "241-006 ETAT", and as far as I know the État 241 "Mountain" class entered service in about 1932. **The poster is probably post-1930.** I could not confirm that against a primary source, so it is out. It also needs a KODAK-bar crop (0.152, 0.072, 0.676, 0.840).
- **Delft, via Harwich and Hook of Holland** (LNER, LoC 2009632686): "[between 1923 and 1948]", so the date may be too late.
- **AIC London Underground and UK posters** (Spradbery 1924, Paine 1922, Brown 1922, Kauffer): all `is_public_domain: false`.
- **The Met's travel and railway posters** (Kauffer, Wynne 1921/1924, Steinlen *Chemins de Fer de l'Ouest*): all `isPublicDomain: false`.
- **Smithsonian NMAH travel posters** (*Marseille* 1922, *Aix les Bains* 1920, *La Route des Alpes*, *Chemin de Fer d'Orléans*): the records have no CC0 image media. Cleveland has no travel posters.
- **Margate, Bath, Napoli-Palermo, Montserrat** (LoC): their records exist, but I did not download or measure them. Margate and Bath are 1926 GWR/SR posters split over two transparencies ("left"/"right"). Each is a half-poster scan, so skip them.

### 3.4 Fetching notes (new versus poster-sources.md)

- **LoC search and item JSON reject Python's default User-Agent (HTTP 403).** curl's default UA works. Send `User-Agent: curl/8.x` or a project UA.
- **LoC IIIF masters still refuse scaled sizes.** Today `full/,3000`, `full/!3000,3000` and `pct:25` returned HTTP 500 or 400. So `full/full` is the only option, as round 2 found. The Trans-Canada master (10476×15324) returned **HTTP 503 after about 45 s on two of four tries**. The 85 KB error body is HTML, so check the content type and the `FF D9` ending, and retry. The other nine masters arrived in 0.6–33 s.
- **LoC item JSON `resources[].files` often lists no master**, even when one exists. Seven of eight items listed none, but the IIIF `master:` path still served them. Probe `https://tile.loc.gov/image-services/iiif/master:pnp:<path>u/info.json` directly. Build the path from the 150 px thumbnail URL in `resources[].image`.
- **LoC "cph/3g…" masters are colour transparencies.** They contain KODAK grey and colour bars plus film-edge text ("Kodak EPY 7681"). Sometimes the poster fills only part of the frame (Polish rail: about 49% × 64%). The "ds/" and "ppmsca/" masters are direct flatbed scans at 7500–10500 px wide.
- **Cleveland** serves `…_print.jpg` (3400 px long side) and `…_full.tif` (full size) on `openaccess-cdn.clevelandart.org` with no UA rules. Search with `q=`. The `cc0=1` filter combined with `q=` returned nothing, so filter on `share_license_status` in the results instead.
- **Smithsonian Open Access** API (`api.si.edu/openaccess/api/v1.0/search`, `api_key=DEMO_KEY`) worked for 4 calls and then stopped returning a `response` object (rate limit). `ids.si.edu/ids/deliveryService?id=<id>` gives a 4000 px JPEG with no key. www.si.edu object pages return 403 to curl.
- **Rijksmuseum** `data.rijksmuseum.nl/search/collection?creator=…` returns Linked Art JSON with no key. The image rights are in the linked VisualItem (`rightsstatements.org/vocab/InC/1.0/` vs CC0). The object-level CC0 covers the metadata only.
- **Museum dates can be wrong.** Read the margin inscriptions on shin-hanga yourself. Cooper Hewitt dated two prints 13 and 17 years too early.

---

## 4. Nature & science prints (group 3) and US government posters (group 5)

### 4.1 Picks

| # | Title | Artist | Published | Host + object page | Direct image URL | px (measured) | Orientation / ratio | Collection fit | Text in art? | Crop (l, t, w, h) |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Jellyfish (Discomedusae, Plate 8) | Ernst Haeckel (lithograph by Adolf Giltsch) | 1904 | LoC https://www.loc.gov/item/2014645034/ | `…/iiif/master:pnp:ds:05300:05316u/full/full/0/default.jpg` | 6284×8632 | portrait; crop ≈ 5:7 (0.715) | nature & science (new) | Only outside the crop: header and German caption. Tiny figure numbers sit inside the frame. | 0.100, 0.108, 0.752, 0.766 → 4726×6612 |
| C2 | Mushrooms (Basimycetes, Plate 63) | Ernst Haeckel / Adolf Giltsch | 1904 | LoC https://www.loc.gov/item/2015648945/ | `…/iiif/master:pnp:ds:07500:07595u/full/full/0/default.jpg` | 6295×8540 | portrait; crop 0.71 | nature & science | Only outside the crop | 0.080, 0.108, 0.740, 0.768 → 4658×6559 (the black panel only) |
| C3 | Pompon Rose | Pierre-Joseph Redouté (engraved by Langlois) | *Les Roses*, 1817–24 | Cleveland https://clevelandart.org/art/1943.142 | `https://openaccess-cdn.clevelandart.org/1943.142/1943.142_print.jpg` | 2573×3400 | portrait; ≈ 3:4 (0.757) | nature & science | Yes: a script Latin/French caption plus small credit lines at the bottom | Keep the caption: 0.02, 0.02, 0.96, 0.96 → 2470×3264. Drop the caption: 0.02, 0.02, 0.96, 0.84 |
| C4 | Turban Lily | Redouté (engraved by de Gouy) | *Les Liliacées*, 1802–16 | Cleveland https://clevelandart.org/art/2020.164 | `https://openaccess-cdn.clevelandart.org/2020.164/2020.164_print.jpg` | 2336×3400 | portrait; ≈ 2:3 (0.648) | nature & science | Yes: caption, credit lines, and a "7" at top right | Keep the caption: 0.045, 0.02, 0.915, 0.97 → 2137×3298. Drop the caption: 0.045, 0.02, 0.915, 0.87 |
| C5 | Florida Jays (Plate 87) | Robert Havell after John James Audubon | 1830 | AIC https://www.artic.edu/artworks/18878 | `https://www.artic.edu/iiif/2/bf44e53f-9df4-3246-8acd-3af23625396a/full/,3000/0/default.jpg` | 2029×3000 (the full source size) | portrait; crop 0.72 | nature & science | Yes: small engraved plate text (see notes) | 0.10, 0.185, 0.84, 0.79 → 1704×2370 |
| C6 | Copernican Planisphere | Andreas Cellarius (published by Valk & Schenk) | 1708 (Harmonia Macrocosmica) | LoC https://www.loc.gov/item/2011589506/ (plate: https://www.loc.gov/resource/g3190m.gct00305/?sp=6) | `…gct00305:ca000006/full/4000,/0/default.jpg` | 4000×3519 (source 8738×7688) | landscape; crop 1.18 | nature & science (celestial) | Yes: an engraved Latin title cartouche (top corners) and zodiac names | 0.06, 0.06, 0.875, 0.845 → 3500×2974 |
| C7 | Moon Map (Tabula Selenographica) | J. G. Doppelmayr (published by J. B. Homann, Nuremberg) | early 1700s; bound in LoC's 1708 atlas | LoC, same atlas, plate https://www.loc.gov/resource/g3190m.gct00305/?sp=23 | `…gct00305:ca000023/full/4000,/0/default.jpg` | 4000×3418 (source 8976×7672) | landscape; crop 1.54 | nature & science (celestial) | Yes: an engraved title banner and crater names | 0.005, 0.005, 0.96, 0.73 → 3840×2495 (removes the Latin text block) |
| C8 | Torus Colony Interior | Don Davis for NASA Ames | 1975 | NASA https://images.nasa.gov/details/ARC-1975-AC75-2621 | `https://images-assets.nasa.gov/image/ARC-1975-AC75-2621/ARC-1975-AC75-2621~orig.jpg` | 3393×2604 | landscape; 1.30 | space | No. Signature only: "DON DAVIS 11-25-75", lower left | none (full-bleed) |
| C9 | Cylinder Colony, Clouds and Eclipse | Don Davis for NASA Ames | 1975 | NASA https://images.nasa.gov/details/ARC-1975-AC75-1920 | `https://images-assets.nasa.gov/image/ARC-1975-AC75-1920/ARC-1975-AC75-1920~orig.jpg` | 2476×3427 | portrait; 0.72 | space | No. Signature "DONALD E. DAVIS", lower right | none (full-bleed) |
| C10 | Building the Torus | Don Davis for NASA Ames | 1975 | NASA https://images.nasa.gov/details/ARC-1975-AC75-1886 | `https://images-assets.nasa.gov/image/ARC-1975-AC75-1886/ARC-1975-AC75-1886~orig.jpg` | 3460×2603 | landscape; 1.33 | space | No. Signature "DON DAVIS 8-75", lower right | none (full-bleed) |
| C11 | Visit the Zoo (herons) | WPA Federal Art Project, Pennsylvania (artist not named) | [1936–41] | LoC https://www.loc.gov/item/92500639/ | `…/iiif/master:pnp:ds:08200:08248u/full/full/0/default.jpg` | 6008×7776 | portrait; crop 0.77 | parks & travel, or a new "WPA modern" collection | Yes: "VISIT THE ZOO" and "Federal Art Project, W. P. A. Pennsylvania" | 0.015, 0.016, 0.965, 0.970 → 5798×7543 (trims the dark scan edge) |
| C12 | The Drama of the Heavens | "Beard", WPA Federal Art Project, Chicago | [1939] | LoC https://www.loc.gov/item/98508993/ | `…/iiif/master:pnp:cph:3b40000:3b48000:3b48700:3b48791u/full/full/0/default.jpg` | 2951×4360 | portrait; crop 0.62 | space | Yes: see notes | 0.118, 0.103, 0.790, 0.862 → 2331×3758 (removes the slide surround, grey scale and colour bar) |
| C13 | Visit the Aquarium (jellyfish) | Hugh Stevenson, WPA Federal Art Project, Pennsylvania | [1936 or 1937] | LoC https://www.loc.gov/item/98518437/ | `…/iiif/master:pnp:cph:3f00000:3f05000:3f05600:3f05602u/full/full/0/default.jpg` | 2749×4096 | portrait; crop 0.774 (≈ 3:4) | parks & travel, or "WPA modern" | Yes: "VISIT THE AQUARIUM" and "W P A FEDERAL ART PROJECT PENNSYLVANIA" | 0.100, 0.134, 0.812, 0.704 → ≈2232×2884 (removes the cream mat and slide surround) |

**C11 path check:** the master is `ds:08200:08248u`. The neighbouring `ds:08200:08249u` is Round 1's *Welcome to Montana*, so don't mix them up.

### 4.2 Notes per work

**Haeckel, *Kunstformen der Natur* (C1, C2). Rights: LoC.**
- Both records give `created_published` "Leipzig und Wien, Verlag des Bibliographischen Instituts, 1904" and `rights_advisory` "No known restrictions on publication." (https://www.loc.gov/item/2014645034/?fo=json, https://www.loc.gov/item/2015648945/?fo=json). They were published in 1904, so they are PD in the US. Contributors: "Giltsch, Adolf, 1852-1911, lithographer; Haeckel, Ernst, 1834-1919, artist". Call number "Illus. in QH46.H18 (Case Y)".
- C1 notes: "Lithograph by Adolf Giltsch after sketch by Ernst Haeckel." C2 notes: "Photomechanical print of lithograph by Adolf Giltsch after sketch by Ernst Haeckel."
- Each scan is the open book page. It has a cream page margin, a book edge, and a dark background strip.
  - Header, outside the crop: "Haeckel, Kunstformen der Natur." and "Tafel 8 — Desmonema." (C1) or "Tafel 63 — Dictyophora." (C2).
  - Caption, outside the crop: "Discomedusae. — Scheibenquallen." / "Basimycetes. — Schwammpilze."
  - C1 keeps only the inside of the thin frame line. Small figure numbers (1–4) are printed inside the frame and stay.
  - C2 keeps only the black panel. Its figure numbers sit in the margin, outside the crop.
- C1 is the famous *Desmonema* jellyfish plate. C2 is a stinkhorn/veil-fungus plate on black, which suits the current mushroom-decor trend.
- **Alternates (same series, verified the same way, same rights):**
  - Hummingbirds (Trochilidae, Tafel 99): https://www.loc.gov/item/2015648985/, `…/iiif/master:pnp:ds:07600:07627u/full/full/0/default.jpg`, 6124×8472. Crop 0.095, 0.108, 0.757, 0.770.
  - Sea anemones (Actiniae, Tafel 49): https://www.loc.gov/item/2014645036/, `…:ds:05300:05318u`, 6220×8632. Crop 0.101, 0.115, 0.734, 0.747.
  - Orchids (Orchideae): https://www.loc.gov/item/2015648955/, master `ds:07600:07605u`, 6188×8504. Not cropped or measured beyond info.json.
  - Pitcher plants (Nepenthaceae): master `ds:07500:07594u`, 6267×8534. Not cropped or measured beyond info.json.
  - Other jellyfish plates: `ds:05300:05317u` (taupe), `ds:05300:05325u` (green), `ds:07500:07555u` (pale blue), `ds:07600:07618u` (green).
  - LoC holds about 100 plates. List them with `https://www.loc.gov/photos/?q=haeckel+kunstformen&fo=json`.

**Redouté (C3, C4). Rights: Cleveland Museum of Art.**
- The API (`https://openaccess-api.clevelandart.org/api/artworks/122880` and `/380082`) returns `share_license_status: "CC0"`.
- CMA's page: "High-resolution images and data related to the CMA's collection are made available under a Creative Commons Zero (CC0) designation … content that the CMA publishes digitally, free of charge, and without copyright and licensing restrictions." Also: "Works designated as Creative Commons (CC0) do not require attribution or citation." (https://www.clevelandart.org/open-access)
- C3: accession 1943.142, "stipple and line engraving, with hand coloring", dated 1817–24. The rose occupies the middle; the caption sits below it.
  - Visible text: "Rosa Pomponia Burgundiaca / Le Pompon de Bourgogne" and "P. J. Redouté pinx. / Imprimerie de Rémond / Langlois sculp."
  - No stamps.
- C4: accession 2020.164, "Lillium Pomponium (Turban Lily), plate 7 from Les Liliacées", "stipple engraving with hand coloring", dated 1802–16. Creators "De Gouy" and "Pierre-Joseph Redouté".
  - The scan shows the sheet on a grey ground.
  - Text: "Lillium Pomponium / Lys Pompon", engraver and publisher lines, and the plate number "7" at top right.
- Both are far older than 1931.
- Cleveland's `_print.jpg` is about 3400 px on the long side. The CC0 full TIFFs are larger: `https://openaccess-cdn.clevelandart.org/1943.142/1943.142_full.tif` is 4367×5770, and `…/2020.164/2020.164_full.tif` is 8515×12395 (sizes from the API, not downloaded).
- **Alternates (all CMA CC0, measured):**
  - Moss Rose, H. J. Redouté, 1943.141: `…/1943.141/1943.141_print.jpg`, 2587×3400, on a yellowed sheet.
  - Provence Rose, 1943.139: 2512×3400.
  - The Blue Passion-flower, R. J. Thornton, *Temple of Flora*, 1799–1807, 1939.293: `…/1939.293/1939.293_print.jpg`, 2540×3400. A dark, moody botanical with a title line at the bottom.
  - CMA also has about 20 more *Les Roses* plates, Baurenfeind *Mushrooms* (1751, 148288, full 7115×4194), and Holsteyn tulip studies (c. 1645).

**Audubon, *Florida Jay* (C5). Rights: AIC.**
- API `https://api.artic.edu/api/v1/artworks/18878` returns `is_public_domain: true`.
  - artist_display: "Robert Havell (English, 1793-1878) after John James Laforest Audubon (American, 1785-1851)"
  - Date 1830. Accession 1925.1632. "Hand-colored engraving, with aquatint, on ivory wove paper". Gift of Robert Allerton.
- AIC CC0 terms: see poster-sources.md §2.
- Text, all small engraving:
  - "No. 18" at top left of the plate and "PLATE 87" at top right.
  - The caption "Florida Jay … GARRULUS FLORIDANUS …" sits **inside the image area, lower left** (about x 0.25–0.42, y 0.68–0.72 of the full scan). It cannot be cropped out without losing art.
  - Engraver and printer lines at the very bottom of the plate.
- **The source is only 2029×3000** (info.json), so the crop is 1704×2370. That clears 1500 px but not 2000.
- AIC's other open-access Havell plates are smaller birds or similar sizes: Great American Shrike 18876, Harlequin Duck 183041 (3000×2023 landscape), Male Bay-breasted Warbler 18883. The Met's open-access Audubon objects are small birds (918291–918311). I found no flamingo, heron or spoonbill in AIC, the Met or Cleveland open access.

**Cellarius and Doppelmayr (C6, C7). Rights: LoC Geography and Map Division.**
- Item record https://www.loc.gov/item/2011589506/?fo=json:
  - Title "Harmonia macrocosmica, seu, Atlas universalis et novus …"
  - created_published "Amstelodami : Apud Gerardum Valk & Petrum Schenk, 1708."
  - Contributors Cellarius, Andreas; Schenk, Peter; Valck, G.; Loon, J. van. Call number G1000.2 .C4 1708.
  - Note: "In addition to the 29 plates specified in the table of contents, there is an additional plate between plates 4 and 5, an additional plate between plates 19 and 20, and 3 additional plates following plate 29."
- `rights_advisory` is empty. The `rights` field says: "The content of the Library of Congress Geography and Map Division digitized collections is free to use and reuse unless a Rights Advisory statement is present that indicates otherwise. Credit Line: Library of Congress, Geography and Map Division." Published in 1708, so PD.
- C6 shows the Copernican system.
  - Title cartouche: "PLANISPHÆRIUM COPERNICANUM Sive Systema Universi totius creati ex hypothesi Copernicana in plano exhibitum".
  - Imprint: "Prostant Amstelædami apud Gerardum Valk et Petrum Schenk".
  - Seated astronomers in the lower corners.
  - A pencil "4" in the page margin (outside the crop) and a faint **centre gutter fold**, because it is a double-page spread.
  - The crop keeps the plate and its narrow yellow border.
- C7 is the Doppelmayr/Homann "Tabula Selenographica" plate bound into this copy, probably one of the "additional plates".
  - The engraved title reads "TABULA SELENOGRAPHICA in qua Lunarium Macularum exacta Descriptio secundum Nomenclaturam Praestantissimorum Astronomorum tam HEVELII quam RICCIOLI … Ioh. Gabr. Doppelmajero Math. P.P. … opera Ioh. Baptistae Homanni Norimbergae".
  - It shows two lunar hemispheres on pink, with cherubs holding a telescope. A long Latin text block fills the bottom quarter. The crop removes it at y 0.735.
  - A pencil "196" at top right is outside the crop.
  - **Date caveat:** the plate itself is undated. It credits J. B. Homann, who died in 1724, and LoC catalogs the volume as 1708. Either way it is pre-1931.
- **Fetch quirk (new):** on LoC *map* items (`service:gmd:…`, JPEG 2000), scaled IIIF sizes work: `full/4000,/` returned in about 3 s. That is unlike the `master:pnp` TIFFs, where scaled sizes return 500.
- **Alternates in the same atlas:**
  - Colored constellation hemispheres: pages `?sp=27` to `?sp=33`, `…gct00305:ca000027` … `ca000033`, about 8800×7700 each.
  - Cellarius *Planisphaerium Ptolemaicum*: `ca000003`.
  - Tychonic planisphere: `ca000009`.
  - Separately, LoC 2012590167 "Planisphaerii coelestis hemisphaerium meridionale" (c. 1700, `service:gmd:gmd3:g3190:g3190:ct003613`, 7302×6288) and LoC 79693572 Beer & Mädler *Mappa selenographica* (1834, `ct006939`, 12179×12024, but heavily browned and foxed in the thumbnail).

**Don Davis space colonies (C8–C10). Rights: NASA, and the artist's own PD statement.**
- The images.nasa.gov records (center ARC):
  - AC75-2621: "Torus sphere Interior view. Space Colonization. Artist: Don Davis ref: NASA SP-413; Space Settlements: A Design Study", 1975-11-25.
  - AC75-1920: "Interior View of L-5 Torus Sphere Colony. Space Colonization. Artwork by Don Davis", 1975-08-26.
  - AC75-1886: "NASA Artwork By: Don Davis Space Colony: Torus Wheel …", 1975-08-20.
  - `metadata.json` carries no copyright or credit field. Source: https://images-assets.nasa.gov/image/<id>/metadata.json
- **The artist releases these to the public domain.** Don Davis's page "PUBLIC DOMAIN WORKS DONE FOR NASA" (http://www.donaldedavis.com/PARTS/allyours.html) says: "These are some of my works commissioned by various NASA facilities … You paid for them and they're yours. My work on this page only was created in the public domain, elsewhere on my site I claim copyright on the artwork and text."
  - The page lists three colony paintings: `BIGPUB/STANTRUS.jpg` ("This design became known as the 'Stanford Torus'. Oil on board for NASA Ames."), `BIGPUB/STORUS1.jpg` ("The assembly of the 'Stanford Torus' … Oil on board for NASA Ames.") and `BIGPUB/DDcylECL.jpg` ("One of my earliest Space Colony paintings was based on the giant 'Model 3' cylindrical habitats envisioned by Gerard O'Neill … Oil on canvas panel disposition unknown.").
  - I matched these by eye: STANTRUS = C8 (AC75-2621), STORUS1 = C10 (AC75-1886), DDcylECL = C9 (AC75-1920).
  - The NASA Ames statement in round 2 §R2.6 ("Images are not copyrighted. Please credit photos to NASA Ames Research Center.") also applies.
- **Caveat for C9:** the NASA title says "Torus Sphere", but the painting shows Davis's O'Neill *cylinder* (his own description). Use a neutral title.
- None of the three has a logo or text, only the signatures. All three are full-bleed: edge-brightness checks found no border.
- **Alternates (Rick Guidice for NASA Ames; same Ames statement):**
  - ARC-1976-AC76-1089, Bernal sphere seen from outside: 3072×2048, grey mat on all sides, crop about 0.09, 0.05, 0.82, 0.9.
  - ARC-1976-AC76-0525, torus colonies on black: 3204×2210.
  - ARC-1978-AC78-0330-1, lunar base: 3072×2048, grey mat.
  - Guidice, unlike Davis, has published no PD statement of his own. Rely on NASA's.

**WPA (C11–C13). Rights: LoC.**
- All three records give `rights_advisory` "No known restrictions on publication." and the note "Work Projects Administration Poster Collection (Library of Congress)." All were made by the WPA Federal Art Project, so they are US federal works (see poster-sources.md §4).
- C11 (https://www.loc.gov/item/92500639/):
  - "Pennsylvania : Federal Art Project, W.P.A., [between 1936 and 1941]". Woodblock on board. POS - WPA - PA .01 .V585, no. 1.
  - Two herons on a rock, with lettering on a dark band.
  - A clean flatbed scan with only a thin dark edge. No program mark.
- C12 (https://www.loc.gov/item/98508993/):
  - "Chicago, Ill. : WPA Federal Art Project, [1939]", artist "Beard". Silkscreen. Listed in DeNoon, *Posters of the WPA*, no. 164.
  - Text: "THE DRAMA OF THE HEAVENS / ADLER PLANETARIUM / Operated by CHICAGO PARK DISTRICT / PLANETARIUM OPEN DAILY 10 to 5. TUES & FRI. UNTIL 9. SUNDAYS 2 to 5. / MADE BY WPA FEDERAL ART PROJECT CHICAGO, ILL.", plus the signature "BEARD".
  - **Names a real, still-operating institution** (the Adler Planetarium and the Chicago Park District). This is the same kind of issue as the venue names in Round 2's gig posters.
  - The `cph/3b4…` scan is a colour slide. A grey scale on the left and a colour bar on the right are removed by the crop.
  - The poster's lower-right corner is slightly worn.
- C13 (https://www.loc.gov/item/98518437/):
  - "Pennsylvania : WPA Federal Art Project, [1936 or 1937]". Notes: "Poster designed by Hugh Stevenson, Philadelphia." and "Date stamped on verso: Aug 4 1937." Lithograph.
  - Jellyfish on a black ground.
  - The `3f05…` scan is a photo of the poster on a cream mat with a dark surround, which the crop removes.
- **Alternates (LoC WPA, same rights; sizes from info.json):**
  - "Visit the zoo - Philadelphia" (hippo), 94502736: `cph:3b50000:3b51000:3b51400:3b51495u`, 2903×4096.
  - "Visit the aquarium in Fairmount Park" (Robert Muchley, fish), 95514347: `ds:16700:16750u`, **11885×14608**.
  - "Visit the zoo" (penguins, Louise Welsh), 98518441: `cph:3f00000:3f05000:3f05600:3f05606u`, 2773×4096.
  - "Museum of science & industry", 98510059: `3f05194u`, 2819×4096.
  - "A game crop is a community asset", 98516769: `3f05396u`, 2732×4096.
  - Skip, because the masters are too small: the blue elephant "Visit the Zoo" (94502738, 1187×1536) and Brookfield Zoo "Information" (96501239, 1175×1472).

### 4.3 Rejected or could not verify
- **Biodiversity Heritage Library:** www.biodiversitylibrary.org returned a Cloudflare 403 challenge to curl on search and bibliography pages. `api3` returned 401 (it needs a key), and `/pageimage/<id>` returned 302. I did not get a BHL plate through. LoC has the same Haeckel plates.
- **Smithsonian Open Access:** `api.si.edu` with `DEMO_KEY` returned `OVER_RATE_LIMIT` on the first call. Not searched.
- **Iconic Audubon plates** (American Flamingo, Great Blue Heron, Roseate Spoonbill): not found in AIC, Met or CMA open access. The Met's "Carolina Parrot" hits are 1888 Allen & Ginter cigarette cards (406681, 421801), not Audubon. The National Gallery of Art has CC0 Audubon plates, but it is not on the allowed host list.
- **Besler, *Hortus Eystettensis*:** no hits in AIC or CMA. Not searched further.
- **Cleveland's Audubon *Peregrine Falcons*** (1964.351) is an oil painting, CC0, 5000×3529. It is usable, but it is not a *Birds of America* plate. I used the AIC engraving instead.
- **USFWS and NPS:** not searched this round, for lack of time.
- **Don Davis's Galileo, Pioneer and Venus paintings for Ames:** not considered. They are mission illustrations, not decor. The K-T impact painting is on his PD page, but it was not checked.

### 4.4 Fetching notes (new versus poster-sources.md)
- **LoC map items take scaled IIIF.** `https://tile.loc.gov/image-services/iiif/service:gmd:…/full/4000,/0/default.jpg` and `full/!800,800/` both worked fast on `gmd` JPEG 2000s. The `master:pnp` rule from poster-sources.md §1 (download `full/full` only) still applies to prints and photographs.
- **The LoC 1024-px reference JPEG is at `https://tile.loc.gov/storage-services/service/pnp/<path>/<id>v.jpg`.** It is handy for contact sheets before you pull a 5–8 MB master.
- **LoC item JSON was flaky again.** About 1 in 3 `?fo=json&at=item` calls came back truncated (an unterminated string). Retry with a JSON-parse check. The `at=item.title` sub-field selector returned nothing, so request `at=item`.
- **The Haeckel `ds/` masters downloaded on the first try** (`full/full`, 4.8–7.8 MB, all ended in `FF D9`).
- **`images-api.nasa.gov/asset/<id>` does not list `metadata.json`**, but `https://images-assets.nasa.gov/image/<id>/metadata.json` exists. Its rights-relevant field is `AVAIL:Description`; there is no copyright field.
- **The Cleveland `_print.jpg` CDN worked with plain curl**, 2.2–6.7 MB.
- **Shell gotcha:** in zsh, a loop variable named `path` overwrites `$PATH`, and every command after it fails with "command not found".

---

## 5. Not found or not verified (all groups)

- **Hosts that blocked or were not reachable:** Biodiversity Heritage Library (Cloudflare 403 to curl; API needs a key), Smithsonian Open Access (`DEMO_KEY` rate-limited at once), NYPL (bot wall, as in round 2), The Met API (Incapsula block after a burst of parallel lookups, so no Met Art Nouveau items were checked). Rijksmuseum was reachable but gave no picks.
- **Searched for and not found under the rights bar:** any Kawase Hasui print (all marked in copyright, or CC0 with wrong dates; §3.3); other early Yoshida, Goyō and Shinsui; a ski poster (the one found, Superbagnères 1929, is "Publication may be restricted"); an ocean-liner poster; Besler; iconic Audubon plates (flamingo, heron, spoonbill); CC0 sheet-music covers; New Yorker covers 1925–1930; Malevich, Delaunay, af Klint.
- **Not searched for lack of time:** US Fish & Wildlife Service and further NPS posters; LoC Historic Sheet Music in depth; Margate, Bath, Napoli-Palermo and Montserrat travel posters at LoC.
- **Facts I could not confirm from a second source:** T7's "ca. 1924" date; A9's publication in a 1923 portfolio; that Paris–Havre–New York (rejected) is post-1930 (based on recall of the locomotive class, not a source); the match between Don Davis's PD page images and the three NASA IDs (matched by eye).
