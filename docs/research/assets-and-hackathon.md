# Furniture Assets, Materials, Generative 3D, and DubHacks 2026

Researched 2026-10-17, during the event (DubHacks '26 runs Oct 17–18). Sources are primary where possible: dataset READMEs, live APIs, licenses, GitHub repos, vendor docs, and the DubHacks site and Devpost. "Measured" means a live API call or download made today. **[older]** marks facts confirmed only from sources older than 2026. **[unverified]** marks secondary or reseller sources.

---

## Urgent: DubHacks deadlines (from Devpost, fetched today)

- **Draft submission due Sat 10/17 before 10:30 PM.** The draft must list *all* team members as contributors, including their Discord names, and must declare your tracks. "If you do not submit a draft on Saturday night, you **will not** be able to participate in judging on Sunday."
- **Final submission due Sun 10/18 before 10:00 AM PDT** (the Devpost deadline). The DubHacks site says 10:30 AM, so plan for 10:00.
- **Judging: Sun 11:30 AM – 2:00 PM.** Closing ceremony: 2:15–3:05 PM.
- Source: https://dubhacks-2026.devpost.com/ and https://dh26.dubhacks.co/

---

## TL;DR

1. **ABO (Amazon Berkeley Objects)** is the best catalog for "swap this chair for a real product." It has 7,953 true-scale GLBs with PBR maps, real product titles, color, material, and dimensions. It is **CC BY 4.0, not NC**. Each GLB can be fetched over plain HTTPS, so you never need the 154 GB tarball. Two catches: **99.4% of models have one material with one baked texture atlas** (no separate parts), and the metadata has **no price**.
2. **Separable, recolorable parts are rare.** Most Poly Haven furniture is also one material. The best multi-material furniture is the **Khronos glTF sample assets** (SheenChair, GlamVelvetSofa, and others; CC0 or CC BY), plus selected Sketchfab models.
3. **Materials:** Poly Haven has **26 named oak/walnut veneers** and 43 fabrics (CC0). ambientCG has 2,020 materials (CC0). Both offer GL-convention normal maps, which is what three.js expects.
4. **Generative 3D: use hosted APIs (fal.ai), don't self-host.** TRELLIS.2 on fal costs $0.25–0.35 per object (GLB with PBR). Hunyuan3D v3/v3.1 costs $0.375 (+$0.15 for PBR). SAM 3D Objects reconstructs a masked object from a photo for $0.02/unit. Self-hosting needs a ≥24 GB NVIDIA GPU, and Azure GPU quota starts at 0 for new subscriptions.
5. **"AI photoreal render" of the viewport:** Gemini Nano Banana 2 (`gemini-3.1-flash-image`, $0.067 per 1K image) is the best fit, because it also qualifies for **[MLH] Best Use of Gemini API**. For layout-locked results, use FLUX.1 [pro] Depth ($0.05/MP) or FLUX.2 edit. Note that `gemini-2.5-flash-image` was shut down Oct 2, 2026.
6. **Best prize fit: "Visa: Reimagine Shopping" ($5,000 cash, the largest single prize).** It asks for generative AI commerce covering "discovery, decision-making, personalization..." Judging weights: Functionality 30%, Track Applicability 30%, Design 20%, Creativity 20%.

---

## 1. Furniture 3D model datasets and catalogs

### 1.1 Amazon Berkeley Objects (ABO)

**Direct answers**

| Question | Answer |
|---|---|
| Number of 3D models | **7,953** products have 3D models (README). The 3D metadata CSV has 7,953 rows (measured). |
| Format | glTF 2.0 binary (`.glb`). PBR metallic-roughness: base color, metallicRoughness (also used as occlusion), and a normal map. Textures are 4K for 4,241 models and 2K for 3,706 (measured). |
| Real dimensions | **Yes, twice over.** (a) The models are true scale in meters. Measured: a sofa listed as 87"W (2.21 m) has `extent_x` = 2.209. (b) Listings carry `item_dimensions` (inches) for 7,792 of 7,960 listings with models. |
| Axes and placement | +Y up and +Z = product front. Floor items stand on Y=0, ceiling items hang from Y=0, and wall items have their back on Z=0 (3dmodels README). Drop-in ready for a room editor. |
| Product metadata | `item_name` (multilingual), `brand`, `color` (7,441), `color_code` hex (3,250), `material` (6,034), `style` (5,141), `fabric_type` (1,372), `finish_type` (667), `item_weight`, `bullet_point`, `item_keywords`, `product_type`, image IDs. **No price field.** `item_id` is an ASIN. |
| License | **CC BY 4.0** (README and site). Credit "Amazon.com" for data, images, and 3D models. **It is not CC BY-NC**, so commercial use is OK with attribution. |
| Download size | Full 3D archive: 154 GB (`archives/abo-3dmodels.tar`). Listings: 83 MB. Small images: 3 GB. Part labels: 2 GB. **You can skip the archives:** each GLB is served at `https://amazon-berkeley-objects.s3.amazonaws.com/3dmodels/original/<path>` (measured: HTTP 200). |
| Separable materials | **No, for 99.4% of models.** 7,908 of 7,953 have exactly 1 material and 7,957 of 7,960 have 1 mesh (measured from `3dmodels.csv`). A chair's fabric and legs share one texture atlas. A 2 GB "part labels" archive exists for the ICCV 2023 fine-grained segmentation challenge. Its contents were not inspected. |
| Raw file weight | Heavy. Measured: one sofa GLB is 42.45 MB (4K PNGs). After `gltf-transform optimize --texture-compress webp --texture-size 1024` it is **315 KB**, in about 1 s. The output needs three.js `MeshoptDecoder`. |

**3D-model counts by `product_type`** (measured; the categories are noisy, for example some "DESK" items are bookcases):

| Type | Count | Type | Count |
|---|---|---|---|
| CHAIR | 1,184 | HEADBOARD | 206 |
| SOFA | 859 | LIGHT_FIXTURE | 197 |
| RUG | 817 | PLANTER | 182 |
| WALL_ART | 599 | DESK | 145 |
| TABLE | 584 | BED | 140 (+52 BED_FRAME) |
| HOME_FURNITURE_AND_DECOR | 550 | CABINET | 137 |
| LAMP | 345 | HOME_MIRROR | 109 |
| STOOL_SEATING | 340 | SHELF | 106 |
| OTTOMAN | 288 | DRESSER | 62 |
| PILLOW | 275 | BENCH / VASE | 39 / 50 |

All of the requested categories are covered: chairs, tables, sofas, beds, lamps, rugs, and **wall art (599)**. Most items are Amazon house brands such as Rivet, Stone & Beam, Ravenna Home, and AmazonBasics.

**Grabbing ~60 items in under 30 minutes**

1. `curl` the 16 `listings/metadata/listings_{0..f}.json.gz` files (about 5.4 MB each) and `3dmodels/metadata/3dmodels.csv.gz` (340 KB).
2. Filter on lines that have `3dmodel_id`, using `product_type` plus the English `item_name`. Pick about 5–8 per category and prefer items whose `color` and `material` are filled in.
3. Fetch each GLB over HTTPS. Raw files are roughly 3–45 MB, so about 1–2 GB for 60 items.
4. Batch `npx @gltf-transform/cli optimize in.glb out.glb --texture-compress webp --texture-size 1024`.
5. Write a `catalog.json` with id, title, brand, color, material, dimensions, category, and an Amazon link `https://www.amazon.com/dp/<item_id>`. **[unverified]** The links come from 2021 data and many listings may be dead.

**Implication for our hackathon:** ABO is the strongest "real product you could buy" catalog, and it fits the Visa shopping track (Amazon is also a 2026 sponsor). The license allows a public demo with an "Amazon Berkeley Objects, CC BY 4.0, Amazon.com" credit. Plan recoloring as a whole-object tint or a generative retexture, not per-part swaps (see §2.4).

Sources: https://amazon-berkeley-objects.s3.amazonaws.com/index.html, `README.md`, `3dmodels/README.md`, and `listings/README.md` in the same bucket. Paper: https://arxiv.org/abs/2110.06199

### 1.2 Poly Haven models (CC0)

- **Count (measured via API):** 521 models in total. **85 are tagged `furniture`**: 34 seating, 27 tables, 16 shelves, 3 beds, 29 lighting, 11 wall decoration (picture frames, mirror), and 11 vases. About 60 are indoor and usable. Examples: modern_arm_chair_01, mid_century_lounge_chair, sofa_02/03, coffee_table_round_01, dining_table, side_table_01, ornate_mirror_01, hanging_picture_frame_01–03, desk_lamp_arm_01, modern_ceiling_lamp_01.
- **Formats:** glTF (`.gltf` + `.bin` + JPG textures), `.blend`, `.fbx`, and `.usd`, at 1k/2k/4k/8k. **No `.glb`.** Convert with `gltf-transform copy x.gltf x.glb`. The `dimensions` metadata is in mm (for example, the armchair is 820 × 987 × 1023).
- **Materials:** Only some furniture is multi-material. Measured on 10 furniture glTFs: only `modern_arm_chair_01` has 2 materials (`_legs`, `_pillow`). The other 9 have a single material. Maps include diffuse, `nor_gl`/`nor_dx`, rough, metal, ao, and `arm` (AO/rough/metal packed).
- **API:** `https://api.polyhaven.com/assets?t=models`, `/info/<id>`, `/files/<id>`, `/categories/models`. **The API is free for any use, but building on the live API requires a "Powered by Poly Haven" credit.** The assets themselves are CC0 with no attribution needed. Send a custom User-Agent.
- **Quality:** Hand-made or scanned and high quality, but the style is rustic, vintage, or industrial. Few match "dorm room" aesthetics.

**Implication for our hackathon:** Poly Haven is a good, legally clean filler (CC0) for lamps, frames, mirrors, and vases, and for a few hero chairs and tables. Download the files ahead of time rather than hot-linking the API, so the credit requirement does not apply.

Sources: https://api.polyhaven.com (live), https://polyhaven.com/license, https://github.com/Poly-Haven/Public-API

### 1.3 Khronos glTF Sample Assets (bonus: the best *separable* furniture)

- Furniture with **multiple named materials** and real-product references from Wayfair:
  - **SheenChair** (CC0): 4 materials for fabric, wood, metal, and label, plus `KHR_materials_variants` ("Mango Velvet" / "Peacock Velvet").
  - **GlamVelvetSofa** (CC BY 4.0, Wayfair): 3 parts, plus `KHR_materials_variants` with 5 fabric colors.
  - **SheenWoodLeatherSofa** (CC BY 4.0 / CC0), **SpecularSilkPouf** (CC BY 4.0), **ChairDamaskPurplegold** (CC BY 4.0).
  - Lamps: **AnisotropyBarnLamp**, **IridescenceLamp**, **StainedGlassLamp**.
- Variants need the separate three.js plugin: https://github.com/takahirox/three-gltf-extensions (GLTFLoader docs).

**Implication for our hackathon:** These are the hero demo pieces for "change the fabric / change the wood." They are guaranteed to recolor per part, and some ship with built-in color variants. Use 2–4 of them for the live demo.

Sources: https://github.com/KhronosGroup/glTF-Sample-Assets (`Models/model-index.json`, each model's `metadata.json` and `README.md`)

### 1.4 Objaverse 1.0 and Objaverse-XL

- **Objaverse 1.0:** 798,759 UIDs, GLB files, dataset license ODC-By v1.0. Per-object licenses: CC-BY 721K, CC-BY-NC 25K, CC-BY-NC-SA 52K, CC-BY-SA 16K, CC0 3.5K. The `license` field is in the annotations.
- **Python API:** `objaverse.load_lvis_annotations()`, `load_annotations(uids)`, `load_objects(uids, download_processes)`.
- **LVIS subset (measured):** 1,156 categories and 46,207 objects, including chair 453, vase 106, bookcase 103, table 101, armchair 97, table_lamp 91, dresser 88, sofa 81, lamp 79, desk 76, cushion 75, dining_table 70, bed 53, coffee_table 51, and painting 51.
- **Objaverse-XL:** 10M+ objects (ODC-By, mixed per-object licenses, Apache-2.0 code). Its Polycam subset is non-commercial research only on request.
- **Quality:** Very uneven. Scales are arbitrary (no real dimensions), many models are untextured or vertex-colored, and orientation is random. Curating 30 good furniture pieces means rendering thumbnails and hand-picking, which takes 1–2 hours.

**Implication for our hackathon:** Use Objaverse only for gaps such as a specific lamp or painting. Filter to `license in {by, cc0}` and credit the authors. It is not a primary catalog.

Sources: https://huggingface.co/datasets/allenai/objaverse, https://objaverse.allenai.org/docs/objaverse-1.0, https://github.com/allenai/objaverse-xl

### 1.5 Sketchfab (Download API)

- **Ownership change (2026):** Epic sold Sketchfab and ArtStation to **KitBash**, announced **Aug 10, 2026**. Epic and KitBash say existing workflows continue, and no API changes have been announced. Sketchfab's copyright line now reads "KitBash SF Operations LLC".
- **API (measured today):** `GET https://api.sketchfab.com/v3/search?type=models&q=chair&downloadable=true&categories=furniture-home&license=by&max_face_count=100000` works without auth and returns `archives` sizes for `glb`, `gltf`, `usdz`, and `source`. `GET /v3/models/{uid}/download` returns **401 without auth**, so a Sketchfab account is required. For a third-party app, the docs require "end-users must be able to log in or create a Sketchfab account inside your application".
- **Licenses** (`/v3/licenses`): CC BY, BY-SA, BY-ND, BY-NC, BY-NC-SA, BY-NC-ND, CC0, plus store licenses. Filter to `cc0` or `by`, and credit the author for BY.
- **Quality:** Varies widely. Sample furniture GLBs were 10–56 MB with 5K–250K faces.

**Implication for our hackathon:** Good for hand-picking 5–15 specific, attractive, often multi-material pieces. Download them manually while logged in, keep a credits list, and avoid NC/ND if you might show the project publicly or keep building it. Do not build runtime Sketchfab search into the demo (OAuth flow plus 10–50 MB files).

Sources: https://sketchfab.com/developers/download-api, https://api.sketchfab.com/v3/licenses, https://www.epicgames.com/site/news/kitbash-acquires-artstation-and-sketchfab (403 to fetch; corroborated by https://digitalproduction.com/2026/08/12/kitbash-buys-artstation-and-sketchfab/ and https://greyscalegorilla.com/blog/kitbash-acquires-sketchfab-and-artstation)

### 1.6 3D-FUTURE (Alibaba)

- **Size:** 16,563 furniture models (the original 9,992 plus 6,571 added in April 2021), with high-resolution textures **[older]**.
- **License:** The "3D-FUTURE Data Sets Use License Agreement" grants use "for **scientific research purpose only**". Section 3.3.1 says "You shall not commercialize the data sets". Section 3.3.2 says "You shall not distribute, disseminate or otherwise make available the data sets to any third party". Access goes through a Tianchi application, and the Tianchi page now returns a 404.

**Implication for our hackathon:** Skip it. A public demo would serve the data to third parties, and access is slow to get.

Sources: https://terms.aliyun.com/legal-agreement/terms/suit_bu1_ali_cloud/suit_bu1_ali_cloud202004171628_60052.html, https://arxiv.org/abs/2009.09633

### 1.7 HSSD (Habitat Synthetic Scenes Dataset)

- 18,000+ object models and 211 scenes, 38.5 GB. **CC BY-NC 4.0** and gated on Hugging Face (accept terms).

**Implication for our hackathon:** The NC license and the 38 GB size make it a poor fit. Skip it.

Source: https://huggingface.co/datasets/hssd/hssd-models

### 1.8 IKEA

- **Product-page AR/preview GLBs:** No license is granted. A Feb 2026 article about a community downloader script notes that the repo "does not grant any additional licence for the assets. IKEA's own terms of use remain in effect."
- **IKEA's official research dataset:** 5 products (LACK, EKET ×2, BEKVÄM, DALFRED) as GLB, with named parts. It is **CC BY-NC-SA 4.0** "for research regarding assembly of furniture" **[older, 2021]**.

**Implication for our hackathon:** Don't ship scraped IKEA GLBs. The research set is too small and NC-SA.

Sources: https://github.com/IKEA/IKEA3DAssemblyDataset, https://digitalproduction.com/2026/02/09/download-ikea-furniture-as-3d-models-minus-the-trolley/

### 1.9 Google Scanned Objects

- About 1,000 scanned household items (shoes, toys, kitchenware) with a single baked texture each, prepared for Gazebo/Bullet. The license is Creative Commons (CC BY 4.0 per the Fuel listings **[older; Fuel returned 502 today]**). **It has essentially no furniture.**

**Implication for our hackathon:** Usable only for small decor props. Skip it for furniture.

Sources: https://arxiv.org/abs/2204.11918, https://research.google/blog/scanned-objects-by-google-research-a-dataset-of-3d-scanned-common-household-items/

### 1.10 New datasets, 2025–2026

- No new open, textured, real-scale **furniture catalog** release was found for 2025–2026.
- Research releases (PartNeXt, arXiv 2510.20155; Artiverse, arXiv 2605.24403) focus on parts and articulation, and their formats and licenses were not verified.
- The 2026 trend is generating furniture rather than releasing it. For example, Home3D 1.0 (arXiv 2606.27923) does part-aware PBR material retrieval, but it is a system, not a dataset.
- **Implication for our hackathon:** Nothing here changes the plan.

### 1.11 Comparison

| Source | License (demo-safe?) | Real scale | Product metadata | Separable materials | ~50 curated items in <2h |
|---|---|---|---|---|---|
| ABO | CC BY 4.0, yes with credit | Yes (m) | Yes (title, color, material, dims; no price) | No (1 atlas) | **Yes, scriptable** |
| Poly Haven | CC0, yes | Yes (mm metadata) | Name and tags only | Mostly no | Yes (API) |
| Khronos samples | CC0 / CC BY, yes | Yes | Wayfair reference | **Yes, + variants** | Only about 8 furniture items |
| Sketchfab | Per model (CC0/BY OK) | Varies | No | Often yes | 10–15 by hand |
| Objaverse | Per object (mostly BY) | No | No | Varies | Slow (quality filtering) |
| 3D-FUTURE | Research only, no | Yes | Category, style | Some | No (application) |
| HSSD | CC BY-NC, risky | Yes | Category | Some | No (38 GB, gated) |
| IKEA web GLBs | No license, no | Yes | Yes | Some | Don't |
| Google Scanned Objects | CC BY | Yes | No | No | No furniture |

---

## 2. PBR materials and material swapping

### 2.1 Poly Haven textures (CC0)

- **Count (measured):** 869 textures. 138 are wood, including **26 named oak/walnut** sets: `oak_veneer_01–05`, `white_oak_veneer`, `red_oak_veneer`, `grey_oak_veneer_01/02`, `walnut_veneer`, `american_walnut_veneer`, `black_walnut_veneer_01–03`, `natural_walnut_veneer`, `smoked_walnut_veneer`, `oak_wood_planks`, and others. There are 43 fabrics (velour_velvet, wool_boucle, rough_linen, denim, corduroy, leathers, jacquards) and 25 metals.
- **Formats:** JPG/PNG/EXR at 1k–16k, plus ready `.gltf` material files and `.blend`/MaterialX. Maps include Diffuse, `nor_gl`, `nor_dx`, Rough, AO, Displacement, and `arm` (R=AO, G=rough, B=metal, which matches glTF's ORM packing). Example: `oak_veneer_01` 1k diffuse JPG is 642 KB, and its real-world size is 1.83 m × 1.83 m.

### 2.2 ambientCG (CC0)

- **Count:** 2,020 materials (API `numberOfResults`), with search hits "wood" 295, "wood floor" 87, "fabric" 105, "metal" 214, "leather" 50, "paint" 35. **Naming is generic** (`Wood049`), so the searches "oak" and "walnut" return only 0–2 hits.
- **Formats:** ZIP per resolution: 1K/2K/4K/8K in JPG or PNG. Example: Wood049 is 6.8 MB at 1K-JPG and 23 MB at 2K-JPG. Each ZIP includes Color, NormalGL, NormalDX, Roughness, AO, Displacement, and sometimes Metalness.
- **API:** `https://ambientcg.com/api/v2/full_json?type=Material&q=wood&include=downloadData`
- **License:** CC0 1.0. "You can include the raw files in your project."

**Implication for our hackathon:** Poly Haven is the better source for named wood species (oak vs walnut) and fabric types, with friendlier per-map downloads. Use ambientCG for paint, metal, and extra variety. Use 1K JPGs only (about 1–3 MB per material).

Sources: https://api.polyhaven.com/assets?t=textures, https://ambientcg.com/api/v2/full_json, https://docs.ambientcg.com/license/

### 2.3 How material swapping works on a GLB in three.js

Facts from the three.js r186 source (`examples/jsm/loaders/GLTFLoader.js`):
- GLTFLoader builds `MeshStandardMaterial` (or `MeshPhysicalMaterial` for extensions) and sets `texture.flipY = false` on glTF textures.
- It assigns `SRGBColorSpace` to the base-color map.
- glTF packs **roughness in G and metalness in B** of `metallicRoughnessTexture`, and occlusion in R (glTF 2.0 spec).

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'; // needed for gltf-transform optimize output

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.loadAsync('/models/sheen_chair.glb');
const tl = new THREE.TextureLoader();
const tex = (url, isColor, repeat = 2) => {
  const t = tl.load(url);
  t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace; // only albedo is sRGB
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);              // set from real size: object meters / texture meters
  return t;
};
const oak = {
  map: tex('/tex/oak_veneer_01_diff_1k.jpg', true),
  normalMap: tex('/tex/oak_veneer_01_nor_gl_1k.jpg', false), // use the GL normal for three.js
  arm: tex('/tex/oak_veneer_01_arm_1k.jpg', false),          // R=AO, G=rough, B=metal
};

gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  mats.forEach((m, i) => {
    if (!/wood/i.test(m.name)) return;          // target by glTF material name (or mesh name)
    const n = m.clone();                         // clone: materials are shared between meshes
    Object.assign(n, { map: oak.map, normalMap: oak.normalMap,
                       roughnessMap: oak.arm, metalnessMap: oak.arm,
                       roughness: 1, metalness: 1 }); // factors multiply the map channels
    n.needsUpdate = true;
    if (Array.isArray(o.material)) o.material[i] = n; else o.material = n;
  });
});

// Recolor without a new texture: base color multiplies the map
someMesh.material.color.set('#8a5a3c');
```

Practical notes:
- **Recolor:** `material.color` *multiplies* the texture. This works on light or neutral albedo, but on dark textures it only darkens. For a true hue change on an atlas, either replace `map`, set `map = null` and use a flat color (painted surfaces), or apply a hue shift in `onBeforeCompile`.
- **Tiling textures need sensible UVs.** Product and scanned models use **atlas UVs** (islands packed into 0–1), so a tiling oak texture with `RepeatWrapping` lands at inconsistent scale and orientation per island. Fix this with **triplanar mapping**: three.js TSL has `triplanarTexture()` in `src/nodes/utils/TriplanarTextures.js` (node materials or WebGPURenderer). The other fix is to use models with sensible UVs (Khronos samples, many Sketchfab models).
- **Variants:** Models with `KHR_materials_variants` (SheenChair, GlamVelvetSofa) give one-click colorways through the takahirox plugin.
- **Disposal:** "image bitmaps are not automatically GC-collected" (GLTFLoader docs), so dispose of old textures when swapping repeatedly.

### 2.4 The baked single-material problem and workarounds

- ABO: 99.4% have a single material. Poly Haven furniture: 9 of 10 sampled have a single material. Generated models (TRELLIS, Meshy, and others) also come out as one mesh with one atlas. **For these, "change only the legs to oak" is impossible without segmentation.**
- Workarounds, in order of hackathon cost:
  1. **Whole-object tint or HSL shift.** Free and instant. Good enough for "make the sofa navy."
  2. **Generative retexture of the whole model from a text prompt**, for example "solid oak frame, cream boucle cushions":
     - **Meshy Retexture API** (`POST /openapi/v1/retexture`): takes `model_url` (GLB up to 400 MB) and `text_style_prompt` or `image_style_url`, with `enable_pbr` and `enable_original_uv`. Costs 10 credits for 2K/4K and takes about 55–90 s typically.
     - Self-hosted alternatives: TRELLIS.2 shape-conditioned texturing (`example_texturing.py`) and Hunyuan3D-Paint.
  3. **Part segmentation, then per-part materials.** fal `fal-ai/hunyuan-part` ($0.04, GLB input) or the ABO part-labels archive. Split the mesh by the labels, then apply triplanar PBR per part. This is the most impressive result but the most build time.
  4. **Curate multi-material models** (Khronos, Sketchfab) for the pieces you demo live.

**Implication for our hackathon:**
- **Demo per-part material swaps on 3–5 curated multi-material hero models.**
- For ABO catalog items, offer color tint plus "AI retexture" (a Meshy call, about 1 min, run async with a spinner).
- Don't promise per-part swaps on arbitrary items.

Sources: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html, https://threejs.org/docs/pages/GLTFLoader.html, https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/loaders/GLTFLoader.js, https://docs.meshy.ai/en/api/retexture, https://fal.ai/models/fal-ai/hunyuan-part/llms.txt

---

## 3. Generative 3D options

### 3.1 Image/text-to-3D

| Option | API | Latency per object | Cost | Output | Self-host |
|---|---|---|---|---|---|
| **TRELLIS.2** (Microsoft, 4B, paper Dec 2025, **MIT**) | **fal `fal-ai/trellis-2`**; HF Space `microsoft/TRELLIS.2` | H100: ~3 s @512³, ~17 s @1024³, ~60 s @1536³ (repo). Add queue, upload, and download time. | fal: **$0.25 / $0.30 / $0.35** (512/1024/1536) | **GLB with PBR**: base color, roughness, metallic, opacity (alpha exported OPAQUE by default) | Linux only, NVIDIA **≥24 GB VRAM** (tested A100/H100), CUDA 12.4, `setup.sh` builds flash-attn, nvdiffrast, and others ("may take a while"). Image-to-3D only, no text-to-3D. |
| **Hunyuan3D** (Tencent) | fal `fal-ai/hunyuan3d-v3/image-to-3d`, `.../text-to-3d`, `.../sketch-to-3d`, `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`; Tencent Cloud | Not stated by fal. **[unverified]** Atlas Cloud lists rapid at 2–3 min and pro at 3–6 min. | fal: **$0.375** (Normal), +$0.15 for PBR, +$0.15 multiview; Geometry-only $0.225 | GLB (+OBJ); PBR is optional (`enable_pbr`) | Open weights are **2.1** only (Jun 2025): 10 GB VRAM shape + 21 GB texture. License **excludes EU, UK, South Korea**; >1M MAU needs a license. 2.5/3.x are API-only **[unverified]**. |
| **Meshy** (Meshy 7.1 "latest") | Direct REST API (Pro plan and up); fal `fal-ai/meshy/v6/image-to-3d` | Median (Sep 2026, Meshy docs): image-to-3D 2K textures **2 min** (7.1), 3 min (6), 75 s (6-lite); text-to-3D preview 75 s + refine 80 s | Image-to-3D 30 credits (with textures). Pro is $20/mo for 1,000 credits, so about **$0.60**. fal: $0.80. Retexture: 10 credits. | GLB/FBX/OBJ/USDZ/STL; PBR via `enable_pbr` (metallic, roughness, normal) | No. Free plan has no API access, and free-plan assets are CC BY 4.0. |
| **Tripo** | Direct API (`openapi.tripo3d.com`, credits, AWS Marketplace overage $0.01/credit); fal `tripo3d/tripo/v2.5/image-to-3d` | Not verified | fal v2.5: $0.20 (no texture) / $0.30 / $0.40 (HD); P2 model $1.00–1.30 | GLB with PBR (`pbr` default true); quad output forces FBX | No |
| **Rodin Gen-2 / 2.5** (Hyper3D) | Direct API (Bearer key, docs.hyper3d.ai); fal `fal-ai/hyper3d/rodin` | Not published | fal: **$0.40**, HighPack (4K textures, high-poly) costs 3×. **[unverified]** Resellers list $0.80. | GLB/USDZ/FBX/OBJ/STL; PBR or Shaded; quad or raw mesh | No |
| **SAM 3D Objects** (Meta, Nov 19 2025; SAM License) | fal `fal-ai/sam-3/3d-objects`; demo at aidemos.meta.com | Not stated | fal: **$0.02 per unit** | Repo: Gaussian splat PLY with pose and layout. fal: GLB (vertex colors, or `export_textured_glb: true` for a baked texture) | Self-hostable. Takes **an image plus a mask, text prompt ("chair"), or boxes**, and optionally a **pointmap/depth (NPY)**, which could come from iPhone LiDAR. |
| **Seed3D** (ByteDance) | fal `fal-ai/bytedance/seed3d/image-to-3d` | Not stated | About $0.33 (≈30K tokens × $0.011/1K) | GLB | No |

Notes:
- All of the hosted options return **one mesh with a baked atlas** (see §2.4).
- "Generate any object" runs about 20 s to 3 min. Make it async with a placeholder box.
- Scale is arbitrary. **Rescale to user-entered or catalog dimensions** using the bounding box.
- fal has one key and one SDK for all of these, plus image models (§3.3), which makes it the lowest-integration path.

### 3.2 Self-hosting on a rented GPU

- **TRELLIS.2 needs ≥24 GB VRAM.**
  - AWS `g6e.xlarge` has 1× NVIDIA L40S **48 GB**, 4 vCPU, and 32 GiB RAM.
  - Azure options are the NC A100 v4 and NC H100 v5 families.
- **Azure GPU quota for new subscriptions is 0 for N-series.** Microsoft Q&A says that on "an Azure trial subscription or a student subscription, it is not possible to deploy the NC-series A100". Quota requests take "a day or two" to "a few days" (Valohai, SkyPilot). AWS G-instance quota for new accounts may also need a request **[unverified]**.
- **Setup-time estimate (ours, not vendor-published):** 1–3 hours. That covers the VM, CUDA 12.4, compiling flash-attn and nvdiffrast, downloading the 4B weights, and wrapping a FastAPI endpoint, assuming quota already exists. The Hunyuan3D 2.1 build is similar (custom rasterizer plus renderer compile).
- MLH's **Best Use of Vultr** prize offers free credits and "Vultr Cloud GPUs," a possible host if you want that prize.

**Implication for our hackathon:** Don't self-host in a 24-hour, 2-person build. Use fal.ai: TRELLIS.2 for speed and price, or Hunyuan3D v3.1 for quality. Budget about $10–20 total. Self-host only if someone already has GPU quota, and pitch it as "runs on our own GPU" for a cloud prize.

Sources: https://github.com/microsoft/TRELLIS.2, https://fal.ai/models/fal-ai/trellis-2/llms.txt, https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1 (+LICENSE), https://fal.ai/models/fal-ai/hunyuan3d-v3/image-to-3d/llms.txt, https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d/llms.txt, https://docs.meshy.ai/en/api/pricing, https://docs.meshy.ai/en/api/task-lifecycle, https://www.meshy.ai/pricing, https://developers.tripo3d.com/en/docs/billing.md, https://fal.ai/models/tripo3d/tripo/v2.5/image-to-3d/llms.txt, https://docs.hyper3d.ai/, https://fal.ai/models/fal-ai/hyper3d/rodin/llms.txt, https://github.com/facebookresearch/sam-3d-objects, https://fal.ai/models/fal-ai/sam-3/3d-objects/llms.txt, https://aws.amazon.com/ec2/instance-types/g6e/, https://learn.microsoft.com/en-us/answers/questions/2133321/i-need-to-create-nc24ads-a100-series-gpu-but-when, https://learn.microsoft.com/en-us/answers/questions/2157302/clarification-on-gpu-access-after-upgrading-azure, https://docs.skypilot.co/en/stable/cloud-setup/quota.html

### 3.3 Image models for the "AI photoreal render" of the 3D viewport

Pattern:
1. Render the three.js canvas at about 1024 px (`renderer.domElement.toDataURL()`). Optionally also render a depth pass.
2. Send it to an instruction-based editor ("Make this a photorealistic interior photo; keep every object's position, shape, and color; natural daylight").
3. Optionally pass the original room photo as a style reference.
4. If the edit model drifts the layout, use a **depth-conditioned** model instead.

| Model | Access | Price | Notes |
|---|---|---|---|
| **Nano Banana 2** `gemini-3.1-flash-image` | Gemini API (also fal `fal-ai/nano-banana-2/edit` at $0.08) | **$0.067** per 1K image, $0.101 per 2K | Up to 14 reference images. No free API tier for image output (AI Studio UI is free). About 20 s typical (Meshy's proxy timing). |
| Nano Banana 2.1 `gemini-nano-banana-2.1` | Gemini API | $0.0336 per 1K | Cheapest. 512px output not supported. |
| Nano Banana Pro `gemini-3-pro-image` | Gemini API; fal $0.15 | $0.134 per 1K/2K | Highest quality, slower (about 30 s). |
| ~~`gemini-2.5-flash-image`~~ | n/a | n/a | **Shut down Oct 2, 2026.** Don't use old tutorials' model ID. |
| **GPT-Image-2 / 2.5 (Sunburst, Flare)** | OpenAI API; **Azure OpenAI GA, no application needed** | Image output $30 per 1M tokens (OpenAI) | `images/edits` with mask, up to 16 input images. gpt-image-1/1.5 on Azure are still limited-access (application required). |
| **FLUX.1 [pro] Depth** | fal `fal-ai/flux-pro/v1/depth` | $0.05/MP | Geometry locked to the depth map. The safest way to keep layout exact. |
| FLUX.2 [pro] edit / FLUX.2 [dev] flash edit / FLUX.1 Kontext [pro] | fal | $0.03 first MP / $0.005/MP / $0.04 | Flash edit is the cheapest fast option. Kontext does targeted local edits. |
| Qwen-Image-Edit-2511 / Seedream 4.5 edit | fal | $0.03/MP / $0.04 | Alternatives |
| Amazon Nova Canvas | Bedrock | n/a | **[unverified]** Reported **end of life Sep 30, 2026** and now Legacy. Avoid. Nova 2 Omni does image editing, but its status is unclear. |

**Implication for our hackathon:** Use Nano Banana 2 through the Gemini API as the "Render photoreal" button. It costs pennies, has a one-call integration, and **qualifies for [MLH] Best Use of Gemini API**. Keep FLUX.1 Depth on fal as the fallback if objects move. Azure GPT-Image-2 also works without an access application.

Sources: https://ai.google.dev/gemini-api/docs/image-generation, https://ai.google.dev/gemini-api/docs/pricing, https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/dall-e, https://developers.openai.com/api/docs/pricing, fal `llms.txt` pages for each model ID above, https://docs.aws.amazon.com/nova/latest/userguide/image-gen-access.html, https://www.eweek.com/news/amazon-nova-ai-overhaul/

---

## 4. DubHacks 2026

All of this comes from the 2026 site and Devpost, fetched today. The 2026 Hacker Guide link on Devpost is broken (`href="hacker%20guide"`), so the rubric details and per-team judging time are **not published** in anything we could fetch.

### Event facts

| Item | 2026 fact |
|---|---|
| Dates and place | **Oct 17–18, 2026**, UW Seattle, Husky Union Building (HUB). In person only. |
| Theme | **"Let's Get Cookin'!"**: "Orders are flying in and the pressure's on. Work together, think fast, and build something unforgettable." |
| Length | Devpost: "annual **24 hour** hackathon". The site's stats say "36 Hours" and an old FAQ line says "32 hours", so treat Devpost as authoritative. |
| Schedule | Sat: check-in 9:30–11:00, opening 11:00–12:30, workshops 1:30–4:30, career fair 2:30–4:00, dinner 6:00–7:00. **Sat 10:30 PM: Devpost draft due.** Sun: breakfast 9:00–10:30, **final submission 10:00 AM (Devpost)**, judging 11:30–2:00, closing 2:15–3:05. |
| Overnight | No sleeping space in the HUB. Overnight workspace is in the Allen School G-classrooms (FAQ). |
| Team size | **Up to 4** (Devpost rules and FAQ). |
| Track rules | "exactly **one** title track, and can additionally participate in **up to three** sponsored side tracks and **as many** non-sponsored side tracks as they want". Tracks are declared in the Saturday draft. "Some side tracks will use a **video submission** in place of an in-person judging round." |
| Pre-existing code | Devpost rule: "Any projects submitted must be started and completed during the duration of DubHacks '26." FAQ: "You cannot work, copy, or iterate on past projects. Using your own APIs or third-party APIs is allowed, as long as the project is completely new." |
| Pre-existing code, 2024 guide **[older]** | "70-30 rule": at most 30% of code not written during the hackathon. Public frameworks and libraries are allowed. Code must be uploaded to Devpost (public GitHub recommended) before the deadline. No coding before the start, but ideation beforehand is OK. Judging was "in-person expo-style; you must have 1 person be present at judging to qualify". Assume the same in 2026. |
| Assets | No rule against third-party datasets or models was found. Public libraries are explicitly OK (2024). Credit CC BY assets on Devpost. |
| Judging criteria (2026 Devpost) | **Functionality** (code functionality and quality of execution) **30%**, **Track Applicability 30%**, **Design** (UI/aesthetics) **20%**, **Creativity** (unique solution, few weaknesses) **20%**. In 2025, Design was only 10%, so 2026 doubles it. |
| Prize pool | Site: "$44,000+ in prizes". Devpost: $9,200 in cash plus other prizes. |
| Sponsors (2026 site tiers) | Pink: **Visa**. Gold: T-Mobile. Silver: SpaceXAI (x.ai), **SideShift**, Perceptron, **nebulaONE (Cloudforce)**. Bronze: Photon, Expedia Group, **Amazon**, Salesforce. Custom: Treasury, SAP, Indomie, Veyzl. MLH-affiliated event. |

### Tracks (verbatim from the site's track copy)

- **Community Kitchen:** "Build technology that helps people thrive. From accessibility and healthcare to civic tech, sustainability, emergency response, and community support..."
- **Chef's Choice** (called "Chef's Kitchen" on Devpost): "Harness your creativity and innovation... AI experiences, smart systems, automation, games, **creative tools**, developer tools, or **beautiful interfaces**... imaginative, expressive, and fun."
- **Cook Smarter:** "Make work easier and life more efficient. Build AI agents, automation, productivity tools, **planning systems**..."
- **Visa (Reimagine Shopping):** "**Use generative AI** to craft smarter, effortless commerce experiences. Design and build a commerce experience that makes shopping more intuitive and personalized, transforming one or more stages of the journey: **discovery, decision-making, personalization**, checkout, payments, loyalty and rewards, or post-purchase."

The site shows Visa alongside the three themed tracks, which suggests it is a title track. Devpost does not label which tracks are "title". **Confirm on Discord or at the help desk.**

### Prizes (Devpost)

| Prize | Award |
|---|---|
| Chef's Kitchen / Community Kitchen / Cook Smarter, 1st | Each member picks one: Switch 2, Apple Watch SE 3, PS5, ChatGPT subscription, Bose QC, Meta Quest 3S, AirPods Pro 3, and others |
| Same three tracks, 2nd | Each member picks one: Polaroid, Kindle, JBL Flip 7, projector, LEGO, and others |
| **Visa: Reimagine Shopping** | **$5,000 cash** (1 winner) |
| SideShift 1st / 2nd / 3rd | $1,500 + work trial / $500 + interview / interview. Requirements not published. SideShift is a UGC creator-marketing platform. |
| CloudForce: Most Viral / Most Interesting / Raffle | $1,000 / $500 / $500. Requirements not published. nebulaONE is an Azure/Foundry-based AI gateway for universities. |
| DubHacks Next 1st / 2nd | $200 + guaranteed interview for Next Batch 6 / interview |
| Best Freshman Beginner Project | Amazon Echo Pop |
| SpaceXAI raffle | Cursor Owala bottle |
| **[MLH] Best Use of Gemini API** | MLH swag kits |
| [MLH] Best Use of Vultr | M5Stack Tab5 (Vultr Cloud GPUs and free credits) |
| [MLH] MongoDB Atlas / Tiger Data / Backboard / Solana / GoDaddy domain / DEV writing / Commit Fellowship | IoT kit / Stream Deck Mini / Tile pack / hardware wallets / gift card / $100 / fellowship interview |

**There are no Azure-, AWS-, Apple-, sustainability-, or design-specific prizes on the 2026 Devpost.** Amazon is a bronze sponsor with no listed prize. Sustainability fits only inside Community Kitchen.

Sources: https://dh26.dubhacks.co/ (track copy, FAQ, and sponsor tiers from the site's JS bundle), https://dubhacks-2026.devpost.com/, https://dubhacks-2026.devpost.com/rules, https://dubhacks25.devpost.com/ (2025 criteria), https://dubhacks.notion.site/The-DubHacks-24-Hacker-Guide-16da323fc21b4c6c8c0c2fbca1b7755e (2024 rules), https://nebulaone.com/, https://sideshift.app/

**Implication for our hackathon:**
- Submit the Devpost draft tonight before 10:30 PM.
- Have a working live demo plus a backup video. Some side tracks judge by video, and the 30% Functionality weight punishes demo failures.
- Track Applicability carries 30%, so the pitch should use the Visa track's own words: discovery, decision-making, personalization, generative AI.

---

## Recommended asset strategy for a 2-person, 24-hour team

1. **Hour 0–1, catalog (one person, scripted):**
   - Pull ABO listings and the 3D CSV. Select about 50 items: chairs 10, sofas 6, tables 8, desks 4, beds/headboards 4, lamps 6, rugs 6, wall art 6.
   - Download each GLB over HTTPS and batch `gltf-transform optimize --texture-compress webp --texture-size 1024`, which brings files to about 0.3–2 MB each.
   - Emit `catalog.json` with title, brand, color, material, dimensions, category, and ASIN link.
   - Credit "Amazon Berkeley Objects (CC BY 4.0), Amazon.com" in the app footer and on Devpost.
2. **Hero pieces for per-part material swaps:**
   - Khronos **SheenChair**, **GlamVelvetSofa**, **SheenWoodLeatherSofa**, **SpecularSilkPouf**, and a lamp.
   - Optionally 2–3 Poly Haven pieces (`modern_arm_chair_01` has separate legs and pillow materials) and Poly Haven frames, mirrors, and vases.
   - Plan the live demo around these.
3. **Material library (about 15 swatches, 1K JPG):**
   - Poly Haven `oak_veneer_01`, `white_oak_veneer`, `walnut_veneer`, `black_walnut_veneer_01`, `velour_velvet`, `wool_boucle`, `rough_linen`, `brown_leather`, and `leather_white`.
   - ambientCG painted metal, brushed metal, and paint.
   - Use `nor_gl`/`NormalGL` maps. Set texture repeat from real-world size. Use triplanar mapping where the UVs are atlases.
4. **Recolor for everything else:** `material.color` tint or an HSL shift on ABO and generated items. Don't promise per-part edits on them.
5. **"AI retexture" (optional wow, async):** Meshy Retexture with a text prompt ("walnut") on an ABO GLB, about 1 min.
6. **"Add anything" (optional):**
   - fal TRELLIS.2 at 1024 ($0.30, about 20–40 s end-to-end) from a text-to-image result or a user photo.
   - Or SAM 3D Objects from a photo of the user's own room plus a "chair" prompt ($0.02).
   - Rescale the result to catalog dimensions.
7. **"Photoreal render":** Gemini Nano Banana 2 edit of the viewport screenshot, with FLUX.1 Depth as the fallback.
8. **Do not:**
   - self-host GPUs (Azure quota starts at 0);
   - use IKEA GLBs, 3D-FUTURE, or HSSD;
   - pull Objaverse at scale;
   - make runtime Sketchfab calls.

**Budget:** fal about $15 and Gemini about $5. Meshy Pro is $20/mo (first month advertised at $10) and is only needed for retexture.

## Prize tracks to target

1. **Title track: Visa, Reimagine Shopping ($5,000 cash).** The product maps directly onto "discovery, decision-making, personalization." Real ABO products appear in *your* scanned room, and the "use generative AI" requirement is met by the AI render, AI retexture, and "generate any object." Add a "buy / similar products" panel using ABO metadata. First confirm that Visa is a title track. If it is a side track instead, take Visa as a sponsored side track and **Chef's Choice** ("creative tools... beautiful interfaces") as the title track.
2. **[MLH] Best Use of Gemini API:** Nano Banana 2 for the photoreal render, and optionally Gemini for a "style my room" agent.
3. **CloudForce: Most Viral / Most Interesting ($1,000 / $500):** A before/after photoreal room transformation is inherently shareable. Requirements are unpublished, so ask the sponsor booth.
4. **Consider:**
   - DubHacks Next (startup angle: furniture try-before-you-buy);
   - [MLH] GoDaddy domain (low effort);
   - [MLH] MongoDB Atlas if you store saved rooms;
   - [MLH] Vultr only if you self-host on a Vultr GPU;
   - SideShift ($1,500) if its brief turns out to fit "shareable room makeovers," which is plausible since SideShift is a UGC creator platform.
   - The sponsored-side-track cap is 3. Whether MLH prizes count toward it is not stated.
5. **Skip:** Community Kitchen and Cook Smarter as title tracks. Their fit is weaker, and Track Applicability is 30% of the score.

## Open questions / not verified

- Whether Visa is a title track or a side track, whether MLH prizes count toward the 3 sponsored side tracks, the CloudForce and SideShift prize criteria, and the per-team judging time. The 2026 Hacker Guide was not reachable; check Discord at https://discord.com/invite/HP4BhW3hnp.
- The contents of the ABO part-labels archive, and whether 2021 ASIN links still resolve.
- Hunyuan3D v3.x hosted latency and Rodin latency (no first-party numbers). The Tripo direct-API credit table, which was not on its billing page.
- The Google Scanned Objects license version (Fuel returned 502). AWS default G-instance quota for new accounts.
