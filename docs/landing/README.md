# The landing page's 16 rooms

The Designs behind the 16 rooms on the landing page (`web/src/pages/landing/rooms.ts`). Claude made each one of the study lounge (`lounge`) with Generate, from a one-line Brief for a kind of room: a dorm bedroom, a game room, a study room, a library, a guest bedroom or a music lounge. The Briefs ask for a muted palette and no multicolor rugs, because the first round came back with neon pink and yellow. The Designs are kept here, not in `data/designs`, so the Scans page lists only the lounge's own Designs.

Each room on the landing page is a clip of its reveal (`web/src/scene/Reveal.tsx`): the empty lounge assembling itself Edit by Edit, from the door. To record the clips again, after changing a Design or the reveal, start the app and run:

```sh
node scripts/landing-clips.ts            # every Design here
node scripts/landing-clips.ts ds_x ds_y  # just these
```

To open one of these Designs in the editor, copy it into `data/designs/`, then go to `/d/<id>`.
