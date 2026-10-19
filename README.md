# Townsfolk

A top-down pixel-art civilization sim where the townsfolk build the town themselves. You never place a building: you watch, set the town's priorities, and throw world events at it.

Eighteen founders start in a small town (an office, a café, a market, a library, six homes, a farm and a storehouse) surrounded by forest, rock and a lake. From there they hold town meetings, decide what the town needs, pick sites, clear trees, haul timber and stone, and build homes, farms, a school, diners, parks and storehouses. People fall in love, move in together, have children who inherit their traits, grow up into jobs, retire and die; newcomers arrive along the east road when there's room. Each person has needs, traits, skills, a schedule, memories and opinions of everyone else, and decides what to do next with a utility AI.

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
| Scroll / pinch | Zoom (0.5× to 6×) |
| Click a person | Open their inspector |
| Tab / Shift+Tab | Cycle through people |
| F | Follow the selected person |
| Space | Pause / resume |
| 1 2 3 | Speed (1× is one game minute per real second) |
| / | Search the people list |
| T | Switch the left panel between People and Town |
| R | Lift every roof to see inside (they also lift when you zoom in or select someone indoors) |
| P | Collapse / expand the left panel |
| L | Expand / shrink the activity log |
| Esc | Close the inspector |

## How the town builds itself

- **Town meetings** (`src/sim/planner.ts`): every couple of hours the town weighs its needs: homeless families, couples who want a place of their own, overcrowded homes, food production against appetite, kids without a school, crowded cafés, the lack of green space. The best proposal is put forward by the person it matters most to ("Nia proposed a new home because Nia and Dara want a home of their own").
- **Sites**: the planner scans for open land near town, prefers fewer trees to clear, and routes a dirt path from the new door to the nearest street.
- **Construction** (`src/sim/labor.ts`): builders and laborers clear the site (the timber and stone go straight into the build), haul the rest from the storehouse, then build. Walls rise and scaffolding goes up as work progresses.
- **Economy**: woodcutters keep the stockpile topped up from the forest (which slowly regrows); farmers harvest and tend crops; food flows from farms to the storehouse to the market, kitchens and diners; households cook from their own pantry.
- **Jobs**: flexible roles (builder, farmer, woodcutter, laborer, teacher, cook) are reassigned as the town's needs change. Office, café, market and library staff keep their jobs.
- **Generations** (`src/sim/life.ts`): two years pass per game day. Kids are born to couples with a spare bed, go to school once there is one, and come of age at 18; people retire at 66 and die of old age; grief spreads to family and friends.

## What you control

- **Priorities** (Town view, `T`): Housing, Food, Wood & stone, Community, each Low / Normal / High. They weight what town meetings choose and how many people work each job.
- **World events** (Town view): hold a festival, a bumper harvest, send newcomers (even if there's no room, which forces a housing push), a drought, a storm.

## What's simulated

- **Needs:** Energy, Hunger, Hygiene, Social, Fun, Productivity (plus a hidden bladder that drives restroom trips).
- **Utility AI** (`src/sim/ai.ts`): every few minutes each person scores options (work, standup, eat at the office/café/home, cook, coffee, snack, sleep, shower, restroom, chat, ping pong, piano, read, relax, stroll, groceries, fix the coffee machine, party), weighted by needs, schedule, traits and location, with inertia so they don't dither. The inspector shows what they're doing and why.
- **Roles and tasks:** engineers, designers, a writer and a team lead at desks; an office manager at reception; a barista, shopkeeper and librarian at counters. Tasks progress with skill, mood and energy, have due dates, and complete or slip.
- **Traits:** Introvert/Extrovert, Workaholic/Slacker, Foodie, Neat Freak, Early Bird/Night Owl, Cheerful/Grumpy, Competitive, Creative.
- **Social:** conversations go well or turn into arguments based on compatibility, mood and history; people bond while eating, meeting, playing and partying; friendships and rivalries are announced in the feed.
- **Town events:** daily standup, surprise pizza, Friday party, the office coffee machine breaking (an engineer or the office manager fixes it), rain, traffic with pedestrians who wait at the curb.
- **Pathfinding** (`src/sim/nav.ts`): 8-way grid A* that won't cut wall or furniture corners and prefers sidewalks and crosswalks over roads, with a cached connected-regions check so unreachable targets fail instantly.

## Project layout

```
public/assets/kenney/   Kenney CC0 sheets (city, urban, indoors) with their licenses
src/assets/             manifest.ts: every frame by sheet+cell; loader.ts: textures, outfit recolouring, avatars
src/world/              map.ts: mutable tile grid, rooms, buildings, props; town.ts: starting town + wilderness;
                        blueprints.ts / stamp.ts: building templates the townsfolk construct
src/sim/                sim.ts (clock, step), ai.ts, planner.ts, labor.ts, life.ts, economy.ts, agents.ts,
                        social.ts, events.ts, traffic.ts, nav.ts, defs.ts
src/render/             worldView.ts (live ground/walls/props, construction sites), agentsView.ts (people, cars, badges, rain),
                        shading.ts (lawn detail, cast shadows, ambient occlusion), lighting.ts (time-of-day grade, night lights)
src/engine/camera.ts    smoothed camera with viewport-aware clamping
src/ui/                 hud (top), tracker + town panel (left), activity (bottom), inspector (right, tabbed), relationship graph
PRODUCT.md, DESIGN.md   design context: who it's for, tokens, layout and rendering rules for new UI
tests/                  nav + town connectivity, daily routine and event tests
```

The sim has no rendering dependencies, so it runs headless in tests (two simulated weeks of a growing town take about 13 seconds).

## Tiles

16×16 pixel tiles rendered at 2× by default with nearest-neighbour scaling. To swap in another 16px pack (LimeZu Modern Interiors, for example), edit `src/assets/manifest.ts`; nothing else references sheet coordinates.

## Credits

Art by [Kenney](https://kenney.nl): RPG Urban Pack, Roguelike Modern City, Roguelike Indoors. Public domain (CC0); licenses are alongside the sheets.
