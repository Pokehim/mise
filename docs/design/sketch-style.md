# Mise sketch style

**Mise: a sketchbook for your real room.** The chrome around the room reads like an architect's concept sketch: warm paper, graphite ink, hand-lettered notes, dimension lines, one watercolor wash, and red pencil for problems. The Scan in the middle stays photoreal. The contrast between the real room and the sketched chrome is the point.

Three rules never bend:

1. **The Scan is never touched.** No filter, grain, tint or texture over the 3D view. Overlays are lines and labels laid on top, like marks on tracing paper.
2. **One accent.** The wash marks what is chosen or active. Red pencil marks problems, and nothing else.
3. **Every mark has a job.** A line separates, measures, points or warns. If it does none of these, delete it.

## Tokens (`web/src/styles/tokens.css`)

| Token | Value | Use |
|---|---|---|
| `--paper` / `--paper-raised` | `#f4efe4` / `#fbf8f1` | Panels / cards, popovers, fields |
| `--desk` | `#f4f1ea` | The 3D view's backdrop: main's color, unchanged, since it shows through holes in a Scan |
| `--ink` | `#27231f` | Text, linework, primary buttons (13.6:1 on paper) |
| `--graphite` | `#5b5349` | Secondary text, icons at rest (≥ 5.9:1 on every paper and tint) |
| `--pencil` / `--pencil-strong` | `#d5ccbc` / `#8c8272` | Hairline rules / field and control borders (3.3:1) |
| `--wash` / `--wash-tint` | `#2d6489` / `#dce6ec` | The one accent: links, focus rings, the Resize guide (5.6:1) / fills under chosen things |
| `--red-pencil` | `#b02a20` | Fit warnings, skipped Edits, failed saves, errors (5.7:1 or more on every paper) |
| `--s-1` … `--s-8` | 4 8 12 16 24 32 48 72 px | Layout spacing: gaps, margins, panel padding. A control's own padding may sit a pixel or two off the grid for optical balance |
| `--r-1` … `--r-3` | 2 3 4 px | All corners. No pills; circles only for History's step bubbles and the Resize handles |
| `--lift` | one faint shadow | Popovers only. Everything else sits flat on the paper |
| `--grain`, `--hatching` | SVG noise, 45° lines | Panel paper; empty and disabled areas |

The 3D overlays read the same tokens at runtime (`scene/sketch/tokens.ts`), so there are no colors outside this file.

## Type

| Face | Where | Never |
|---|---|---|
| **Architects Daughter** (hand) | Headings (with a heading's own subtitle), 3D callouts, Fit notes, the first line of empty states. At most 15% of the text on a screen | Prices, sizes, body text, buttons, inputs, loading messages |
| **Work Sans** 400/500/600 | Body and controls: 14 px in the editor, 15 px on Home | — |
| **JetBrains Mono** 400/500 | Dimensions, prices, counts, History step numbers | Sentences |

## Lines

- **Weights:** 1 px pencil for structure (dividers), 1 px ink for emphasis (the shopping total), 1.5 px ink for selection.
- **Wobble:** selected states only. In the DOM, a pressed control (or a TopBar button whose panel is open) gets a 1.5 px ink border on `::after`, displaced by an SVG turbulence filter in `index.html` (two seeds, alternating). In 3D, the selected item's box has crossing corners and a slight bow on each edge, from a seeded jitter. Neither needs rough.js: the wobble costs no script.
- **Dashed construction lines:** guides. The Resize box, dimension extension lines, the floor a blocked door needs clear.
- **Hatching:** empty and disabled areas (an empty History, a Scan with no Room Setup, a Kept Original's locked tools).

## Icons

`web/src/ui/icons.tsx`: a 16-unit grid, 1.5 px stroke, round caps and joins, `currentColor`. Graphite at rest, ink on hover, wash when active. Never an emoji: 🔒 becomes `<Lock />`, ↺ becomes `<RotateLeft />`.

## In the 3D view (`web/src/scene/sketch/`)

- **Selection:** a 1.5 px ink box with crossing corners and a slight wobble, drawn on in 200 ms.
- **Dimensions:** width and depth on the floor while a Piece or an Original is selected, dragged or resized, with tick ends and a mono label in inches and centimeters. During Resize they show the target size.
- **Callout:** a leader line from the top of the item to a hand-lettered name and a mono price, on the side of the view with more room.
- **Fit warning:** a red-pencil loop round the item as it appears on screen, a hand-lettered note ("Blocks the door"), and the floor the door needs clear (its swing, or the doorway's depth) dashed in red.
- **Sketch lines:** an optional ink edge drawing on Pieces. Off by default, to protect the realism.

## Motion

150–250 ms with `--ease-out`. Lines draw on (dash offset); controls change color, never bounce. Everything is interruptible: a new selection restarts the drawing at once. Under `prefers-reduced-motion`, lines appear fully drawn and only opacity changes.

## Do and don't

| Do | Don't |
|---|---|
| Ring the chosen category with a wobbly ink line over the wash: **(Chairs)** | Wobble every border. Unchosen chips have no border at all |
| Price in mono: `≈ $90 (est.)` | Hand-letter a price or a size |
| Draw a dimension line on the floor next to the selected table | Lay paper grain, sepia or a sketch shader over the room |
| Red pencil for "Blocks the door" | Red for anything that isn't a problem, such as a selected tab |
| Hatch an empty History: *Nothing drawn yet.* | Leave a blank panel, or fill it with a spinner |
| Paper lift under the shopping list popover | Shadows under cards that sit on the page |
