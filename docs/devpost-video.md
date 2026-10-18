# Mise: 2-minute demo video

The video for the Devpost entry ([`devpost.md`](devpost.md)), for the **Cook Smarter** track. It has 9 shots and 2:00 of narration, about 270 words at a calm pace. The story is that **an AI agent plans the whole room, so the Mover doesn't have to.**

## Before you record

- **The app:** `main` on the M3 Pro, started with `./.superset/run.sh` (or `npm run dev`), in Chrome at `http://localhost:<PORT>`. Generate needs `ANTHROPIC_API_KEY` and `ANTHROPIC_WORKSPACE_ID` in `.env`.
- **The window:** Chrome at 1440 × 900, bookmarks bar hidden, zoom 100%, no other tabs. Record with QuickTime or the macOS screenshot tool (⌘⇧5), with the microphone on, or add the voice over afterwards.
- **Do a dry run first,** so the prompt cache and the models are warm. Then delete the dry run's Designs: `git status data/designs` lists them as untracked files. Also run `git checkout data/scans` so the dorm isn't already in "Your Scans".
- **Use "Start empty" for the dorm.** Generate plans from the room's empty shell. On a dorm opened "Furnished as it comes", the agent lays the room out again and the dorm's own beds disappear, which looks like a bug on camera.
- **Backup:** if Generate fails on the day, open a Design saved from the dry run and narrate shot 5 over it.

## Shot list

| # | Time | On screen | Narration |
|---|---|---|---|
| 1 | 0:00–0:12 | The study lounge in **Walk** view (open the lounge's Design, press **Walk**). Turn slowly toward the window. | "This is a real study lounge, scanned with an iPhone in two minutes. Every wall, door, and window is here at its real size." |
| 2 | 0:12–0:24 | Still the lounge. Switch to **Dollhouse** and turn the room once. | "When you move into a new room, planning it is real work. You measure, you sketch, and you wonder whether the desk fits by the window. Most people guess. Mise hands that job to an AI agent." |
| 3 | 0:24–0:36 | Click **Scans**, then **Import**. Type `Lander`. Click **Start empty** on University of Washington, Lander Hall. The empty room loads. | "No scan yet? Find your dorm. We built ten real first-year rooms from the floor plans universities publish. Here's a double at the University of Washington." |
| 4 | 0:36–0:50 | Click **Generate**. Type the Brief: *Our freshman double: a bed and a desk for each of us, a cozy reading corner, calm and warm, under $1,500*. Click **Japandi**. Click **Generate 3 Designs**. | "You write one sentence: what you need, the feel you want, and your budget. That's the whole Brief." |
| 5 | 0:50–1:08 | The three cards draw themselves live. Hold until all three finish and the footer says "Made in … s". | "Now three Claude agents plan at once: a literal take, a bolder one, and a budget-conscious one. Each reads the room, picks a palette, and places real furniture at true size: beds, desks, lamps, rugs, and art. Every move is checked. Nothing blocks the door, and there's always a clear path to each bed and desk. Three whole-room plans, in about fifteen seconds." |
| 6 | 1:08–1:22 | Click **Open** on the first card. The furnished room loads. Turn the Dollhouse slowly, then scroll the History panel. | "Open one, and the plan is in your room. Each Edit Claude made is in the History, marked as Claude's." |
| 7 | 1:22–1:38 | Drag a desk chair a little. Click the accent wall and pick a new paint color. Click **Undo** once. | "It's a starting point, not a final answer. Move anything, swap it, or repaint a wall. The room's real light stays on it. Every change can be undone, yours or the agent's." |
| 8 | 1:38–1:50 | Press **Walk** and look around the furnished double at eye level. | "Then walk through it at eye level, before you carry a single box." |
| 9 | 1:50–2:00 | Title card: **Mise**, *An AI agent that plans your whole room in seconds*, and `github.com/Pokehim/mise`. | "Mise. Hours of planning, done in fifteen seconds, in your real room." |

## If you need to cut time

- Drop shot 8 (12 s), and end shot 7 on the Walk view instead.
- Shorten shot 2 to one sentence: "Planning a new room is real work. Mise hands it to an AI agent."

## Words to keep, words to avoid

- **Keep** the track's words: *AI agent*, *planning*, *saves time*, *makes moving in easier*.
- **Avoid** shopping words: buying, products, checkout, cart. The budget is part of the plan. Don't open the cart button on camera.
