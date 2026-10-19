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
- **Growing homes and town tiers** (`src/sim/growth.ts`): a family with young kids outgrowing its house builds a wing instead of moving: the side wall comes down and the home gets four tiles wider with two more beds (the founders' houses are packed in a row, so it's the town's own newer houses that grow). Grown kids and new couples look for land near their parents. At 30 people and 18 buildings the village becomes a town, and at 50 and 30 a city, each with a charter day festival; a town paves its dirt paths and trodden trails in stone, spreading out from the streets, and can take on more projects at once. The Town view shows the tier and what the next one needs.
- **Elections** (`src/sim/politics.ts`): on the first day of every summer up to three well-liked, persuasive adults stand for mayor (a sitting mayor stands again), each on what matters most to them that nobody else is running on: homes, food, wood & stone, or community. They make their case at a rally in the park at 17:00 ("vote Ula: more homes!"), and at 19:00 every adult votes for the candidate they like best, weighed by whether the platform speaks to their own situation and by family ties. The mayor chairs town meetings and their agenda nudges the planner (×1.25), on top of your priorities, which stay in charge. The Town view shows the mayor, the race and the last vote.
- **Workshop** (`src/sim/workshop.ts`): once the town reaches about 22 people with timber to spare, a town meeting proposes a workshop. Its trades work three kinds of station: a carpenter saws wood into planks and builds furniture at the bench, a mason fires stone into bricks in the kiln, and a toolmaker makes tools from planks and stone. After that, homes, schools, diners and storehouses are built from planks and bricks, and new homes need two pieces of furniture before anyone moves in. Workers pick up fresh tools from the stores and work 25% faster until they wear through. The Town view lists each chain, how stocked it is, and what's holding it up ("Stuck: needs wood", "no mason").
- **Money** (`src/sim/market.ts`): the town's shops are run by the town, so groceries, café meals and coffee pay into the treasury, and the office pays 15% tax on what its outside clients pay. Out of the treasury come town wages (builders, farmers, crafters, shop staff, teachers) and the coins each new building costs; when the treasury can't cover a project it waits (homes for the homeless are built anyway). Prices follow stock: food gets dear when the stores run low and cheap in a glut. Every three days a trader's cart pulls up at the market to buy surplus and sell food, firewood or tools the town is short of. Short of money for groceries, family chip in; a household broke and miserable for two days packs up and leaves.
- **Jobs**: flexible roles (builder, farmer, woodcutter, laborer, carpenter, mason, toolmaker, teacher, cook) are reassigned as the town's needs change. Office, café, market and library staff keep their jobs.
- **Generations** (`src/sim/life.ts`): two years pass per game day. Kids are born to couples with a spare bed, go to school once there is one, and come of age at 18; people retire at 66; grief spreads to family and friends.
- **Health** (`src/sim/health.ts`): colds and flu pass between people who chat, share a table or share a home, more in winter and when they're cold; storms and work accidents cause injuries. The ill call in sick and rest in bed, at home or at the clinic, and family look in on them; rest, care, a doctor and medicine all speed recovery, and recovering leaves a few days' immunity. Frailty builds from about 62 and with every illness, and frailty plus serious illness is what ends a life; the family visits more as someone grows frail. After an outbreak (also a world event) or with several people ill, a town meeting builds a clinic; its doctor treats patients and mixes medicine from herbs the farmers bring in.
- **School and careers** (`src/sim/careers.ts`): kids are born with leanings from their traits and their parents' trades, and build four aptitudes (hands-on, numbers, people, outdoors) in class (more with a teacher at the board) and playing outside. At 18 they pick a trade by aptitude, what their parents do, the adult they most look up to, and what the town has nobody doing (office jobs need a free desk; the trades need a workshop). They apprentice for two days under a mentor, a parent if possible, learning twice as fast and three times as fast at the mentor's side. Job allocation puts people who trained for a trade into it first. Skill and tools change real output: a master works much faster than a novice.
- **Family life**: once a calendar year, on the day they were born, people throw a birthday party at home at 18:00: cake on the table, family comes over (friends too for round numbers like 18, 50 or 80). Households sit down to dinner together. Babies are sometimes named after a grandparent who has passed away.
- **Out and about**: footsteps wear grass into trampled patches and then bare trails along the routes people actually take (and trails are quicker to walk, so they stick); trails nobody uses grass over in a few days. After dinner, couples go for a walk side by side, and on school mornings a grown-up at home walks the little ones to school. Most people carry an umbrella in the rain; the rest hurry and get soaked.
- **Seasons** (`src/sim/seasons.ts`): spring and summer grow crops (summer fastest), autumn slows them and turns the trees copper, and the first frost of winter clears whatever's unripe; nothing grows until spring, so the town lives on what it stored. From late autumn people get cold outdoors (a Warmth need) and warm up at home by the hearth, which burns firewood: woodcutters, laborers and idle winter farmers split logs at the storehouse and carry firewood to the homes running lowest. Autumn brings storms and winter the odd blizzard; each season has a festival in the park (Spring fair, Midsummer night, Harvest festival, Winter lights with a bonfire). The Town view shows how many days of food and firewood are left as winter approaches.
- **Cemetery**: the first death prompts a town meeting to build one; each death adds a named headstone, and family visit the grave now and then, which eases their grief.

## What you control

- **Priorities** (Town view, `T`): Housing, Food, Wood & stone, Community, each Low / Normal / High. They weight what town meetings choose and how many people work each job.
- **World events** (Town view): hold a festival, a bumper harvest, send newcomers (even if there's no room, which forces a housing push), call a trader, a drought, a storm, a blizzard, an outbreak.
- **Saving** (Town view): the town autosaves to your browser every game hour and reopens where you left off. Export downloads a save file, Import loads one, New town starts over (click twice). A `?seed=N` link opens a scratch town that is never saved.

## Calendar

A season lasts two days and a year eight (Spring, Summer, Autumn, Winter); the top bar shows the weekday and season ("Tue · Spring 2"), with the year on hover. Ages run on their own faster clock, two years per day, so families turn over within a few in-game years.

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
src/sim/                sim.ts (clock, calendar, step), ai.ts, planner.ts, labor.ts, life.ts, economy.ts, agents.ts,
                        social.ts, events.ts, traffic.ts, nav.ts, save.ts (save/load),
                        defs.ts (needs, goods, roles, traits and memories as data tables)
src/render/             worldView.ts (live ground/walls/props, construction sites), agentsView.ts (people, cars, badges, rain),
                        shading.ts (lawn detail, cast shadows, ambient occlusion), lighting.ts (time-of-day grade, night lights)
src/engine/camera.ts    smoothed camera with viewport-aware clamping
src/ui/                 hud (top), tracker + town panel (left), activity (bottom), inspector (right, tabbed), relationship graph
PRODUCT.md, DESIGN.md   design context: who it's for, tokens, layout and rendering rules for new UI
tests/                  nav + town connectivity, daily routines and events, the self-building town, save/load
```

The sim has no rendering dependencies, so it runs headless in tests (two simulated weeks of a growing town take about 13 seconds).

## Tiles

16×16 pixel tiles rendered at 2× by default with nearest-neighbour scaling. To swap in another 16px pack (LimeZu Modern Interiors, for example), edit `src/assets/manifest.ts`; nothing else references sheet coordinates.

## Credits

Art by [Kenney](https://kenney.nl): RPG Urban Pack, Roguelike Modern City, Roguelike Indoors. Public domain (CC0); licenses are alongside the sheets.
