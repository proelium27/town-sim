# Idea bank

Everything from the October 2026 feature brainstorm that did not make the
ten in [FEATURES.md](FEATURES.md). One line each; some overlap with those
ten and would ride along with them. Not a commitment, just a place to look
when the town needs something new.

## Story and legibility

- **Story threads**: the sim notices arcs (a rivalry worsening, a courtship,
  a family going broke) and lets you pin and follow them in the feed.
- **"Why not?" answers** in the Town view: "why hasn't anyone built a
  school?" → "Proposed twice, lost to housing; needs 30 stone."
- **Morning headline**: one wry town-crier line at the top of the feed each
  day.
- **Time-lapse replay**: store a daily map snapshot and play the town
  growing from 18 founders to a city in 30 seconds.
- **History graphs** in the Town view: population, treasury, food days,
  average mood. Keep them small and in-panel, never dashboard tiles.
- **Photo mode / postcards**: hide the UI, frame a shot, export a PNG with
  the town name and date.
- **Overlays**: heatmaps for mood, wealth, foot traffic, illness, warmth
  (the trail system already shows one of these).
- **Speech and thought bubbles**: tiny glyphs (heart, storm cloud, coin,
  hammer) so a conversation reads at a glance.
- **Favorites**: star people so the feed and digest put them first.
- **Picture-in-picture follow**: a small inset tracks one person while the
  main view roams.

## People

- **Hobbies that leave artifacts**: a gardener's flowerbeds, a painter's
  canvases on home walls, a musician in the park at dusk, a woodworker's
  porch bench.
- **Pets**: dogs that follow their owner, cats on windowsills, a stray that
  a kind townsperson adopts.
- **Heirlooms**: a named item (grandma's clock, the founder's hammer) passed
  down by will and shown in the inspector.
- **Personality drift**: traits shift slowly with lived memories (a Grumpy
  with a lot of `caredFor` softens).
- **Feuds across generations**: rivalries inherited by children; a marriage
  across feuding families as a story beat.
- **Burnout and loneliness**: long-term states built from repeated
  `longDay` / `ateAlone` memories, recovered by friends or rest.
- **Nicknames** earned from deeds ("Big Tom", "Doc").
- **Elders as storytellers**: kids gather round a grandparent by the fire;
  raises aptitudes and family bonds.
- **Milestone gatherings**: first day of school, graduation, retirement
  party, anniversaries, a newcomer's welcome dinner, a house-warming when a
  home finishes, founding day.

## World and nature

- **Livestock**: chickens, cows, sheep → eggs, milk, wool chains.
- **Wildlife**: deer at the forest edge, foxes after the hens, birds that
  scatter when people pass.
- **Orchards and beekeeping**: crops that take years to mature, planted for
  the grandchildren.
- **Foraging**: seasonal berries and mushrooms in the forest; kids collect
  them.
- **A river and bridges**: map variety; bridges as a town-meeting project.
- **Mine and quarry**: ore → metal tools, a clear tech step past the
  workshop.
- **More weather**: fog, heat waves (shade and the lake), rainbows after
  rain, the odd bad year (late frost, long winter).
- **Winter play**: snowball fights, sledding, snowmen that melt in spring.

## Economy and production

- **Clothing chain**: wool → tailor → coats that cut Warmth loss outdoors.
- **Mill and bakery**: grain → flour → bread as a better meal.
- **Tavern** as an evening social hub (folded into Features #9).
- **Neighboring towns offscreen**: trade routes, a reputation that affects
  newcomer flow, marriages across towns, rival festivals.
- **Item quality**: a master's furniture lasts longer and lifts mood more.
- **Loans and debt** (folded into Features #9).

## Civic life and culture

- **Votes on symbols**: the town names itself, picks a flag, names streets
  and districts after founders and the notable dead.
- **Monuments**: a statue for a beloved mayor or founder, proposed after
  their death.
- **Laws from town meetings**: "no building on the lakeshore", "every home
  gets a garden" (folded into Features #10 as policies).
- **Emergent traditions**: a world event that lands on the same date twice
  becomes a yearly custom ("Drought Remembrance").
- **School play and sports**: a ping pong league, a footrace at the summer
  fair, champions in the chronicle.
- **The library as memory**: books written by townsfolk; reading one lifts
  aptitudes.
- **Legends**: ghost stories about the cemetery; kids daring each other
  after dark.
- **Make the office belong**: designers draw building styles later builds
  use; engineers keep the treasury books.

## Town form

- **Homes reflect owners**: a Neat Freak's trimmed hedges, a Creative's
  painted door, a Foodie's herb garden, a Slacker's overgrown lawn.
- **Wear and repair**: buildings weather; maintenance becomes laborer work;
  empty houses go derelict and are demolished or reclaimed.
- **Street life**: lamp posts lit at night, wells, benches, fences, a market
  square with stalls on market day.
- **Districts**: the town names its own neighborhoods as it sprawls.

## Player agency (still hands-off)

- **Whisper an idea**: plant a suggestion someone might raise at the next
  meeting, if they are persuasive enough.
- **Decrees**: rare and costly ("declare a holiday", "ration food").
- **Light god-mode**: a blessing (one family's good harvest) or mischief (a
  stray dog moves in).
- **Scenarios**: aging village, frontier camp with no houses, after the
  flood, city in decline. Picked with the seed.
- **Goals and achievements**: five generations, a centenarian, a city by
  Year 10, a winter where nobody was cold.
- **Edit people**: rename, nudge a trait, choose who arrives as newcomers.

## Watching and comfort

- **Ambient sound**: birds by day, crickets at night, rain, festival music,
  hammering at a build site. Volume slider and mute.
- **Browser notifications** for major events only, opt-in.
- **Mobile / PWA install** for checking in from a phone.

## Tech that unlocks the rest

- **Sim in a Web Worker** so towns of 100+ stay smooth and catch-up runs
  fast.
- **Save slots and a town gallery** beside the existing autosave/import/
  export.
- **Deterministic replays** from seed + event log; makes time-lapse nearly
  free.
- **Fully data-driven definitions** (`defs.ts` is nearly there) so new
  buildings, goods and events can be added as data or mods.
