# Townsfolk

A top-down pixel-art town and office simulator. Twelve people live in six homes, commute across two roads, and spend their days at an office, a café, a corner market and a library. Each person has needs, traits, skills, a schedule, a task list, memories and opinions of everyone else, and decides what to do next with a utility AI.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # sim + pathfinding tests
npm run build      # typecheck + production bundle
```

`?seed=42` in the URL gives a different cast.

## Controls

| Input | Action |
| --- | --- |
| Drag, WASD, arrows | Pan |
| Scroll / pinch | Zoom (pixel-perfect, 1.5× to 6×) |
| Click a person | Open their inspector |
| Tab / Shift+Tab | Cycle through people |
| F | Follow the selected person |
| Space | Pause / resume |
| 1 2 3 | Speed (1× is one game minute per real second) |
| / | Search the people list |
| Esc | Close the inspector |

## What's simulated

- **Needs:** Energy, Hunger, Hygiene, Social, Fun, Productivity (plus a hidden bladder that drives restroom trips).
- **Utility AI** (`src/sim/ai.ts`): every few minutes each person scores options (work, standup, eat at the office/café/home, cook, coffee, snack, sleep, shower, restroom, chat, ping pong, piano, read, relax, stroll, groceries, fix the coffee machine, party), weighted by needs, schedule, traits and location, with inertia so they don't dither. The inspector shows what they're doing and why.
- **Roles and tasks:** engineers, designers, a writer and a team lead at desks; an office manager at reception; a barista, shopkeeper and librarian at counters. Tasks progress with skill, mood and energy, have due dates, and complete or slip.
- **Traits:** Introvert/Extrovert, Workaholic/Slacker, Foodie, Neat Freak, Early Bird/Night Owl, Cheerful/Grumpy, Competitive, Creative.
- **Social:** conversations go well or turn into arguments based on compatibility, mood and history; people bond while eating, meeting, playing and partying; friendships and rivalries are announced in the feed.
- **Town events:** daily standup, surprise pizza, Friday party, the office coffee machine breaking (an engineer or the office manager fixes it), rain, traffic with pedestrians who wait at the curb.
- **Pathfinding** (`src/sim/nav.ts`): 8-way grid A* that won't cut wall or furniture corners and prefers sidewalks and crosswalks over roads.

## Project layout

```
public/assets/kenney/   Kenney CC0 sheets (city, urban, indoors) with their licenses
src/assets/             manifest.ts: every frame by sheet+cell; loader.ts: textures, outfit recolouring, avatars
src/world/              map.ts: tile grid, rooms, props + use spots; town.ts: the hand-laid town
src/sim/                sim.ts (clock, step), ai.ts, agents.ts, social.ts, events.ts, traffic.ts, nav.ts, defs.ts
src/render/             worldView.ts (baked ground/walls, y-sorted props), agentsView.ts (people, cars, badges, weather)
src/engine/camera.ts    smoothed camera with viewport-aware clamping
src/ui/                 tracker (left), activity (bottom), inspector (right), relationship graph
tests/                  nav + town connectivity, daily routine and event tests
```

The sim has no rendering dependencies, so it runs headless in tests (a simulated week takes a couple of seconds).

## Tiles

16×16 pixel tiles rendered at 2× by default with nearest-neighbour scaling. To swap in another 16px pack (LimeZu Modern Interiors, for example), edit `src/assets/manifest.ts`; nothing else references sheet coordinates.

## Credits

Art by [Kenney](https://kenney.nl): RPG Urban Pack, Roguelike Modern City, Roguelike Indoors. Public domain (CC0); licenses are alongside the sheets.
