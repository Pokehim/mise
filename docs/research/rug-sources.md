# Rug and Tapestry Sources: Public-Domain Museum Textiles

Researched 2026-10-18 for the Catalog rug refresh. The goal is about 24 real textiles: floor rugs (a top-down image on a 1 cm slab) and wall tapestries (a flat image hung on a wall). They replace the beige rugs with bold, graphic, colorful designs. Every fact below comes from a first-party museum API, record, or image file. "Measured" means I downloaded the file today and read its pixel size with `vipsheader`. Every image URL returned `HTTP 200 image/jpeg` to plain `curl -sI` today.

**Rights bar.** Each pick passes two tests:

1. It is public domain in the US. Every pick was made before 1931; all but one were made in or before 1900. The latest is Koloman Moser's 1900 fabric, and Moser died in 1918.
2. Its museum releases the image with no restrictions. The flag is AIC `is_public_domain: true` (CC0), CMA `share_license_status: "CC0"`, Met `isPublicDomain: true` (Open Access, CC0), or Cooper Hewitt / Smithsonian `objectRights: CC0` with media `usage.access: "CC0"`.

No shops, Pinterest, or "personal use" sources are used.

**Crop** gives the region to keep as fractions of the full image: left, top, width, height. I checked every crop by rendering it and looking at the result (800 px renders). The crops remove the grey studio background and, where noted, fringe. Where a fringe or tassel is part of the piece, the note says so.

**Size** is width × length for rugs (short side × long side) and width × height (as the image is oriented) for wall pieces, in cm, from the museum record.

---

## Picks

### Floor rugs (16)

| # | Catalog title | Culture / maker | Date | Museum, object no. | Use | Size cm | Image (px measured) | Style |
|---|---|---|---|---|---|---|---|---|
| F1 | Navajo Chief Blanket Rug, Black, White and Red | Navajo (Diné) | c. 1900 | Cleveland 1937.903 | Floor rug | 151.1 × 178.4 | `https://openaccess-cdn.clevelandart.org/1937.903/1937.903_print.jpg` (3400×2911) | Southwestern |
| F2 | Navajo Eye Dazzler Blanket, Red and Orange | Navajo (Diné), unknown weaver | c. 1885 | AIC 2023.1320 | Floor rug | 137.2 × 202.6 (no tassels) | `https://www.artic.edu/iiif/2/db45380c-f626-6ec2-bff0-be9c73987a06/full/3000,/0/default.jpg` (3000×2076; source 11346×7852) | Southwestern |
| F3 | Navajo Striped Blanket, Black and Cream | Navajo (Diné), woman artist | c. 1875–80 | Cleveland 1921.556 | Floor rug | 117.5 × 152.5 | `https://openaccess-cdn.clevelandart.org/1921.556/1921.556_print.jpg` (3400×2618) | Modern |
| F4 | Navajo Stepped Stripe Rug, Coral and Black | Navajo (Diné) | c. 1895–1910 | Cleveland 1921.561 | Floor rug | 138.8 × 220 | `https://openaccess-cdn.clevelandart.org/1921.561/1921.561_print.jpg` (3400×2421) | Mid-Century Modern |
| F5 | Navajo Serape, Cream with Diamonds | Diné/Navajo | ca. 1865–70 | Met 2019.373.1 | Floor rug | 133.4 × 210.8 | `https://images.metmuseum.org/CRDImages/ad/original/DP-17950-001.jpg` (4000×2541) | Contemporary |
| F6 | Saltillo Sarape, Pinstripes and Center Diamond | Saltillo, Coahuila, Mexico | 1800–50 | AIC 1962.769 | Floor rug | 111.1 × 197.5 (232.4 with fringe) | `https://www.artic.edu/iiif/2/1269ba0f-cdcf-be9a-d52f-500b406a5c8b/full/,3000/0/default.jpg` (1441×3000; source 5455×11354) | Bohemian |
| F7 | Star Kazak Rug, Navy and Ivory | Attributed to present-day Azerbaijan | early 19th century | Met 22.100.17 | Floor rug | 162.6 × 188 | `https://images.metmuseum.org/CRDImages/is/original/DP328920.jpg` (3358×3855) | Eclectic |
| F8 | Sewan Kazak Rug, Red and Gold | Southwest Caucasus | c. 1875 | AIC 2014.1173 | Floor rug | 182.8 × 248.5 | `https://www.artic.edu/iiif/2/e7e8f804-ac60-149e-c8fe-a39bb6d5f259/full/,2250/0/default.jpg` (1639×2250, full source) | Traditional |
| F9 | Shirvan Kilim, Red and Ivory Medallions | Azerbaijan, Shirvan area | last quarter 19th century | AIC 2012.578 | Floor rug (long) | 183.5 × 374.7 | `https://www.artic.edu/iiif/2/648d11ef-8e50-d68d-f367-97b828e536f8/full/,2250/0/default.jpg` (1247×2250, full source) | Bohemian |
| F10 | Anatolian Star Kilim Runner | Central Anatolia, Türkiye | 1st quarter 18th century | AIC 2017.75 | Runner | 127 × 335.3 | `https://www.artic.edu/iiif/2/47f31cd8-bef3-25a5-5b95-f3ad2e9faab5/full/,3000/0/default.jpg` (1326×3000; source 2882×6519) | Rustic |
| F11 | Finnish Rya Rug, Blue and Gold | Central Finland | 1701/25 | AIC 1924.458 | Floor rug | 163.2 × 210.8 | `https://www.artic.edu/iiif/2/d1094a3f-a494-6017-a818-18bb7be7c74f/full/,3000/0/default.jpg` (2401×3000; source 4694×5865) | Scandinavian |
| F12 | William Morris Holland Park Carpet | William Morris | late 19th century | Met 27.139.3 | Floor rug (very large) | 396.9 × 515.6 | `https://images.metmuseum.org/CRDImages/es/original/DP245936.jpg` (3075×3923) | Vintage |
| F13 | Chinese Medallion Carpet, Gold and Blue | China | late 18th–19th century | Met 1991.198 | Floor rug | 212.7 × 299.7 | `https://images.metmuseum.org/CRDImages/as/original/LC-1991_198-001.jpg` (2623×4000) | Traditional |
| F14 | Indian Striped Runner, Raspberry and Grey-Blue | India | 19th century | Cleveland 1918.16 | Runner | 87.6 × 302.3 | `https://openaccess-cdn.clevelandart.org/1918.16/1918.16_print.jpg` (3400×1026) | Farmhouse |
| F15 | Moroccan Striped Textile, Indigo, Red and Saffron | Morocco | 1600s–1700s | Cleveland 1953.321 | Small rug / runner | 78.8 × 151.5 | `https://openaccess-cdn.clevelandart.org/1953.321/1953.321_print.jpg` (3400×1850) | Moroccan |
| F16 | Cretan Folk Blanket, Dancers and Riders | Greece, Crete | 19th century | Cleveland 1965.314 | Floor rug | 160 × 218.5 | `https://openaccess-cdn.clevelandart.org/1965.314/1965.314_print.jpg` (2535×3400) | Eclectic |

### Wall tapestries (9)

| # | Catalog title | Culture / maker | Date | Museum, object no. | Use | Size cm (w × h) | Image (px measured) | Style |
|---|---|---|---|---|---|---|---|---|
| W1 | Korean Patchwork Wrapping Cloth (Pojagi) | Korea | 19th century | AIC 1996.372 | Wall tapestry | 115.7 × 116.2 | `https://www.artic.edu/iiif/2/30c36990-23a5-0102-df8d-6079f4ef7fa0/full/3000,/0/default.jpg` (3000×2967; source 5057×5002) | Modern |
| W2 | Japanese Furoshiki, Carp in Waves | Japan, Meiji period | late 19th century | AIC 2002.181.2 | Wall tapestry | 73.8 × 71.1 | `https://www.artic.edu/iiif/2/7ac44a0e-c2a2-4205-5560-db92df9d7a4e/full/2293,/0/default.jpg` (2293×2250, full source) | Japanese |
| W3 | Japanese Katagami Stencil, Peonies on Waves | Japan | mid 18th–early 19th century | Cooper Hewitt 1976-103-57 | Wall tapestry | **not in record** | `https://ids.si.edu/ids/download?id=CHSDM-C260CB5269242-000001.jpg` (5101×3408) | Japanese |
| W4 | Koloman Moser "Poppyheads" Fabric, Vermilion | Koloman Moser (design); Johann Backhausen & Söhne (maker), Vienna | 1900 | AIC 1986.963 | Wall tapestry | 113 × 182.9 | `https://www.artic.edu/iiif/2/71550262-862a-d19a-680b-f50a2e284901/full/,3000/0/default.jpg` (1970×3000; source 3959×6030) | Art Deco |
| W5 | Uzbek Ikat Wall Hanging, Crimson and Teal | Uzbekistan, Samarkand or Bukhara | 1850/75 | AIC 2005.603 | Wall tapestry | 132.1 × 166 | `https://www.artic.edu/iiif/2/60c6226c-f20b-c003-f569-0ac9efdcea94/full/,2250/0/default.jpg` (1888×2250, full source) | Bohemian |
| W6 | Uzbek Suzani, Red Blossoms | Uzbekistan, probably Tashkent | 1840/1890 | AIC 2019.794 | Wall tapestry | 168.9 × 221 | `https://www.artic.edu/iiif/2/a2c0e179-5afc-f007-8846-f52c40c68431/full/,3000/0/default.jpg` (2389×3000; source 5792×7272) | Eclectic |
| W7 | Inca Tunic, Key-Pattern Checks | Peru, Inca | c. 1400–1540 | Cleveland 1957.136 | Wall tapestry | 76.2 × 85.1 | `https://openaccess-cdn.clevelandart.org/1957.136/1957.136_print.jpg` (3066×3400) | Rustic |
| W8 | Princess Feather Quilt, Green and Red | United States | c. 1850 | AIC 1919.551 | Wall tapestry | 221 × 211.8 | `https://www.artic.edu/iiif/2/1b9a3c0e-b1d7-3e03-ac75-ad2b02a7700c/full/2338,/0/default.jpg` (2338×2250, full source) | Farmhouse |
| W9 | Moroccan Silk Banner, Rose and Gold | Probably Morocco (probably Saadi dynasty) | 16th–17th century | AIC 2003.105 | Wall tapestry (tall banner) | 85.8 × 258.2 | `https://www.artic.edu/iiif/2/ef8ad2dd-bcdd-10cb-a323-b407248b0f54/full/,3000/0/default.jpg` (1227×3000; source 1254×3066) | Moroccan |

**Mix.** The 25 picks cover:
- Navajo (5)
- Saltillo (1)
- Caucasian: Kazak ×2 and a Shirvan kilim
- Anatolian kilim
- Finnish rya, standing in for Swedish rya
- Morris / Arts & Crafts
- Chinese
- Indian
- Moroccan (2)
- Cretan
- Korean
- Japanese (2)
- Vienna Secession
- Uzbek (2)
- Inca
- American quilt

The modern and graphic ones are F3, F4, F5, F2, F7, W1, W2, W3, W4 and W5.

---

## 1. Fetching notes

- **AIC** serves IIIF at `https://www.artic.edu/iiif/2/<image_id>/full/<w>,/0/default.jpg`. As `poster-sources.md` §1 already found: send a short custom `User-Agent` (Node's default gets 403), never ask for more than the source size, and `full/full` and `full/max` return 403. I asked for `3000,` (or `,3000` for portrait) where the source is larger, and for the exact source size otherwise. The source size is the `thumbnail.width/height` field from `https://api.artic.edu/api/v1/artworks/<id>`. Five picks are served at their full source size: F8, F9, W2, W5, and W8. Their long sides are 2250–2338 px. F9 is the smallest file (1247×2250). It still clears 1500 px on the long side.
- **Cleveland**: `https://openaccess-api.clevelandart.org/api/artworks/<id>` returns `images.web` (about 900 px), `images.print` (3400 px JPEG, used here), and `images.full` (a TIFF, 57–300 MB, at 4723–18200 px). Use `full.url` if you ever need more than 3400 px. Use `print` for the Catalog.
- **Met**: `https://collectionapi.metmuseum.org/public/collection/v1/objects/<id>` → `primaryImage`. The `/v1/search` endpoint is retired. Use `/v1.1/search?q=…&limit=…`. Rapid requests got **HTTP 403** after about 15 object calls in a burst. A 1–1.5 s delay per call worked. The v1.1 search's `isPublicDomain=true` parameter did **not** filter the results, so check `isPublicDomain` on each object.
- **Cooper Hewitt / Smithsonian**: the `api.si.edu` `DEMO_KEY` hit `OVER_RATE_LIMIT` (429) after about 10 calls and stayed locked for the rest of the session. I got the W3 record from the Smithsonian Open Access bulk dump instead: `https://smithsonian-open-access.s3-us-west-2.amazonaws.com/metadata/edan/chndm/index.txt` lists 256 line-delimited JSON files, which I grepped for `"chndm_1976-103-57"`. `collection.cooperhewitt.org` object pages now 301 to `si.edu`, and `www.si.edu/object/…` returns 403 to curl. The image server `ids.si.edu` works with plain curl. `deliveryService?id=…` gave 4000×2673; `download?id=….jpg` gives the full 5101×3408.

---

## 2. Rights language (first-party quotes)

- **AIC** (https://www.artic.edu/open-access/open-access-images, fetched today): "images of works in the collection believed to be in the public domain or to which the museum otherwise waives any copyright it might have. Such images are made available under Creative Commons Zero (CC0) designation and the Terms and Conditions of this website." It adds: "You are welcome to use any images with the label 'CC0 Public Domain Designation' for any purpose, including commercial and noncommercial uses, free of charge and without additional permission from the museum." Requested caption: "Artist. Title, Date. The Art Institute of Chicago." Every AIC pick is `is_public_domain: true` in `https://api.artic.edu/api/v1/artworks/<id>`.
- **Cleveland** (https://www.clevelandart.org/open-access): "High-resolution images and data related to the CMA's collection are made available under a Creative Commons Zero". Open access content is published "free of charge, and without copyright and licensing restrictions." The API docs (https://openaccess-api.clevelandart.org/) say: "only artworks with the CC0 `share_license_status` will additionally provide access to CC0 images." Every Cleveland pick has `share_license_status: "CC0"`.
- **The Met** (https://metmuseum.github.io/): "To the extent possible under law, The Metropolitan Museum of Art has waived all copyright and related or neighboring rights to this dataset using the Creative Commons Zero license". `isPublicDomain` is "When 'true' indicates an artwork in the Public Domain". Every Met pick is `isPublicDomain: true`.
- **Cooper Hewitt (Smithsonian)**: the record for 1976-103-57 has `objectRights` "Restrictions & Rights | CC0", `metadata_usage.access: "CC0"`, and media `usage.access: "CC0"`. The source is the Smithsonian Open Access dump above. I could not fetch `si.edu/openaccess` itself (403).

---

## 3. Floor rug details

Object pages: AIC `https://www.artic.edu/artworks/<id>`, Cleveland `https://clevelandart.org/art/<accession>`, Met `https://www.metmuseum.org/art/collection/search/<id>`.

### F1. Navajo Chief Blanket Rug, Black, White and Red
- Record: "Fourth-Phase Chief Blanket Style Rug", Navajo (Diné), c. 1900, wool. Overall 178.4 × 151.1 cm. 1937.903. https://clevelandart.org/art/1937.903 (API id 117347), CC0.
- Colors: black, ivory, crimson. A big nine-diamond layout over bold black and white bands.
- Image: grey background. Black tassels at the four corners stick out past the body. Crop **0.045, 0.030, 0.935, 0.920**. The tassel tips stay at the corners, since cutting them would cut the rug.

### F2. Navajo Eye Dazzler Blanket, Red and Orange
- Record: "Wearing Blanket", unknown Navajo (Diné) weaver, c. 1885, wool, wedge tapestry weave. With tassels 142.3 × 203.9 cm; without tassels 137.2 × 202.6 cm. 2023.1320. https://www.artic.edu/artworks/122876, PD/CC0.
- Colors: scarlet, orange, grey-green, ivory, black. Concentric serrated diamonds: the classic "eye dazzler" look.
- Image: grey background, tiny corner tassels. Crop **0.030, 0.025, 0.940, 0.950**. A larger size is available (source 11346 px wide).

### F3. Navajo Striped Blanket, Black and Cream
- Record: "Wearing Blanket", Navajo (Diné), woman artist, c. 1875–80. Overall 117.5 × 152.5 cm. 1921.556. https://clevelandart.org/art/1921.556 (API 103608), CC0.
- Colors: ivory, dark brown-black, coral, navy. Fine pinstripes with coral and navy bars. The most "modern stripe" piece in the set.
- Image: grey background, slightly wavy edges. Crop **0.030, 0.035, 0.945, 0.920**.

### F4. Navajo Stepped Stripe Rug, Coral and Black
- Record: "Rug (banded pound blanket style)", Navajo (Diné), c. 1895–1910. Overall 220 × 138.8 cm. 1921.561. https://clevelandart.org/art/1921.561 (API 103614), CC0.
- Colors: ivory, black-brown, coral, mustard. Vertical stepped columns that read like a mid-century print.
- Image: an **off-white background with low contrast**, which defeats auto-trim. Small corner tassels. Crop **0.062, 0.080, 0.905, 0.840**, verified by rendering.

### F5. Navajo Serape, Cream with Diamonds
- Record: "Serape", Diné/Navajo, ca. 1865–70. 52 1/2 × 84 1/4 in. (133.4 × 210.8 cm). 2019.373.1. https://www.metmuseum.org/art/collection/search/823657, `isPublicDomain: true`.
- Colors: cream, pale yellow, navy, maroon, peach. A light, airy ground with nested diamonds and thin vertical lines. It suits light Scandinavian or contemporary rooms.
- Image: grey background. Crop **0.025, 0.036, 0.947, 0.935**.

### F6. Saltillo Sarape, Pinstripes and Center Diamond
- Record: "Man's Sarape (Wearing Blanket)", Saltillo, Coahuila, Mexico, 1800–50. Cotton and wool. "Overall, with fringe: 232.4 × 111.1 cm … without fringe: 197.5 × 111.1 cm". 1962.769. https://www.artic.edu/artworks/20210, PD/CC0.
- Colors: brick red, slate blue, ivory pinstripes, and a multicolor central diamond.
- Image: grey background. **Long knotted fringe at both ends.** Crop without fringe: **0.030, 0.110, 0.935, 0.785**. With fringe: 0.025, 0.043, 0.944, 0.910.

### F7. Star Kazak Rug, Navy and Ivory
- Record: "Star Kazak Carpet", attributed to present-day Azerbaijan, early 19th century. L. 74 in. (188 cm), W. 64 in. (162.6 cm). 22.100.17. https://www.metmuseum.org/art/collection/search/447483, `isPublicDomain: true`.
- Colors: navy/black, ivory, madder red, tan border. Huge eight-point stars on ivory: very graphic.
- Image: grey background. Uneven edges and short fringe. Crop **0.025, 0.025, 0.955, 0.950**. A little background shows at the irregular corners.

### F8. Sewan Kazak Rug, Red and Gold
- Record: "Sewan Kazak Rug", Southwest Caucasus, c. 1875, wool pile. 248.5 × 182.8 cm. 2014.1173. https://www.artic.edu/artworks/226150, PD/CC0.
- Colors: madder red, mustard-gold border, slate blue, ivory. The classic Sewan "shield" medallion.
- Image: grey background, short fringe at the bottom. Full source is only 1639×2250. Crop **0.036, 0.022, 0.925, 0.930**.

### F9. Shirvan Kilim, Red and Ivory Medallions
- Record: "Shirvan Kilim", Azerbaijan, Shirvan area, last quarter 19th century, wool slit tapestry. 374.7 × 183.5 cm. 2012.578. https://www.artic.edu/artworks/214907, PD/CC0.
- Colors: brick red, ivory, dark brown, touches of blue.
- Image: grey background, cut-warp fringe at both ends. **Smallest file (1247×2250 full source).** Crop **0.070, 0.020, 0.868, 0.955**.

### F10. Anatolian Star Kilim Runner
- Record: "Kilim with Bands of 'Star' Motifs", Central Anatolia, 1st quarter 18th century, wool slit tapestry. 335.3 × 127 cm. 2017.75. https://www.artic.edu/artworks/238762, PD/CC0.
- Colors: brick red, ivory, green, ochre, faded.
- Image: grey background. **Worn and ragged edges, with faded and abrashed bands.** It reads as a rustic, distressed runner. The whole piece is shown: the measured aspect (about 2.6:1) matches the record. Crop **0.095, 0.036, 0.803, 0.925**.

### F11. Finnish Rya Rug, Blue and Gold
- Record: 'Carpet (Known as a "Ryijy" or "Rya")', Central Finland, 1701/25, wool pile (Ghiordes knots). 210.8 × 163.2 cm. 1924.458. https://www.artic.edu/artworks/12821, PD/CC0.
- Colors: indigo, golden ochre, brown, green. Stylized figures and lozenges in a shaggy pile. **This is the Scandinavian pick.** I found no Swedish röllakan or rya with a verifiable CC0 large image (see §6).
- Image: grey background. Shaggy, uneven pile edges. Small dark tear, upper right. Crop **0.060, 0.045, 0.890, 0.915**.

### F12. William Morris Holland Park Carpet
- Record: "Holland Park carpet", William Morris, late 19th century. Overall 203 × 156 1/4 in. (515.6 × 396.9 cm). 27.139.3. https://www.metmuseum.org/art/collection/search/222094, `isPublicDomain: true`.
- Colors: teal blue field, salmon-pink flowers, terracotta border.
- **The real carpet is room-sized (about 4 × 5 m).** Scale it down for a dorm, or use the smaller Morris alternate (A5).
- Image: grey background, short fringe. Crop **0.023, 0.020, 0.960, 0.960**.

### F13. Chinese Medallion Carpet, Gold and Blue
- Record: "Carpet", China, late 18th–19th century. 83 3/4 × 118 in. (212.7 × 299.7 cm). 1991.198. https://www.metmuseum.org/art/collection/search/42748, `isPublicDomain: true`.
- Colors: straw gold field, navy medallion, bats and fret border, brown outer guard.
- Image: grey background, short fringe at the bottom. Crop **0.016, 0.012, 0.968, 0.975**.

### F14. Indian Striped Runner, Raspberry and Grey-Blue
- Record: "Blanket", India, 19th century. Overall 302.3 × 87.6 cm. 1918.16. https://clevelandart.org/art/1918.16 (API 98425), CC0.
- Colors: raspberry red, grey-blue. Simple dhurrie-style bands.
- Image: background. The selvages are slightly uneven: the strip is a touch narrower near the middle. **The short side is only 1026 px** (the TIFF is 18200×5490 if you need more). Crop **0.012, 0.020, 0.976, 0.950**.

### F15. Moroccan Striped Textile, Indigo, Red and Saffron
- Record: "Furnishing textile", Morocco, Moroccan weaver(s), 1600s–1700s. Average 151.5 × 78.8 cm. 1953.321. https://clevelandart.org/art/1953.321 (API 130599), CC0.
- Colors: indigo, cream, crimson, saffron. Broad horizontal stripes.
- **Caveat: the museum calls it a furnishing textile, not a rug.** It works visually as a flat-weave runner. AIC's Rabat carpets were not usable: 29059 is a black-and-white photo, and 6141 (873×1626) shows only part of a 469 cm carpet.
- Image: a cream background with low contrast. Wavy bottom edge and light crinkles. Crop **0.015, 0.030, 0.970, 0.935**.

### F16. Cretan Folk Blanket, Dancers and Riders
- Record: "Blanket", Greece, Crete, 19th century. Overall 160 × 218.5 cm. 1965.314. https://clevelandart.org/art/1965.314 (API 141732), CC0.
- Colors: cream, red, olive green, navy. Rows of little dancing figures and horse riders.
- Image: grey background, **fringe at both ends**. Crop **0.045, 0.085, 0.908, 0.850**, which removes the fringe. Verified.

---

## 4. Wall tapestry details

### W1. Korean Patchwork Wrapping Cloth (Pojagi)
- Record: "Wrapping Cloth, Pojagi", Korea, 19th century (`date_end` 1900), pieced silk. 116.2 × 115.7 cm. 1996.372. https://www.artic.edu/artworks/145403, PD/CC0.
- Colors: hot pink, yellow, teal, violet, white, black. A Mondrian-like patchwork of strips and triangles. **The most modern-looking piece in the set.**
- Image: grey background. A small pink cloth tie sits at the center; it is part of the object. Crop **0.060, 0.056, 0.876, 0.890**.

### W2. Japanese Furoshiki, Carp in Waves
- Record: "Furoshiki (Wrapping Cloth)", Japan, Meiji period, late 19th century, wool, resist-dyed and stenciled (yûzenzome). 71.1 × 73.8 cm. 2002.181.2. https://www.artic.edu/artworks/157266, PD/CC0.
- Colors: aubergine purple, teal, white. A carp leaping in a Hokusai-like wave in one corner; a moon on a large empty field.
- Image: grey background, slightly uneven hem. Crop **0.061, 0.075, 0.873, 0.855**.

### W3. Japanese Katagami Stencil, Peonies on Waves
- Record (Smithsonian Open Access dump, id `edanmdm:chndm_1976-103-57`): "Peonies and abstract waves", Japan, mid 18th–early 19th century, Katagami. "Mulberry paper (kozo washi) treated with fermented persimmon tannin (kakishibu), and silk threads (itoire)". Gift of Helen Snyder. Rights CC0. Record link https://collection.cooperhewitt.org/view/objects/asitem/id/155936 (it now redirects into si.edu).
- **The record has no physical dimensions.** Choose a display size; for example, 90 × 60 cm keeps the image's 3:2 ratio.
- Colors: dark brown and cream, two-tone. Op-art wavy lines with large peonies.
- Image: the brown stencil lies on a cream mount.
  - Option A, the whole stencil with its brown frame: crop **0.016, 0.013, 0.975, 0.970**.
  - Option B, the cut pattern only (more graphic): crop **0.105, 0.155, 0.810, 0.670**. Verified.
  - A faint grid of support threads is visible in the openings.

### W4. Koloman Moser "Poppyheads" Fabric, Vermilion
- Record: "Mohnköpfe (Poppyheads) (Dress or Furnishing Fabric)". Designed by Koloman Moser (Austrian, 1868–1918). Produced by Johan Backhausen und Söhne, Vienna. 1900. Silk, wild silk and cotton, Jacquard-woven. 182.9 × 113 cm; repeat 45.5 × 29.8 cm. 1986.963. https://www.artic.edu/artworks/64884, PD/CC0.
- Colors: vermilion orange with gold line drawing.
- Style: Vienna Secession, a direct forerunner of Art Deco. "Art Deco" is the closest tag. This is the only pre-1931 Wiener Werkstätte-circle textile I found with a CC0 large image (see §6).
- Image: grey background, selvage on the right. Crop **0.073, 0.040, 0.858, 0.922**.

### W5. Uzbek Ikat Wall Hanging, Crimson and Teal
- Record: "Wall Hanging Composed of Five Panels", Uzbekistan, Samarkand or Bukhara, 1850/75, silk warp ikat. 166 × 132.1 cm. 2005.603. https://www.artic.edu/artworks/185616, PD/CC0.
- Colors: crimson, teal, ivory, yellow. Big blurred-edge flame motifs.
- Image: grey background. A visible patch, center left. Full source only 1888×2250. Crop **0.064, 0.048, 0.868, 0.907**.

### W6. Uzbek Suzani, Red Blossoms
- Record: "Suzani (large hanging or cover)", Uzbekistan, probably Tashkent, 1840/1890. Cotton, embroidered with silk. 221 × 168.9 cm. 2019.794. https://www.artic.edu/artworks/248380, PD/CC0.
- Colors: rose red, ochre, black outlines.
- Image: grey background. Crop **0.030, 0.023, 0.932, 0.953**.

### W7. Inca Tunic, Key-Pattern Checks
- Record: "Tunic", Peru, Inca, c. 1400–1540. Average 85.1 × 76.2 cm. 1957.136. https://clevelandart.org/art/1957.136 (API 134604), CC0.
- Colors: tan, dark brown, wine red. A checkerboard of key and step motifs over banded stripes.
- Image: grey background. **Neck slit at top center**, plus some losses and staining, lower left. Crop **0.038, 0.038, 0.924, 0.939**.

### W8. Princess Feather Quilt, Green and Red
- Record: '"Princess Feather" or "Ostrich Plume" Quilt', United States, c. 1850. Appliquéd cotton. 211.8 × 221 cm. 1919.551. https://www.artic.edu/artworks/76067, PD/CC0.
- Colors: white, olive green, red. Four big feather pinwheels with a swag border.
- Image: almost full-bleed. A thin dark backing strip runs along the top and right edges. Crop **0.000, 0.012, 0.975, 0.980**.

### W9. Moroccan Silk Banner, Rose and Gold
- Record: "Panel", probably Morocco, probably Saadi dynasty (1510–1659), 16th–17th century. Silk and gilt-metal-strip-wrapped silk. 258.2 × 85.8 cm. 2003.105. https://www.artic.edu/artworks/181173, PD/CC0.
- Colors: rose pink, gold, teal, green. Banded center column with wide pink borders.
- Image: **black background**, plied warp fringe at the bottom. Crop **0.061, 0.031, 0.875, 0.910**.

---

## 5. Alternates (verified: HTTP 200 and measured today; crops are auto-trim estimates, not render-checked)

| # | Title | Museum, object no. | Size cm | Image URL | px | Note |
|---|---|---|---|---|---|---|
| A1 | Navajo Wearing Blanket, Black with Orange Zigzags (1865–75) | Met 10.107.3 (id 307827) | 135.9 × 166.4 | `https://images.metmuseum.org/CRDImages/ao/original/DP258275.jpg` | 1531×1937 | Very bold. Almost full-bleed (crop 0.003, 0.003, 0.995, 0.997). `isPublicDomain: true` |
| A2 | Navajo Blanket, Grey and Black Lightning Zigzags (late 19th c.) | AIC 1999.579 (id 153683) | 193.2 × 292.4 | `https://www.artic.edu/iiif/2/ed3e9d58-bd20-e323-61a9-1367f9c4dd42/full/,2250/0/default.jpg` | 1537×2250 | Neutral and modern. Loose yarn ends at the edges. Crop 0.048, 0.021, 0.905, 0.960 |
| A3 | Navajo "Eye-Dazzler" Weaving, Rainbow X (1880/1900) | AIC 1964.1134 (id 22379) | 155.7 × 214.5 | `https://www.artic.edu/iiif/2/2c02aabf-d2dc-e63a-0a3e-fabb3db7c42c/full/,2250/0/default.jpg` | 1654×2250 | Black background. Crop 0.027, 0.039, 0.933, 0.910 |
| A4 | Navajo "Germantown Eye-Dazzler" Rug (c. 1800/90) | AIC 2000.325 (id 155968) | 155.3 × 220.2 | `https://www.artic.edu/iiif/2/3f96e27c-a75d-af79-1615-252dee332787/full/,3000/0/default.jpg` | 2202×3000 | Crop 0.049, 0.034, 0.892, 0.922 |
| A5 | William Morris "Tulip and Lily" Rug (designed ca. 1875) | Met 1998.276 (id 230012) | 97.8 × 144.8 | `https://images.metmuseum.org/CRDImages/es/original/DP371514.jpg` | 3893×2665 | Dorm-sized Morris, sage green. Fringed all round (crop 0.036, 0.035, 0.919, 0.923 keeps part of the fringe) |
| A6 | Japanese Furoshiki, Three Cranes on Red (late 19th c.) | AIC 2002.181.1 (id 157244) | 76.1 × 75.9 | `https://www.artic.edu/iiif/2/6a87e375-9cc0-08c7-7987-5a8dd73c9536/full/2254,/0/default.jpg` | 2254×2250 | Swap in for W2 if you want red. Crop 0.057, 0.059, 0.887, 0.883 |
| A7 | Kuba (Quba) Prayer Rug (1850–1900) | AIC 1950.1491 (id 72815) | 124.7 × 160.3 | `https://www.artic.edu/iiif/2/cc7ee680-d206-1df2-bd9c-a4a7f0690c9d/full/,3000/0/default.jpg` | 2421×3000 | Caucasian, dark blue and tan. Long fringe at the bottom. Crop 0.066, 0.058, 0.867, 0.840 |

Other candidates I looked at but did not measure:
- More Navajo blankets: Cleveland 1937.900, 1937.855, 1921.565; Met 823661, 823658, 823660.
- Saltillo: Cleveland 1921.558 (a Saltillo-style sarape with a center diamond).
- Uzbek ikat: AIC 185615 (pink diamonds, 1344×1756) and 185613.
- Suzani: AIC 15768, the mihrab suzani (4022×5812).
- Chinese runners: Met 70592 and 70375.
- Caucasian: Met 452312 (Dragon carpet).

---

## 6. Could not verify / rejected

- **Swedish röllakan or rya: none found.** Nationalmuseum Sweden's collection site (collection.nationalmuseum.se) points to "Free images on Wikimedia" rather than serving downloads. The textile record I opened had no image. Met, AIC, and Cleveland searches for Swedish coverlets, rya, and röllakan returned nothing usable. The Finnish rya (F11) fills the slot.
- **Minneapolis Institute of Art (Mia): good pieces, no large download.**
  - Two strong modern candidates are marked "Public Domain" in Mia's search API (`https://search.artsmia.org/id/<id>`):
    - a **1914 Omega Workshops carpet** designed by Vanessa Bell and Roger Fry (accession 2001.56, id 33826, 241.3 × 185.4 cm, source 3099×3913);
    - a **c. 1925 Edouard Benedictus Art Deco rug** (id 83647, 307.34 × 200.66 cm).
  - Their full-resolution host `iiif.dx.artsmia.org` **does not resolve in public DNS** (Google DoH returns no A record). Only 800 px JPEGs come down with plain curl (`https://1.api.artsmia.org/800/<id>.jpg`).
  - Not usable until Mia's IIIF host works. Worth rechecking, since these are the best Art Deco and Bloomsbury rugs found.
- **Wiener Werkstätte textiles:** the first 15 Met results for "Wiener Werkstatte textile" (1040 total) were all `isPublicDomain: false`. AIC's 1903/05 Wiener Werkstätte panel (1991.83.37) is CC0 but pale and low-contrast. AIC's Moser "Hafis" (149403) is off-white and too faint. I used Moser's "Poppyheads" (W4) instead.
- **Bauhaus:** I found no Bauhaus textile that is both clearly public domain and CC0 in these collections. None is included.
- **Art Deco rug designs at Cooper Hewitt:** the `DEMO_KEY` rate limit cut the search short. The one "Design for a rug" (1953-31-30, about 1905) shows only a corner of the design, so it is not usable as a whole rug.
- **Rejected for condition or framing:**
  - Cleveland Moroccan *msimsim* wall hanging 1929.908: heavily holed, mounted in a frame.
  - Cleveland Fulani *kaasa* blanket 2024.72: dated "c. 1930s or earlier", so not plainly public domain.
  - Cleveland Kuba raffia cloths: dated "1900s", which is too vague.
  - Met Caucasian rugs 13964–13966 and 447469: black-and-white photos.
  - Met Kazak 14213: shot at an angle.
- **W3 physical size**: not in the Cooper Hewitt record (see W3).
