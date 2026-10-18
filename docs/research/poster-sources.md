# Poster Sources: Public-Domain Art, NASA/JPL, WPA, and fal FLUX

Researched 2026-10-17 for issue #85. Every fact below comes from a first-party API, page, or image file. "Measured" means I downloaded the file today and read its pixel size with `sips`. The project rule is: a public-domain poster must be published or created before 1929, or be a US federal government work. The allowed sources are AIC (CC0), The Met Open Access (CC0), the Library of Congress, and NASA/JPL.

---

## Picks

| Slot | Title | Artist | Date | Source page | Direct image URL | px (measured) | Status |
|---|---|---|---|---|---|---|---|
| Museum 1 | Under the Wave off Kanagawa (The Great Wave) | Katsushika Hokusai | 1830/33 | https://www.artic.edu/artworks/77333 | `https://www.artic.edu/iiif/2/05cd1ba7-67d1-96c5-0e78-2eb4114b65e7/full/3000,/0/default.jpg` | 3000×2076 (source 10169×7036) | AIC `is_public_domain: true` (CC0), pre-1929 |
| Museum 2 | The Bedroom | Vincent van Gogh | 1889 | https://www.artic.edu/artworks/28560 | `https://www.artic.edu/iiif/2/6644829f-f292-c5c4-a73c-0356a6fdbf0d/full/3000,/0/default.jpg` | 3000×2348 (source 12614×9875) | AIC CC0, pre-1929 |
| Museum 3 | Water Lilies | Claude Monet | 1906 | https://www.artic.edu/artworks/16568 | `https://www.artic.edu/iiif/2/3c27b499-af56-f0d5-93b5-a7f2f1ad5813/full/3000,/0/default.jpg` | 3000×2881 (source 8808×8460) | AIC CC0, pre-1929 |
| Museum 4 | A Sunday on La Grande Jatte — 1884 | Georges Seurat | 1884–86, border 1888–89 | https://www.artic.edu/artworks/27992 | `https://www.artic.edu/iiif/2/2d484387-2509-5e8e-2c43-22f9981972eb/full/3000,/0/default.jpg` | 3000×2009 (source 9310×6237) | AIC CC0, pre-1929 |
| Museum 5 | Mäda Primavesi (1903–2000) | Gustav Klimt | 1912–13 | https://www.metmuseum.org/art/collection/search/436819 | `https://images.metmuseum.org/CRDImages/ep/original/DP243354.jpg` | 2876×3877 | Met `isPublicDomain: true` (CC0), pre-1929 |
| Museum 6 | Zodiaque ("La Plume") | Alphonse Marie Mucha | 1896–97 | https://www.artic.edu/artworks/111986 | `https://www.artic.edu/iiif/2/119dba14-acf2-cdcd-e9e6-b9cd38bc3aad/full/2235,/0/default.jpg` | 2235×3000 (this is the full source size) | AIC CC0, pre-1929. **Has the text "LA PLUME" (a magazine title)**, see below |
| Space 1 | The Grand Tour | JPL "The Studio" | gallery dated Dec. 24, 2020 | https://www.jpl.nasa.gov/galleries/visions-of-the-future | `https://d2pn8kiwq2w21t.cloudfront.net/original_images/grand_tour.jpg` | 2607×3886 | **Not public domain.** Free use under the JPL Image Use Policy, with the credit "NASA/JPL-Caltech" |
| Space 2 | Mars | JPL "The Studio" | same | same | `https://d2pn8kiwq2w21t.cloudfront.net/original_images/mars.jpg` | 2607×3887 | Same as Space 1 |
| Space 3 | Enceladus | JPL "The Studio" | same | same | `https://d2pn8kiwq2w21t.cloudfront.net/original_images/enceladus.jpg` | 2098×3130 | Same as Space 1 |
| Parks 1 | See America (natural arches, riders) | Frank S. Nicholson | between 1936 and 1939 | https://www.loc.gov/item/93505613/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ppmscd:03700:03760u/full/full/0/default.jpg` | 9248×11552 | LoC "No known restrictions on publication." WPA Federal Art Project (federal work) |
| Parks 2 | See America. Welcome to Montana | Martin Weitzman | between 1936 and 1939 | https://www.loc.gov/item/96503136/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ds:08200:08249u/full/full/0/default.jpg` | 6872×8632 | Same (WPA FAP) |
| Parks 3 | The National Parks Preserve Wild Life | J. Hirt | between 1936 and 1939 | https://www.loc.gov/item/98518597/ | `https://tile.loc.gov/image-services/iiif/master:pnp:ppmsca:23000:23061u/full/full/0/default.jpg` | 6734×8534 | Same (WPA FAP) |

FLUX recommendation (details in §5): **`blackforestlabs/flux-3/text-to-image`** (FLUX 3 Image) with `resolution: "2k"` or `"4k"` and `aspect_ratio: "2:3"` or `"3:4"`. It costs $0.048 per megapixel. The catch is that it has **no `seed` and no 11:17 ratio**. When you need exact pixel sizes or a seed, use **`fal-ai/flux-2-max`** instead: it accepts custom width and height up to 2560 px per side and 4,194,304 px in total, for example 1664×2496 at 2:3.

---

## 1. Fetching notes (read before writing the script)

- **AIC blocks Node's default User-Agent.** A plain `fetch()` from Node 26 got **HTTP 403 (Cloudflare)** from `www.artic.edu/iiif/...`. The same URL with curl's UA or `User-Agent: mise-poster/1.0` returned 200. A UA string that contained an email address in parentheses also got 403. So set a short custom `User-Agent`. AIC also asks for an `AIC-User-Agent: <project> (<contact>)` header "as a matter of courtesy" (https://api.artic.edu/docs/). Met, LoC, and the JPL CloudFront all returned 200 to Node's default `fetch`.
- **AIC image sizes.** The docs recommend `/full/843,/0/default.jpg`. They also say: "If you are accessing public domain images, you may also use the following pattern for larger images: `.../full/1686,/0/default.jpg` However, we still recommend using 843 instead unless there's a clear need for 1686." (https://api.artic.edu/docs/#iiif-image-api). In practice (measured), PD images were served at `3000,`, `4000,`, `4500,`, `5000,`, `8000,`, and the full source width (`12614,` for The Bedroom, a 46 MB file). `full/full` and `full/max` returned 403. Oddly, `6000,` returned a **3000-wide** image on three different works. An uncached `6001,` request on The Bedroom returned **HTTP 502** after about a minute. `,4000` on the Hiroshige gave 2740×4000. `pct:50` worked, `pct:100` returned 403. `info.json` advertises `maxArea: 124563250`. **Use `full/3000,/`** (or `full/,3000/` for portrait works). It is reliable and clears 2000 px. Never ask for more than the source width: the Mucha sources are only 3000 px on the long side.
- **The Met search endpoint changed.** `/public/collection/v1/search` now returns **410 Gone**: "retired on 2026-10-01 … use /public/collection/v1.1/search, which is Elastic-backed and paginated via offset and limit". The `/v1/objects/<id>` endpoint is unchanged and still returns `isPublicDomain` and `primaryImage` (https://metmuseum.github.io/).
- **LoC JPEGs are small. The full-size file is the master.** The item JSON's `resources[].files` list JPEGs only up to 1024 px on the long side (`…v.jpg`). The full-size file is the master TIFF (`…u.tif`): 172–320 MB for these picks. The LoC IIIF server renders the master as a JPEG at `https://tile.loc.gov/image-services/iiif/master:pnp:<path with colons>u/full/full/0/default.jpg`. Measured: 9248×11552 in 4.4 MB, 34 s uncached and 0.2 s once cached. **Scaled IIIF sizes on the masters (`3000,`, `pct:25`, `!3000,3000`) returned HTTP 500**, so download `full/full` and resize locally (the repo already depends on `sharp`). Two candidates had no master at all, only 1024-px JPEGs: Yellowstone 2007676133 and Grand Canyon 2007676131. Avoid them.

---

## 2. Museum works (AIC / Met)

**Rights language.** AIC: "free, unrestricted use of over 50,000 images of works in the collection believed to be in the public domain … made available under Creative Commons Zero (CC0) designation … You are welcome to use any images with the label 'CC0 Public Domain Designation' for any purpose, including commercial and noncommercial uses" (https://www.artic.edu/image-licensing). The API flag is `is_public_domain`. AIC asks for the caption "Artist. Title, Date. The Art Institute of Chicago." The Met: "To the extent possible under law, The Metropolitan Museum of Art has waived all copyright and related or neighboring rights to this dataset using the Creative Commons Zero license", and `isPublicDomain` "When 'true' indicates an artwork in the Public Domain" (https://metmuseum.github.io/). The Met's own policy pages (metmuseum.org/hubs/open-access) were behind a bot wall, so this quote comes from the API docs.

Every pick below is `is_public_domain: true` / `isPublicDomain: true` in the live API, and every one was made before 1929.

### 2.1 Hokusai, *Under the Wave off Kanagawa*
- **Pick: AIC 77333.** Accession 1952.343, Clarence Buckingham Collection. API: `https://api.artic.edu/api/v1/artworks/77333`. Image id `05cd1ba7-67d1-96c5-0e78-2eb4114b65e7`, source 10169×7036. It has the highest resolution of the impressions I checked. Pink-tinted sky. Only text: the Japanese title cartouche and signature, top left.
- Alt A: **Met 45434** (ca. 1830–32, H. O. Havemeyer Collection). `https://images.metmuseum.org/CRDImages/as/original/DP130155.jpg`, 3859×2594 measured. Cleaner, cream-colored sky. Object page https://www.metmuseum.org/art/collection/search/45434.
- Alt B: AIC 24645 (accession 1925.3245), image `b3974542-b9b4-7568-fc4b-966738f61d78`, source 6679×4577. Or Met 36491 (`DP141063.jpg`, 3863×2667).
- Landscape (about 3:2). A portrait poster needs a crop or a mat.

### 2.2 Van Gogh, *The Bedroom*
- **Pick: AIC 28560**, 1889, accession 1926.417, Helen Birch Bartlett Memorial Collection. Image `6644829f-f292-c5c4-a73c-0356a6fdbf0d`, source 12614×9875. Landscape.
- Alt: AIC 14586 *The Poet's Garden* (1888, image `d4bc1723-7cbc-d36d-a9cb-f84553f2a6f6`, source 12637×9982). Or AIC 27949 *Madame Roulin Rocking the Cradle* (1889, portrait, `6f3ca8b9-fef6-edfc-a71c-3e7b471d5f6c`, source 8676×10963).

### 2.3 Monet, *Water Lilies*
- **Pick: AIC 16568**, *Water Lilies*, 1906, accession 1933.1157. Image `3c27b499-af56-f0d5-93b5-a7f2f1ad5813`, source 8808×8460 (nearly square). Signature "Claude Monet 1906", bottom right.
- Alt: AIC 97933 *Water Lily Pond* (1917–19, `7a23ad22-2044-6d7d-6315-9b101dadc559`, source 6861×4426, wide). Or AIC 87088 *Water Lily Pond* (1900, `8534685d-1102-e1e3-e194-94f6e925e8b0`, source 5448×4845).

### 2.4 Seurat, *A Sunday on La Grande Jatte — 1884*
- **Pick: AIC 27992**, 1884–86 (border added 1888–89), accession 1926.224. Image `2d484387-2509-5e8e-2c43-22f9981972eb`, source 9310×6237. Landscape.
- Alt: AIC 61616 *Oil Sketch for "A Sunday on La Grande Jatte — 1884"* (1884, `081be15c-8812-c174-eeb2-cf318a2e67cf`, source 7988×4893).

### 2.5 Klimt
- **Pick: Met 436819**, *Mäda Primavesi (1903–2000)*, 1912–13. Gift of André and Clara Mertens, 1964. `primaryImage` = `https://images.metmuseum.org/CRDImages/ep/original/DP243354.jpg`, 2876×3877 measured. Portrait, close to 3:4. Only text: the "GUSTAV KLIMT" signature block, lower right.
- Alt: Met 436820, *Serena Pulitzer Lederer (1867–1943)*, 1899. `https://images.metmuseum.org/CRDImages/ep/original/DP-18885-001.jpg`, 1961×4000 measured (tall and narrow).
- AIC has no CC0 Klimt painting. AIC's PD Klimts are drawings, for example 180671 *Seated Woman from the Front with Hat*, 1910, source 2011×3000. AIC 15199 and 27035 are `is_public_domain: false`.

### 2.6 Mucha, with Hiroshige as a fallback
- **Every Mucha at the Met is `isPublicDomain: false`** (283253, 338261, 346720, 437169, 753533). Use AIC.
- **Pick: AIC 111986, *Zodiaque ("La Plume")*, 1896–97**, accession 1925.844. Image `119dba14-acf2-cdcd-e9e6-b9cd38bc3aad`. The source is **only 2235×3000**, so request `full/2235,/` (measured 2235×3000). That just clears the 2000 px floor. Visible text: "LA PLUME / REVUE BI-MENSUELLE ILLUSTRÉE … 31, Rue Bonaparte, PARIS / SALON DES CENT · BIBLIOTHÈQUE ARTISTIQUE ET LITTÉRAIRE", a full calendar block at the bottom, and the "Mucha" signature. *La Plume* was an 1890s magazine. That is a period title, not a current brand, but the project may still want to crop the header (top ~12%) and the calendar.
- Alt A: AIC 97439, *The Seasons*, 1897. Image `cf64f14a-cc51-9a2d-2d9b-a882b504f222`, 3000×1622 measured (the full source size). Four panels side by side. No text except the signatures. Landscape only: one panel alone would be about 700 px wide, which is too small.
- Avoid: AIC 23078 "Sarah Bernhardt" (c. 1898). It is a faint pencil sketch with collector stamps, not the poster. AIC 182672 is small (2016×1864). AIC 16907 is 798×2250.
- **Hiroshige alternate: AIC 64447, *Sudden Shower over Shin Ohashi Bridge and Atake*, 1857**, accession 1981.1206. Image `7e3923a9-e254-8d3f-b377-68d86f6083df`, source 6772×9886. `full/,3000/` gives 2055×3000 measured. Portrait. Text: Japanese title and series cartouches, top right; signature and publisher seal, lower left. Or **Met 55433** (`https://images.metmuseum.org/CRDImages/as/original/DP130156.jpg`, 2650×3860 measured).

---

## 3. Space: NASA/JPL "Visions of the Future"

**Rights. These are not US-government public domain.** The gallery page says "Credit: NASA/JPL-Caltech". Its FAQ answers "Can I get copies of these posters from NASA or JPL?" with "The images are free for you to print. Please consult the JPL Image Use Policy for further details." The footer says "JPL is a federally funded research and development center managed for NASA by Caltech." (https://www.jpl.nasa.gov/galleries/visions-of-the-future). The JPL Image Use Policy (https://www.jpl.nasa.gov/jpl-image-use-policy), verbatim:

> Unless otherwise noted, images and video on JPL public web sites (public sites ending with a jpl.nasa.gov address) may be used for any purpose without prior permission, subject to the special cases noted below. Publishers who wish to have authorization may print this page and retain it for their records; JPL does not issue image permissions on an image by image basis.
>
> By electing to download the material from this web site the user agrees:
>
> that Caltech makes no representations or warranties with respect to ownership of copyrights in the images, and does not represent others who may claim to be authors or owners of copyright of any of the images, and makes no warranties as to the quality of the images. Caltech shall not be responsible for any loss or expenses resulting from the use of the images, and you release and hold Caltech harmless from all liability arising from such use.
>
> to use a credit line in connection with images. Unless otherwise noted in the caption information for an image, the credit line should be "Courtesy NASA/JPL-Caltech."
>
> that the endorsement of any product or service by Caltech, JPL or NASA must not be claimed or implied.
>
> Special Cases:
>
> Prior written approval must be obtained to use the NASA insignia logo (the blue "meatball" insignia), the NASA logotype (the red "worm" logo) and the NASA seal. […] Prior written approval must be obtained to use the JPL logo (stylized JPL letters in red or other colors). […]

**Status that applies.** The posters are a permissive "any purpose" grant from JPL/Caltech, not a public-domain dedication. They do **not** meet the project's own "public domain = pre-1929 or US federal work" bar. JPL is staffed by Caltech employees, and the policy talks about Caltech copyright and asks for a credit line. Using them is still allowed under the policy if the project (a) credits "Courtesy NASA/JPL-Caltech", (b) implies no NASA/JPL/Caltech endorsement, and (c) shows no NASA or JPL logos. The project's source list names NASA/JPL, so they fit as a *licensed* source. Label them that way, not as "public domain".

**Download URLs.** The page's data (Nuxt payload, `galleryItems[].image.original`) gives one `original_images/*.jpg` per poster on JPL's CloudFront. `galleryDownloadLink` is null, and **no TIFF or PDF is linked on the current page**. The FAQ says the available size is "20 x 30 inches". The old `/visions-of-the-future/images/*.pdf|tif` paths now return 404. The originals are 2:3 (2098×3130 to 2607×3887, measured), which is about 105–130 ppi at 20×30 in. That is enough for the ≥2000 px floor.

I looked at each pick at 1100 px and at full-resolution crops of the bottom 12–14%. **No NASA meatball, NASA worm, JPL logo, or credit text appears on any of the three picks or the alternates I checked.** Nothing needs cropping.

| Poster | URL | px | Text (transcribed) | Logos |
|---|---|---|---|---|
| **The Grand Tour** | `…/original_images/grand_tour.jpg` | 2607×3886 | "A ONCE IN A LIFETIME GETAWAY / THE GRAND TOUR / JUPITER / SATURN / URANUS / NEPTUNE / EXPERIENCE THE CHARM OF GRAVITY ASSISTS / EVERY 175 YEARS / NOW BOARDING" | none |
| **Mars** | `…/original_images/mars.jpg` | 2607×3887 | "VISIT THE / HISTORIC SITES / MARS / MULTIPLE TOURS AVAILABLE / ROBOTIC PIONEERS / ARTS & CULTURE / ARCHITECTURE & AGRICULTURE" | none (a stylized rover graphic, no insignia) |
| **Enceladus** | `…/original_images/enceladus.jpg` | 2098×3130 | "VISIT BEAUTIFUL SOUTHERN / ENCELADUS / MORE THAN 100 BREATHTAKING GEYSERS! / THE HOME OF "COLD FAITHFUL" / BOOKING TOURS NOW" | none |
| Alt: Jupiter | `…/original_images/jupiter.jpg` | 2098×3130 | "EXPERIENCE THE MIGHTY AURORAS OF / JUPITER" | none |
| Alt: Titan | `…/original_images/titan.jpg` | 2098×3130 | "TITAN / RIDE THE TIDES THROUGH THE THROAT OF KRAKEN" | none |
| Alt: Europa | `…/original_images/europa.jpg` | 2098×3130 | "EUROPA / DISCOVER LIFE UNDER THE ICE / ALL OCEAN VIEWS!!!" | none |

The `…` prefix is `https://d2pn8kiwq2w21t.cloudfront.net`. Earth (`earth.jpg`) is 2098×3128. Kepler-186f is only 1200×1789, below the floor, so skip it.

---

## 4. Parks and travel: Library of Congress WPA posters

**Rights.** Each item's JSON (`https://www.loc.gov/item/<id>/?fo=json`) has `rights_advisory` = `rights_information` = **"No known restrictions on publication."** and `unrestricted: true`. The general rights text says: "The Library of Congress does not own rights to material in its collections … it is the researcher's obligation to assess copyright." Why these are public domain: each record's `created_published` says they were made by the **Works Progress Administration Federal Art Project**, and the prints say "MADE BY WORKS PROGRESS ADMINISTRATION · FEDERAL ART PROJECT NYC". The collection page calls the posters "The results of one of the first U.S. Government programs to support the arts" (https://www.loc.gov/collections/works-progress-administration-posters/). So they are US federal works. The issuing body on the "See America" posters is the **United States Travel Bureau**, a federal body, not a company. **None of the picks has a railroad or other corporate mark.** The only marks are the small "USA / WORK / WPA" box on two of them (a government program mark) and federal agency names.

### 4.1 Pick 1: *See America* (Frank S. Nicholson), https://www.loc.gov/item/93505613/
- Created: "NYC : Works Progress Administration Federal Art Project, [between 1936 and 1939]". Silkscreen. Call number POS - WPA - NY .N53, no. 4. Reproduction number LC-DIG-ppmscd-03760.
- Image: IIIF `full/full` of master `ppmscd/03700/03760u` → **9248×11552** measured. The TIFF is `https://tile.loc.gov/storage-services/master/pnp/ppmscd/03700/03760u.tif` (320 MB). This is a clean scan with a thin dark margin and no color bar.
- Text: "SEE AMERICA / UNITED STATES TRAVEL BUREAU / MADE BY WORKS PROGRESS ADMINISTRATION - FEDERAL ART PROJECT NYC", plus the artist's signature "Frank S. Nicholson", lower right of the art. No logos. It shows a red-rock double arch with two riders and a pack horse.

### 4.2 Pick 2: *See America. Welcome to Montana* (Martin Weitzman), https://www.loc.gov/item/96503136/
- Created: "NYC : Works Progress Administration Federal Art Project, [between 1936 and 1939]". Call number POS - WPA - NY .W45, no. 6. LC-DIG-ds-08249.
- Image: IIIF `full/full` of master `ds/08200/08249u` → **6872×8632** measured. TIFF `https://tile.loc.gov/storage-services/master/pnp/ds/08200/08249u.tif` (178 MB).
- Text: "SEE AMERICA / WELCOME TO MONTANA / UNITED STATES TRAVEL BUREAU / MADE BY WORKS PROGRESS ADMINISTRATION · FEDERAL ART PROJECT NYC", signature "M. WEITZMAN". **Mark: a small "USA / WORK / WPA" box, bottom center**, just above the credit line. It shows a rider on horseback before snow peaks at sunset.

### 4.3 Pick 3: *The National Parks Preserve Wild Life* (J. Hirt), https://www.loc.gov/item/98518597/
- Created: "NYC : Works Progress Administration Federal Art Project, between 1936 and 1939". Call number POS - WPA - NY .H58, no. 1. LC-DIG-ppmsca-23061.
- Image: IIIF `full/full` of master `ppmsca/23000/23061u` → **6734×8534** measured. TIFF `https://tile.loc.gov/storage-services/master/pnp/ppmsca/23000/23061u.tif` (172 MB).
- Text: "DEPARTMENT OF THE INTERIOR, NATIONAL PARK SERVICE / THE NATIONAL PARKS PRESERVE WILD LIFE / MADE BY WORKS PROGRESS ADMINISTRATION FEDERAL ART PROJECT NYC". **Mark: "USA / WORK / WPA" box, bottom right corner.** It shows two bighorn rams on a rock above a lake.

### 4.4 Alternates
- **Zion National Park, Ranger Naturalist Service** (ca. 1939). https://www.loc.gov/item/2007676134/. Published by "Department of the Interior, National Park Service". "Poster possibly designed by artist C. (Chester) Don Powell". IIIF master `ppmsca/13400/13400u` → **4246×5742** measured. Text: "RANGER NATURALIST SERVICE / FIELD TRIPS - CAMPFIRE PROGRAMS / NATURAL HISTORY TALKS & EXHIBITS / GENERAL INFORMATION / ZION NATIONAL PARK / U.S. DEPARTMENT OF THE INTERIOR / NATIONAL PARK SERVICE". **Mark: the Interior Department bison seal, bottom center.** The physical print has a visible vertical crease and tear, lower center.
- **See America (Alexander Dux, Carlsbad-style cavern)**. https://www.loc.gov/item/96503125/. Master `cph/3g00000/3g04000/3g04200/3g04243u` is 4049×5000, **but that scan includes a KODAK color/gray-scale bar and the word "KODAK"**, so it needs a crop. The poster area is roughly 3000 px tall.
- **See America. Visit the national parks (Harry Herzog)**. https://www.loc.gov/item/98518589/. Master `cph/3b40000/3b48000/3b48700/3b48733u` is 3450×5000. **It also has KODAK color bars** at the top and bottom, plus a "USA WORK WPA" box at bottom left.
- Avoid: Yellowstone (2007676133) and Grand Canyon (2007676131). Lovely C. Don Powell NPS posters, but LoC offers only 1024-px JPEGs and no master.

---

## 5. fal FLUX text-to-image (October 2026)

**What is current.** fal's model index (`https://api.fal.ai/v1/models?q=flux&category=text-to-image`) lists **`blackforestlabs/flux-3/text-to-image`, "Flux 3 Image" (dated 2026-10-01)**: "FLUX 3 Image is Black Forest Labs' newest image model. Generate detailed, well-composed images in native 2K and 4K with precise layout control and improved text rendering." Also listed: `blackforestlabs/flux-3/klein/text-to-image` (2026-10-14), `fal-ai/flux-2-max` (2025-12-16), `fal-ai/flux-2-pro`, `fal-ai/flux-2-flex`, `fal-ai/flux-2`, and `fal-ai/flux-pro/v1.1-ultra` (2024-12-17).

### 5.1 Recommended: `blackforestlabs/flux-3/text-to-image`
Sources: https://fal.ai/models/blackforestlabs/flux-3/text-to-image, its `/llms.txt`, and https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=blackforestlabs/flux-3/text-to-image.
- **Input:** `prompt` (required). `resolution` ∈ `512sq | 768sq | 1k` (default) `| 2k | 4k`, where "Choose a resolution tier from `512sq` up to `4k` (16MP)" and "4k can take several minutes". `aspect_ratio` ∈ `auto | 21:9 | 2:1 | 16:9 | 3:2 | 7:5 | 4:3 | 5:4 | 1:1 | 4:5 | 3:4 | 5:7 | 2:3 | 9:16 | 1:2`. `output_format` ∈ `jpeg | png`. `safety_tolerance` is an integer from 0 (strictest) to 4, default 2. Also `enable_prompt_expansion` (default false), `sync_mode`, and `version: "latest"`.
- **Not in the schema:** `seed`, `guidance_scale`, custom width/height, `num_images`. **Outputs cannot be reproduced exactly.**
- **Resolution for posters:** 2:3 and 3:4 are native. **11:17 is not offered.** Generate at 2:3 and crop about 3% of the width (11:17 = 0.647, 2:3 = 0.667). fal does not publish exact pixel sizes per tier. By area, `4k` (16 MP) at 2:3 is about 3264×4896, and `2k` (about 4 MP) is about 1632×2448. Both are **unverified until the first call**, so read `images[0].width/height` from the response. `4k` clears 2048 px with room to spare. `2k` should clear it if "2K" means about 4 MP.
- **Price:** "Image pricing varies by resolution. A 1K (1 MP) image costs $0.048." Billing is in megapixels at $0.048 (pricing page and `endpointBilling`). Estimates: about $0.19 for `2k` (4 MP) and about $0.77 for `4k` (16 MP). fal lists it as a partner API (`is_partner_api: true`).
- **JS client:** fal's page gives `fal.subscribe("blackforestlabs/flux-3/text-to-image", { input: { prompt } })` with `@fal-ai/client`. The repo has `@fal-ai/client` **1.10.1**. Its typed endpoint map has `fal-ai/flux-2-max` but **not** the flux-3 ids. Call it as `fal.subscribe<string>(…)` the way `server/generate-object/pipeline.ts` already does for `fal-ai/trellis-2`, and type the output yourself (`{ images: { url, width, height }[] }`).

### 5.2 Fallback when exact pixels or a seed matter: `fal-ai/flux-2-max`
Sources: https://fal.ai/models/fal-ai/flux-2-max and its OpenAPI.
- **Input:** `prompt`. `image_size` = an enum (`square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9`) **or** `{ width, height }`, with the limits `x-fal: { min 256, max_width 2560, max_height 2560, max_area 4194304, multiple_of 16 }`. Also `output_format` (jpeg|png), `safety_tolerance` "1"–"5" (a string, default "2"), `seed`, `enable_safety_checker`, and `sync_mode`. There is no guidance parameter (only `fal-ai/flux-2-flex` has `guidance_scale` 1.5–10 and `num_inference_steps` 2–50).
- **Poster sizes that fit the limits:** **1536×2048** (3:4, 3.1 MP) is allowed directly. **1664×2496** (exactly 2:3, 4.15 MP). **1728×2304** (exactly 3:4, 3.98 MP). **1648×2544** (0.648, about 11:17, 4.19 MP). The maximum long side at these ratios is about 2500 px. Anything bigger needs an upscaler. These limits come from the schema; I made no paid call to confirm them.
- **Price:** "The first processed megapixel will cost $0.07. Each additional megapixel will cost 0.03". That is about $0.16–0.19 for a 3–4 MP poster.
- `fal-ai/flux-2-max` is in the client's typed endpoint map. fal's own llms.txt example uses `fal.subscribe("fal-ai/flux-2-max", …)`.
- For comparison: `fal-ai/flux-2-pro` has the same size limits, no guidance, and costs "$0.03 for the first megapixel … plus $0.015 per extra megapixel". `fal-ai/flux-2-flex` costs "$0.05 per megapixel". `fal-ai/flux-pro/v1.1-ultra` takes only `aspect_ratio` (has 2:3 and 3:4, no custom size), goes "up to 2K resolution", and costs "$0.06 per image".

### 5.3 fal in this repo
`grep -rn "fal-ai" server scripts` finds only `server/generate-object/`. `pipeline.ts` calls **`fal-ai/flux/schnell`** (`image_size: 'square_hd'`) and **`fal-ai/trellis-2`** through `client.subscribe`. `sandbox.ts` stubs the same two endpoints, and `routes.test.ts` mocks them. Nothing in `scripts/` uses fal. `package.json` pins `@fal-ai/client ^1.10.1` and already has `sharp ^0.35.5` for resizing.
