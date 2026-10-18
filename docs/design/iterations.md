# Iterations

The design loop of the concept-sketch redesign: shoot every view (`scripts/shoot.ts`), look at every shot, critique it against [sketch-style.md](sketch-style.md), change, repeat. [shots/](shots/) keeps `before` (main) and `final`; the rounds in between were shot to `iter-N` and looked at, but aren't committed.

## before

The baseline, the UI as it was on `main` (f2f9272): a clean warm-neutral app with a teal accent, rounded cards, pills, and a blue drei outline for the selection.

- **Phone editor is broken.** At 390 px the three-column grid leaves the 3D view 0 px wide: no room at all, and the page scrolls sideways (`editor-390x844.png`).
- **The shelf's Fit chip is missing** in `editor` although the shelf is outlined red: a drei `<Html>` mounted in the Canvas's first render loses its content under StrictMode (found and fixed in round 1).
- **Resize candidates are below the fold** at 1280×800: the Inspector and History split the column 1:1.
- Emoji as icons (🔒, 🔓), `↺ ↻` glyphs as rotate icons. Frame rate: 60.2 fps.

## Round 1

The direction applied everywhere: tokens, Architects Daughter / Work Sans / IBM Plex Mono, paper grain on panels, hatched empty states, the pencil wobble on pressed controls, the plan drawings on Home, and the sketch overlays in the 3D view (ink box, dimensions, callout, red-pencil loop, door swing). Frame rate: 60.1 fps.

What's off, against the style guide:

1. **CSS order.** `base.css` is injected after the component stylesheets (main.tsx imports `App` first), so on equal specificity the base wins: the Inspector's "Nothing selected" box sits flush on "Surface", and History's empty state ignores its margins. *Change:* import the styles before `App`.
2. **`≈` reads as `=`** in IBM Plex Mono at 11–12 px ("= $90 (est.)" in the callout), which misstates every price. *Change:* switch the mono to JetBrains Mono, whose `≈` is clear at small sizes.
3. **Dimension labels cover the item.** A label is centered on its line and set level, so on a line that runs up the screen it lies across the table it measures. The guide says labels sit on their line like a plan's. *Change:* turn each label to its line's angle on screen (kept upright) and move it to the outer side.
4. **Label stacking.** The Kept lock draws over the callout's label. *Change:* give the overlays fixed z-index bands: dimensions < Fit notes < Kept lock < callout.
5. **The door swing looks like a barber pole.** The paper halo runs solid under the red dashes. *Change:* dash the halo with its line.
6. **Callout label is heavy:** two lines of 16 px hand in a 200 px slip at this camera distance. *Change:* 15 px, 180 px max.
7. **Phone opens scrolled to History.** HistoryPanel's `scrollIntoView` scrolls the whole page once the panels stack. *Change (done in this round):* scroll the list itself.
8. Kept: the pressed wobble (variant b of five tried: frequency 0.02, scale 2) reads as slightly hand-drawn without tearing at corners; the plan drawings on Home; the red-pencil loop and note.

Round 1 was shot on the synthetic lounge, before main had a Room Setup for the real Scan; the rounds after it use the real Scan.

## Rebase onto main, and a real Scan

Main gained the Realism toggle (#17), the splat look (#16), and a Room Setup for the real Polycam Scan, `lounge-v1`. From here every shot uses that Scan, the room the demo is about, and `before` was re-shot from main (`8bdd641`) in a temporary worktree with only the ready flag added.

- **Shots are at the Quick level**, the Scan's textured mesh. At Real, the splat look (#16) renders the room as an unaligned splat at 10–14 fps on this M3 Pro, before and after this branch alike; `editor-real-*.png` shows it at the default level in both.
- **Same canvas, same pixels.** The editor keeps main's frame around the view (TopBar 44 px, footer 24 px, panels 280 and 300 px; the Inspector/History split in eighths so the rows lay out to whole pixels), so the canvas is exactly 860×832 at 1440×900 in both. A lossless read-back of the empty lounge Design differs from main in 109 of 155,896 interior pixels (0.07 %, max 15/255): all at 1-px holes in the scan mesh, where the backdrop shows through.
- **The old Fit chip bug is real on main too:** `before/fit-warning-*.png` has the red outline but no "Blocks the door".

## Round 2

Fixes from round 1, on the real Scan. Frame rate 60.1 fps (before: 60.2), with a Piece selected, a Fit warning up, and the camera orbiting.

What's off:

1. **`≈` still reads as `=`.** JetBrains Mono's `≈` is as small as Plex Mono's at 11–13 px. *Change:* draw that one character from a system sans (a `unicode-range` face in front of the mono), so every price keeps its "about".
2. **Resize draws two boxes.** The ink box and the dashed Resize guide sit on the same edges at first and read as one muddled box. *Change:* while a Resize is open on the selection, the guide replaces the ink box.
3. **Vertical dimension labels read top to bottom.** A plan reads from the bottom or the right. *Change:* keep label angles in [−90°, 90°).
4. **"Blocks the door" doesn't show which floor.** The lounge's doorway doesn't swing, so no arc is drawn and the loop sits next to an unmarked opening. *Change:* draw the clear zone of a door that doesn't swing (0.6 m in front of it, the Fit rule's zone) dashed in red pencil, as the arc is for one that does.
5. **Backdrop.** Holes in the scan show the backdrop, so its color is part of the room's image. *Change:* keep main's exact backdrop as a token of its own (`--desk`), so the room is pixel-identical.
6. **Phone TopBar wraps into three ragged rows** (Scans and the toggles, then the cart alone, then the Design). *Change:* row 1 is back, the Design (truncating) and the cart; row 2 is the two toggles, Realism left and View right.
7. Kept: dimension labels along their lines; the callout's side; the schedule-style shopping list; Home's plans on the real Scan (the lounge's doorway reads as a gap in the west wall).

## Round 3

All six changes from round 2 are in: `≈` reads at every size (a system-sans face for that one character), the Resize guide replaces the ink box, vertical labels read from the bottom up (any line steeper than 80° on screen), the doorway's clear zone is dashed in red pencil, the phone TopBar is two rows, and the backdrop is main's. Also: History fades its top edge once it has scrolled, and a History row clicked to select its item now shows the full sketch (the hovered row *was* the selection, so the box alone showed). Frame rate 60.3 fps.

Checks outside the screenshots:

- **Room pixels:** a lossless read-back of the empty lounge Design now matches main exactly: 0 of 170,194 room pixels differ (max delta 0).
- **Keyboard:** 60 Tab stops in a row, every one with a visible 2 px wash ring; Enter opens the shopping list and Esc closes it, focus back on its button; Enter on a History row selects its Piece.
- **Reduced motion:** 40 ms after a selection the ink box is whole, and the callout's leader has no animation.
- **Hover** (in the Superset browser pane, over CDP): cards and History rows take the ink wash; tabs and the back link go from graphite to ink; a swatch's border goes to ink.
- **Bundle:** +4.1 KB of gzipped JS over main (1,329,845 → 1,334,023 bytes), +2.7 KB of CSS. No new dependency: the wobble is an SVG filter and seeded jitter, not rough.js.
- **Sketch lines** on, and **Walk** with a selection (outside the required views): both read cleanly.

What's off:

1. **The callout's slip is heavier than the note it carries:** a `--pencil-strong` border makes it read as a tooltip. *Change:* the lighter `--pencil` hairline.
2. **An open popover's button looks like any other.** *Change:* while open, the button gets the wash, like a pressed control, so the panel visibly belongs to it.
3. **A Fit loop can blow up in Walk** when the item straddles the camera: corners behind it project to the far side of the screen. *Change:* the loop hides while any corner is behind the camera.

## Round 4: reviews, then `final`

The three round-3 changes are in: the callout's slip has the lighter `--pencil` hairline, an open popover's button gets the wash and the pencil line, and a Fit loop hides while the item straddles the camera. Then two reviews.

**Simplify** (four reviewers: reuse, simplification, efficiency, altitude). Fixed:

- One `dollars`, `priceEstimate`, `inches`, `cm` and `cmSize` in `ui/format.ts`. The callout and cart wrote "$1,240" where the Inspector wrote "$1240", and the floor's 30″ was the Inspector's 29.9″. They agree now.
- InkLine fills its line geometry in place. A new geometry made drei dispose the material too, which recompiled the line shader on every move of a Resize drag.
- InkBox, Dimensions, Callout and FitMark are memoized, and they write label styles only when those change.
- `SketchSelection` owns its Hud, so the pass-through `SelectionOutline` is gone. One shared screen projection, one `boxEdges`, one dash constant.
- Buttons are `inline-flex` once in base.css, not six times.
- shoot.ts has one loop over all viewports and exits non-zero if a view fails.
- A test now holds the red-pencil door zone to `checkFit`'s door-swing zone, which `door.ts` has to copy because `shared/` doesn't export it.

Skipped:

- Putting base.css in `@layer`. The `.editor` prefix convention predates this branch.
- Patching drei instead of `Label`.
- Caching the Sketch lines' edges. That is a one-time hitch on a toggle that is off by default.

**Code review** (standards and spec). Fixed:

- The hand face had slipped onto the view's loading message; that is now sans. Home's tagline is now the heading's subtitle in an `<hgroup>`.
- The Scan names on Home were hand-lettered, which put 25–29 % of Home's text in the hand. They are set in the sans now.
- The Fit loop and the plan walls drop to 1.5 px.
- `muted` is back next to the new class names.
- "Floor plan" (a Glossary avoid-word) is out of the comments.
- A hovered History row's item gets its ink box *alongside* the selection's sketch, as main showed both.
- The callout's leader measures the item on screen and climbs until the label clears it.
- The ready flag is set after the first frame is drawn, not just before.
- Pressed controls alternate two wobble seeds.
- Shots are WebP: the panels' paper grain kept the largest PNGs over 300 KB even at 64 colors, and palette PNGs banded the photo.

**Measured** on the final code:

| Check | Result |
|---|---|
| Hand-lettered share of the text on screen | 2.8–12.9 % at 1280×800 and 1440×900; ≤ 12 % of each whole page. On a phone's first screen, Home reaches 17 % (the brand heading) and the editor 15 % (one empty-state line over a screen that is mostly room) |
| Overflow | none at 1280×800, 1440×900 or 390×844 (the phone's category chips scroll inside their own row) |
| Bundle | +4.3 KB gzipped JS over main `9772d89` (1,331,375 → 1,335,705 bytes), +2.7 KB CSS |
| Room pixels, Quick | lossless read-back of the empty lounge Design, branch against main: 0 of 170,194 room pixels differ (max delta 0) |
| Room pixels, Real (default) | branch against main differs in 0–15 of 103,183 pixels over four runs (max 13/255); main against itself differs in 0–12 over three. That is the splat's own run-to-run noise |
| Frame rate | 60.2 fps with a Piece selected, a Fit warning up and the camera orbiting (`final/fps.txt`); main 60.1 fps the same way (`before/fps.txt`) |
| Screenshots | 46 WebP, all under 300 KB (largest 122 KB) |
| Tests | `npm run typecheck && npm test`: pass, 433 tests |

The checklist of the brief, against `final`:

- The scanned room renders as before: pixel-identical at Quick, within the splat's noise at Real (above).
- Only tokens: no hex or rgb color in any stylesheet but `tokens.css`. The `theme-color` meta tag repeats `--paper`, since a meta tag can't read a variable.
- The hand face only on headings (with Home's subtitle), callouts, Fit notes and empty states' first lines.
- Contrast: graphite text is 5.9:1 or more on every paper and tint, ink is 12.3:1 or more, and the wash and red pencil are 5.0:1 or more. Focus is a 2 px wash ring on all 60 Tab stops; the keyboard reaches everything but the 3D view itself, whose items History rows select.
- 60 fps with the overlays on; nothing overflows at 1280×800; readable at 390×844 (`final/*-390x844.webp`).
