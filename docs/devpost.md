# Mise: Devpost entry

Paste each section into the matching Devpost field. The screenshots are in [`docs/devpost/`](devpost/), in the order to upload them. The video script is [`docs/devpost-video.md`](devpost-video.md).

**Tracks:** Cook Smarter (title track). Side tracks: see #3.

---

## Name

Mise

## Tagline

An AI agent that plans your whole room in seconds, in a 3D copy of the room you actually live in.

## Inspiration

Moving in is a planning job that nobody trains you for. A college freshman gets a floor plan, a move-in date, and a roommate they haven't met. A new renter gets an empty room and a tape measure. Then come the evenings: measuring walls, sketching layouts on paper, opening forty tabs, and asking whether the desk fits between the bed and the window. Most people still guess, and find out on move-in day.

Interior designers solve this for a living, but most Movers can't hire one. We wanted the designer's planning process, done by an AI agent, on the Mover's real room. That is what "mise" means in a kitchen: *mise en place*, everything in its place before you start cooking. Mise does the same for a room, before you carry a single box.

## What it does

Mise is an AI planning agent for the room you are moving into.

1. **Get your room.** Scan it with an iPhone (Polycam or KIRI Engine), or find your dorm in Mise's library of real first-year doubles. We built ten from the floor plans that universities publish. Mise knows the room's walls, floor, doors, windows, and real dimensions.
2. **Write a Brief.** Say what you need in plain words: *"Our freshman double: a bed and a desk for each of us, a cozy reading corner, calm and warm, under $1,500."* Optionally pick a style, such as Japandi or Mid-century, and a budget.
3. **The agent plans the room.** Claude reads the room, plans a palette and a layout, and furnishes it from a Catalog of nearly 700 real items at true size: beds, desks, lamps, rugs, plants, wall art, and paint. It makes **three Designs at once**: a literal take, a bolder one, and a budget-conscious one. You watch each plan draw itself, Edit by Edit. In our test runs, all three whole-room Designs were finished in **10 to 15 seconds**.
4. **Every Design is checked.** The agent works under the same Fit rules as the Mover: nothing overlaps, nothing blocks a door's swing or a window, and a clear walkway runs from the door to every bed, desk, and dresser.
5. **Make it yours.** Open a Design in 3D. Walk through it at eye level or look down on it like a dollhouse. Then change anything: move, swap, resize, or recolor a Piece, or paint a wall. The room's real light stays on the walls. Every change is an Edit in the History, so you can undo it, and Claude's Edits sit beside yours.

**Why it saves time.** A Mover who plans a room by hand spends hours measuring, sketching, and comparing options that may not fit. Mise turns that into one sentence and about fifteen seconds, and gives three worked-out options instead of one guess. Every option is already measured against the real room, so the Mover only has to choose and adjust.

## How we built it

**The Claude agent.** `POST /api/generate` runs three agent loops side by side on Claude Opus 5.5 (`claude-opus-5-5`) through the Anthropic TypeScript SDK's Tool Runner. Each loop designs in its own in-memory Design through strict tools: `search_catalog`, `place_piece`, `replace_original`, `recolor`, `apply_finish`, `remove`, and `finish_design`. The server gives Claude a Room Summary, not coordinates: each wall's name and length, the doors and windows, the furniture already there, and the largest free spots on the floor.

- **Anchors, not coordinates.** Claude places things by relation: "against the North wall, left side", "beside the bed", "under the window", "centered under the sofa". A resolver turns each Anchor into an exact position. If that position breaks a Fit rule, the resolver slides it along the wall in 10 cm steps before it reports an error. So Claude rarely needs a second try.
- **Decorating moves.** A single tool call can hang a gallery wall, lay a rug, set up a reading corner, or dress the furniture tops. A whole room fits in **one reply** from Claude, with no round trip to learn one Piece's id before it places the next.
- **Streaming.** Each tool runs as soon as its call is complete, while Claude is still writing the next one. Every Edit streams to the browser as newline-delimited JSON, so the three plans draw themselves live.
- **Prompt caching.** The tools, the system prompt, and the room context are the same for all three takes, so they are cached. The cache is warmed while the Mover is still typing the Brief. Fast mode makes the output up to 2.5× faster.
- **One set of rules.** Claude's tools call the same `replay`, Fit, Anchor, and Catalog search modules (in `shared/`) that the editor uses. The agent can't do anything the Mover couldn't do by hand, and the Mover can undo any of it.

**The Design model.** A Design is a list of Edits (ADR-0001), and the room you see is `replay(edits)`, a pure function. That one choice gave us undo, History, duplicating a Design, the live drawing of Claude's plans, and a safe way for an AI agent to change the room.

**The scan pipeline.** We scanned a real study lounge (Oliver Hall, 6th floor) with an iPhone 16 Pro (LiDAR), using Polycam and KIRI Engine.

- `scan-import` optimizes each mesh with glTF-Transform and meshopt, with WebP textures.
- A browser-based **Room Setup** tool marks the floor, walls, openings, and existing furniture. It starts from KIRI's room layout when there is one.
- Extra **Fill Captures**, made with the furniture moved, show what was behind it. We used them, plus Blender, to build an **Empty Room** and one clean **Master Copy** of each kind of furniture. That way you can move the room's own chairs and tables and see real floor and wall where they stood.
- A Gaussian splat of the room, drawn with Spark, gives the photoreal "Real" look. Anything you change draws from the mesh.
- For rooms nobody has scanned yet, **Claude reads an uploaded floor plan**. The Mover corrects its reading, and Mise builds the room with light computed in the browser: sky and sun through the windows, a ceiling light, and two bounces.

**The Catalog.** We built it offline with `scripts/catalog-build.ts` and companion scripts. It has nearly 700 items with true real-world dimensions:

- 489 3D models from **Amazon Berkeley Objects**, each up to 45 MB as downloaded and optimized to a few hundred KB
- 91 from **Poly Haven** and 31 from **Google Scanned Objects**
- 43 posters of real public-domain art from museum open-access collections
- 49 rugs and textiles, some from museum collections and some drawn by our scripts
- a Material Library of CC0 woods, stones, fabrics, carpets, and wallpapers from Poly Haven and ambientCG

Every item has a category, colors, style tags, and recolorable Parts, so the agent can search it by what fits the room and the Brief.

**The app.** It uses Vite, React, TypeScript, React Three Fiber, drei, and three.js in the browser, with a small Hono server that keeps Designs as JSON files on disk. Over 800 Vitest tests cover replay, Fit rules, Anchors, the agent's tools, and the scan pipeline. The live demo runs on Azure App Service.

## Challenges we ran into

- **Speed.** Our first agent took several turns per Design: search, place, read the result, then place the next thing. Decorating a room took 23 to 27 seconds. We redesigned the tools so a whole room fits in one streamed reply. We also added decorating moves, an Anchor resolver that fixes small collisions itself, and prompt caching. Now decorating a furnished room takes 5 to 8 seconds, and furnishing and decorating an empty one takes about 14.
- **Keeping the agent honest.** An AI that "designs a room" can easily put a dresser in front of the door. We made the Fit rules strict tool errors, added a walkway check on a 5 cm grid, and made the agent use the same code as the editor. A Design Claude finishes always passes the checks the Mover's own Designs pass.
- **A scan is one fused mesh.** Polycam gives you one surface for the whole room, with chairs fused to the floor. Moving a chair leaves a hole. We split the mesh when it loads, and built the Empty Room from Fill Captures. Then we replaced each kind of furniture with one cleaned-up Master Copy.
- **Lining things up.** The mesh, the splat, and every extra Capture each come in their own coordinate frame. We wrote point-pair alignment tools and checked every pairing by eye.
- **Real sizes from messy data.** The ABO models are true scale, but each one is a single texture atlas with 4K maps. We wrote geometry rules that find Parts (a table's top and legs) so they can be recolored. We also compressed every model to fit the editor's 60 fps budget.

## Accomplishments that we're proud of

- Three complete, checked, whole-room plans from one sentence, in about 15 seconds, drawn live while you watch.
- A real dorm lounge you can walk through in the browser, where the room's own furniture can be moved and the floor beneath it is real.
- Ten real dorm rooms from public university floor plans, ready for a Mover who can't visit the room yet.

## What we learned

- With an agent, tool design matters more than prompt design. Giving Claude Anchors and whole-room moves instead of raw coordinates made it faster *and* better.
- An append-only list of Edits is the right way to let an AI change a user's work: every change is visible, attributed, and undoable.

## What's next

- **Generate on top of a furnished room.** Today the agent plans from the room's empty shell, so for a library dorm opened "furnished as it comes" it lays the room out again. Next, it starts from the open Design and plans around what is already there.
- **Refine by conversation.** "Swap the rug for something warmer" becomes a follow-up to the same agent on one Design.
- **Scanning in the app**, with Apple's RoomPlan, so a Mover goes from phone to plan without exporting files.
- **Shared plans for roommates**, so two people can plan one double together and pick a Design.
- **More planning tasks** for the same agent: move-in checklists, what to bring and what the room already has, and a layout for every room in a new apartment.

## Built with

`claude-opus-5-5` · Anthropic TypeScript SDK (Tool Runner, prompt caching, fast mode) · TypeScript · React · Vite · three.js · React Three Fiber · drei · Spark (Gaussian splats) · Hono · Node.js · Zod · Zustand · glTF-Transform · meshoptimizer · sharp · Blender · Polycam · KIRI Engine · Vitest · Playwright · Azure App Service

## Links

- **Code:** https://github.com/Pokehim/mise
- **Live demo:** https://mise-dubhacks.azurewebsites.net (demo mode: Room Setup and uploads are off, and Generate is rate-limited)
- **Video:** *(add the YouTube or Vimeo link after recording)*

## Screenshots

Upload in this order, with these captions:

| File | Caption |
|---|---|
| [`01-scanned-room.jpg`](devpost/01-scanned-room.jpg) | A real study lounge, scanned with an iPhone, in the browser at eye level |
| [`02-find-your-dorm.jpg`](devpost/02-find-your-dorm.jpg) | No scan yet? Find your dorm: ten real first-year rooms from university floor plans |
| [`03-brief.jpg`](devpost/03-brief.jpg) | One sentence is the whole Brief |
| [`04-agent-at-work.jpg`](devpost/04-agent-at-work.jpg) | Three agents plan at once, and each plan draws itself Edit by Edit |
| [`05-three-designs.jpg`](devpost/05-three-designs.jpg) | Three whole-room Designs in 13.5 seconds: literal, bolder, and budget-conscious |
| [`06-design-in-the-room.jpg`](devpost/06-design-in-the-room.jpg) | Open one, and the plan is in your room at true size, with every Edit in History |

## Credits

Mise's Catalog and materials use these openly licensed assets. The full per-item list is in [`data/catalog/CREDITS.md`](../data/catalog/CREDITS.md), with the posters in [`posters/CREDITS.md`](../data/catalog/posters/CREDITS.md) and the rugs and textiles in [`textiles/CREDITS.md`](../data/catalog/textiles/CREDITS.md).

- **Amazon Berkeley Objects** (489 3D models and the photos that the flat rugs and thumbnails are made from): Amazon Berkeley Objects (CC BY 4.0), Amazon.com. Collins, J., et al. (2022), "ABO: Dataset and Benchmarks for Real-World 3D Object Understanding", CVPR 2022. https://amazon-berkeley-objects.s3.amazonaws.com/index.html. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Google Scanned Objects** (31 3D models): Google Scanned Objects (CC BY 4.0), Google LLC. Downs, L., et al. (2022), "Google Scanned Objects: A High-Quality Dataset of 3D Scanned Household Items", ICRA 2022. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Poly Haven** (91 3D models, and wood, fabric, leather, and tile materials): CC0, https://polyhaven.com
- **ambientCG** (carpet, concrete, marble, metal, tile, and wallpaper materials): CC0, https://ambientcg.com
- **Posters, rugs, and textiles:** public-domain works from the open-access collections of The Metropolitan Museum of Art, The Art Institute of Chicago, The Cleveland Museum of Art, the Smithsonian, NASA/JPL, and others, credited one by one in the files above. Where no free real art existed, the art was made for Mise.
- **Fonts:** Architects Daughter, Work Sans, and JetBrains Mono, from Google Fonts (SIL Open Font License).
- **Claude** (Anthropic) plans every Design and reads the floor plans.
