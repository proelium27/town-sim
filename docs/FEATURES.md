# Ten features worth building

The ten ideas from the October 2026 brainstorm with the most story, the most
systems touching each other, and the most to show on screen. Each one is
written up as: what the player sees, how it would work against the code that
exists, what it touches, and what is still undecided. Everything else from
the brainstorm is in [IDEA-BANK.md](IDEA-BANK.md).

Ground rules carried over from PRODUCT.md: the player never places a
building, every "why?" is answerable in one click, and new systems slot into
existing surfaces (feed, inspector, Town view) rather than adding panels.

---

## 1. While you were away

**What you see.** You come back to the tab after lunch, or the next morning,
and a single card sits over the world: "While you were away (6 hours):
Ula won the election by two votes. Mara and Theo had twins. Old Bram died in
his sleep; the whole east row came to the burial. The storehouse is down to
three days of food." Each line is a link that selects the person or pans to
the place. Dismiss it and the town is simply running, caught up.

**How it works.**
- The sim already runs headless and fast (two weeks in ~13 s). On tab return,
  compare the wall clock to the autosave stamp and offer to simulate the gap
  at a capped rate (say up to 24 game hours, with a progress bar over the
  world), or just resume. A setting picks the default.
- During catch-up, render nothing per step; instead collect the feed into a
  buffer and rank it. Ranking uses what the feed already knows (tone, whether
  the memory is `major`) plus a few hard rules: deaths, births, elections,
  new buildings, tier changes and disasters always make the card; chats and
  coffee never do. Cap at six lines, then "and 41 smaller things" linking to
  the activity log.
- Starred people (see Idea Bank) rise to the top of the card.
- Catch-up must not run forever on a tab left closed for a week: after the
  cap, note "the town slept" rather than simulating a month of births and
  deaths nobody watched.

**Touches.** `save.ts` (timestamp), `main.ts` (visibility/focus events,
catch-up loop), `ui/activity.ts` (shared ranking of feed lines), a new
`ui/digest.ts`.

**Open questions.** Should catch-up run the renderer at all, or show a
time-lapse of the map at 1 frame per game hour? Does the digest belong in the
log as a pinned entry so you can re-read it?

---

## 2. Director mode

**What you see.** Press a key (or leave the mouse alone for two minutes) and
the camera starts cutting on its own: a slow push on the rally in the park,
a hold on two rivals arguing outside the café, a cut to the first snow
falling on the market square, then to a kitchen where a family sits down to
dinner. A caption in the HUD says who you are looking at and why, in the
inspector's own words ("Nia · heading to the workshop because tools are
low"). Any input hands the camera back.

**How it works.**
- A scorer runs every few seconds over candidate shots: planned events
  (`events.ts` plan entries: rallies, birthdays, festivals, trader), social
  moments (an argument or new-friend memory in the last minute), labor
  milestones (a roof going on, a site being cleared), weather changes, and
  one "quiet" category (a lone walker at dusk, kids playing) so it is not
  all drama.
- Shots have a type: *hold* (static, 8–15 s), *follow* (reuse the F-follow
  camera), *establishing* (zoom out over the whole town, used after a big
  event or every few minutes). Avoid cutting back to the same subject within
  a minute; prefer variety across the map.
- Respect `prefers-reduced-motion`: cuts instead of pushes.
- Captions come from the same "what and why" string the inspector already
  builds, so there is no second source of truth.

**Touches.** `engine/camera.ts` (scripted moves), `main.ts` (idle detection),
a new `ui/director.ts`; reads `events.ts`, agents' current action and reason.

**Open questions.** Should director mode also be the attract screen on a
fresh load? Can it drive the digest (idea 1) by snapshotting the shot it
would have picked at each major event?

---

## 3. Courtship, weddings and funerals

**What you see.** Two people who keep ending up at the same table start
taking evening walks together, then one proposes (a memory, a feed line, a
small bubble). A wedding is held in the park on the next festival-free
evening: both families walk over, there is food on a table, music if anyone
has the skill, and a toast from the mayor or a parent. When someone dies,
the household lays them out for a day; the next morning a procession walks
from the house to the cemetery, the person's closest friend or child says
a few words built from their memories ("She helped raise the school and
never missed a Harvest festival"), and people go home changed.

**How it works.**
- *Courtship* replaces the current "fell in love → moved in" jump with
  stages stored on the relationship: interested → courting → engaged →
  partners. Each stage gates behaviors (walks, shared meals, visits to the
  other's home) and has a decay path (one of them drifts away, a bad
  argument, a rival suitor). Breakups create `heartbroken` memories and a
  cooling period, and the feed reports them without melodrama.
- *Weddings* reuse the birthday/festival gathering code in `events.ts`:
  a planned event with a host pair, a venue (park, or the couple's home if
  it is raining), an invite list from family and friend ties, catering from
  the household pantry or the diner, and a `wedding` memory for guests with
  a bigger one for the couple. The couple only looks for a home of their
  own once engaged, which gives the planner's "couple wants a home" proposal
  a visible cause.
- *Funerals* hook the existing death path in `life.ts`. A short lying-in
  state keeps the body at home (no sprite horror; a closed door and a wreath
  is enough), then a procession is a group-walk to the cemetery using the
  same side-by-side walking logic as evening walks. The eulogy picks the
  three most-stacked major memories from the deceased's life and the
  speaker is the strongest tie present. Attending softens grief faster than
  the current grave visits alone.
- Widows and widowers can remarry after a mourning period; children keep
  both parents in the family tree.

**Touches.** `social.ts` (stages), `life.ts` (death path), `events.ts`
(gatherings), `ai.ts` (scores for walks/visits/attending), inspector
(relationship tab shows stage), `render/agentsView.ts` (procession, wreath).

**Open questions.** Arranged by the sim or ever nudged by the player
("whisper")? How long should mourning block a remarriage at two years per
day? Do weddings cost the treasury anything or come from the families?

---

## 4. Life aspirations

**What you see.** Open anyone's inspector and under their traits is a line:
"Wants to run the workshop one day" or "Wants a house with a view of the
lake" or "Wants to see her children grown and settled." Hover and you get
how close they are and what is in the way. When an aspiration lands, it is
the biggest memory in the game; when it is clearly lost (a rival became
master first, the person retired), there is a quiet feed line and a smaller
sad memory, and they pick a new one suited to their age.

**How it works.**
- Each adult holds one *life* aspiration and one *season* aspiration
  (small, two-day goals: "finish the east wing", "win the footrace", "make
  up with Tomas"). Children have none until 14 or so, then a "dream" that
  feeds career choice in `careers.ts`.
- A table in `defs.ts` lists aspirations with: eligibility (traits, age,
  role, family state), a progress function (pure read of sim state), a
  completion check, and an abandonment check. Examples: *Master a craft*
  (skill ≥ threshold), *Be mayor* (win an election), *Raise a big family*
  (three children), *A home of our own*, *Outlive my rival* (dark; only for
  Competitive + a long-standing rivalry), *See the town become a city*,
  *Never miss a festival*, *Be the one who built the clinic*.
- Aspirations feed utility scores in `ai.ts` as a mild, persistent bias
  (a would-be master spends more evenings at the bench; a would-be mayor
  chats more and takes on proposals). They also feed the planner: a person
  with *A home of our own* proposes a home sooner and more persuasively.
- Elections (idea 10 and `politics.ts`) get a natural candidate pool:
  people whose aspiration is to lead.

**Touches.** `defs.ts`, `agents.ts` (state), `ai.ts` (bias), `planner.ts`
(proposal weight), `careers.ts` (dreams), inspector.

**Open questions.** How visible should progress be: a number, or only
prose? Should the digest/chronicle call out fulfilled aspirations?

---

## 5. Town chronicle and family tree

**What you see.** A "Chronicle" tab in the Town view. The top entry is this
year's page, still being written: "Year 6. The winter was hard; the fields
froze before the beans came in and the town bought food from the trader
twice. In spring Ula beat Dara for mayor on a promise of homes. The Okafor
wing was finished in summer. Bram Ellis died at 71 and was buried beside
his wife." Below it, earlier years. Click any name to open that person
(alive or dead); click a dead person and their inspector shows an obituary
and a family tree you can walk up to the founders and down to the babies.

**How it works.**
- Each day the sim appends a small set of *chronicle facts* (structured
  records, not prose): births, deaths with age and cause, weddings,
  elections and margins, buildings started/finished, tier changes, worst
  food/firewood days, world events, aspirations fulfilled. Facts are stored
  in the save; prose is generated on demand from templates with a bit of
  variation so two years do not read identically.
- The office **writer** finally has a town job: when a writer exists, the
  year page gets a byline and a sentence or two of colour drawn from their
  own memories ("I was at the wedding; the rain held off"). Without a writer
  the chronicle is terser. This is cosmetic, but it folds the office into
  the village story.
- Obituaries pick the person's most-stacked major memories, their trade,
  who they left behind, and one superlative if they held it (oldest, most
  buildings, longest-serving mayor).
- The family tree is a small canvas drawn from the parent/child/partner
  ties already in `agents.ts`; dead people are greyed with dates. Reuse the
  relationship-graph renderer where possible.
- Headstones in the cemetery become clickable and open the same obituary.

**Touches.** new `sim/chronicle.ts`, `save.ts`, `ui/townPanel.ts` (tab),
inspector (obituary, tree), `render/worldView.ts` (headstone hit-test).

**Open questions.** Keep the facts forever or compress old years? Should the
chronicle be exportable as a text file alongside the save?

---

## 6. The lake

**What you see.** The lake stops being a blue edge of the map. In spring a
town meeting proposes a dock; once it is built, a fisher walks out each
morning and comes back with a basket. Kids skip stones and paddle in
summer. In winter the lake freezes, people skate in the afternoons, and the
fisher cuts a hole in the ice. On a hot day half the town is on the shore.
Couples' evening walks prefer the shoreline path.

**How it works.**
- New building: `dock` (outdoor, cheap, must touch water, one-tile pier).
  New role: `fisher` (flexible, outdoors). Fish are plain `food` with a
  seasonal yield curve: steady in spring/summer, better in autumn, low but
  non-zero through the ice in winter. This is the point: fishing is the
  first food that does not stop at the first frost, so it changes the
  winter stores calculation in `seasons.ts` and the Town view's "days of
  food" readout.
- Lake states: open, freezing (no one walks on it), frozen (walkable,
  skating as a Fun activity, and a shortcut the pathfinder can use), thaw.
  Driven by season and a cold-streak counter so a mild winter may never
  freeze solid.
- Shore tiles get a `shore` flag so `ai.ts` can score "sit by the water"
  (Fun + Social, heat relief in summer) and so the planner can refuse to
  build on the last stretch of open shore (a nice first town "law").
- Risks to keep it honest: a thin-ice accident in early winter is a health
  event; a storm keeps the fisher home.

**Touches.** `world/town.ts` and `map.ts` (water/shore flags, freeze state),
`blueprints.ts` (dock), `defs.ts` (fisher role), `labor.ts` (fishing task),
`seasons.ts`, `nav.ts` (walkable ice), `render/worldView.ts` (ice, pier),
`ai.ts`.

**Open questions.** Should fish be its own good (spoils, sells to the
trader) or stay as food? Boats later?

---

## 7. Fire

**What you see.** A dry summer, a hearth left burning, or a lightning storm:
smoke, then flames on a roof. The feed goes red. Whoever is nearest runs for
the well; neighbors form a bucket line between well and house; the family
stands outside. Either the fire is beaten and the house stands scorched with
a wing to rebuild, or it spreads to the next roof and the town loses a
street. The next town meeting proposes a well on that side of town, and
later a fire station with a bell. For a few days after, people check their
hearths, and the memory lingers for years.

**How it works.**
- Each building carries a `fireRisk` from: season dryness, hearth use
  (ties to firewood/warmth), age/wear if that lands, and lightning during
  storms. Ignition is a per-day roll kept rare (a town should see a fire
  every few in-game years, not every summer).
- Fire is a tile-level state on roof/wall tiles with spread probability to
  adjacent flammable tiles, modified by rain and by material: the planks-
  and-bricks homes that the workshop enables burn slower than raw timber,
  which gives the workshop chain a second reason to exist.
- Response is an emergency interrupt in `ai.ts`: adults within range drop
  their action for `fight fire` if a water source is reachable; the bucket
  line is a chain of short carry tasks between the nearest well and the
  fire. Kids and the frail are moved away. Fighting a fire can injure
  (health system).
- Aftermath: damaged tiles become `ruin` tiles that block rooms. The planner
  gets a `rebuild` proposal that reuses the wing/build machinery in
  `labor.ts`, prioritized like homes for the homeless. The displaced family
  lodges with kin (there is already logic for children going to family).
- New buildings: `well` (tiny, outdoor, increases response radius) and
  `fire station` (a bell that pulls people from further away, a cart that
  speeds the bucket line). A `fire` world event in the Town view for
  players who want the drama on demand.

**Touches.** `map.ts` (tile states), `events.ts`, `ai.ts` (interrupt),
`labor.ts` (rebuild), `planner.ts` (well/station proposals), `health.ts`,
`render/worldView.ts` and `particles.ts` (smoke, flame, scorch).

**Open questions.** Can a fire kill someone? Probably only the frail or
someone asleep upstairs, and rarely; the game is cozy. Does insurance (a
treasury payout) exist, or does the town just build?

---

## 8. Travelers between towns

**What you see.** In the inspector, "Send on a journey" exports one person
or a whole household as a small file. A friend imports it in their town: a
few days later a cart arrives on the east road with "Mara Okafor, a mason
from Millbrook, and her two kids." She carries her skills, traits, memories
(the big ones; she talks about the fire back home), her aspiration, and a
line in the chronicle. Your chronicle records that she left. Later you can
import a letter back: "Mara married a farmer there; they named the baby
after her father."

**How it works.**
- A traveler file is a versioned JSON of the agent (and household) minus
  anything tied to map coordinates, plus the origin town's name and seed.
  Memories about specific people become memories about "someone back home."
- Import validates like `save.ts` does, then queues the arrival through the
  existing newcomer path (east road, housing push if there is no room).
  Names clash gracefully (the sim already handles namesakes with numerals).
- The departing town keeps a tombstone-free "moved away" record, and the
  family tree shows them greyed as "in Millbrook". Grief memories do not
  fire; `missYou` ones do, for close ties.
- No server needed. Later, a URL hash could carry a traveler the way
  `?seed=` does.
- Guardrails: imports are capped per day, a traveler cannot carry goods or
  money beyond a small purse, and the file is just data (no code).

**Touches.** `save.ts` (schema sharing), `life.ts` / newcomer arrival,
inspector (export), `ui/saves.ts` (import), chronicle.

**Open questions.** Letters back (a second export type) now or later?
Should a traveler remember and mention real names from home when a
chronicle exists on both ends?

---

## 9. Private businesses and personal wealth

**What you see.** Every shop today is the town's. With this, a restless
cook with savings opens a bakery of her own next to the market; the
tavern someone builds becomes where arguments start and courtships advance;
a carpenter sets up a furniture shop and gets rich when the building boom
hits, then struggles when it stops. The Town view's money section gains an
"Businesses" list with owner, takings and staff. The inspector shows wealth
not as a number first but as a sentence: "comfortable", "scraping by",
"the richest person in town".

**How it works.**
- A new planner proposal type, *private*: an adult with a qualifying
  trade, enough savings, and the right traits (Workaholic, Competitive,
  Creative, Extrovert) proposes a business for themselves at the town
  meeting. The town still approves the site and a land price; the owner
  pays the build cost (or takes a treasury loan, below). This stays inside
  "the player never places a building."
- Business types to start: bakery (buys food, sells meals at a margin and a
  mood bonus), tavern (evening social hub, sells drink, music nights if a
  musician is around), furniture shop (buys planks, sells furniture; new
  homes can source furniture here or from the workshop), general store
  (competes with the market on price). Each is a blueprint plus a small
  pricing rule in `market.ts`.
- Owners pay staff wages themselves and pay the town tax (reuse the office
  15% rule). Prices float against the town shop's prices, so a private
  store undercuts in a glut and gouges in a shortage; a mayor's policy
  (idea 10) can cap prices.
- Personal wealth gets meaning: rent for a private home, savings passed to
  children at death (wills, which also pass heirlooms if those land),
  charity: a rich family hosting the broke neighbors for dinner is a
  memory for both.
- Failure path: a business that loses money for a season closes; the
  building converts to a home or is bought by the town.
- Treasury loans: the mayor can lend to a founder or a struggling family;
  repayment or default is a chronicle line.

**Touches.** `market.ts`, `planner.ts`, `blueprints.ts`, `economy.ts`,
`defs.ts` (owner roles), `ui/townPanel.ts`, inspector.

**Open questions.** How unequal is too unequal for a cozy game? Probably
cap how rich anyone can get and make generosity common. Do private shops
replace the town-run ones over time, or coexist by design?

---

## 10. Mayors with real power, and the people's answer

**What you see.** Elections already happen. Now winning matters: the
mayor's platform becomes a policy you can read in the Town view ("Tax 20%,
festivals every season, no building on the lakeshore, curfew during the
outbreak"). The town remembers the promise: a year on, the chronicle says
whether it was kept. When the mayor is unpopular, a crowd gathers with
signs outside the town hall; if it keeps up, a petition forces a recall
vote. Town meetings move into a town hall you can watch, with people at the
table arguing in bubbles.

**How it works.**
- Policies are a small table in `defs.ts`, each with a lever the sim already
  has or nearly has: tax rate (`market.ts`), festival budget/frequency
  (`events.ts`), build-site rules for the planner (lakeshore, farmland,
  density), rationing in a food crisis (`seasons.ts` consumption), bonus
  split for town workers (`economy.ts`), school hours, price caps for
  private shops (idea 9). A mayor picks policies from their platform and
  traits on taking office and can change one per season.
- Approval is a per-adult number derived from how the mayor's policies have
  touched them (taxed, housed, fed, rationed), their own opinion ties
  (`social.ts`), and family loyalty, the same inputs that already weigh
  votes. The Town view shows approval as a sentence and a trend, not a
  gauge.
- Protests: when approval falls below a threshold for two days, the
  unhappiest adults schedule a gathering at the town hall or park (reuse
  the rally event). A protest with enough of the town present opens a
  petition; if it hits a majority within a day, a recall vote happens that
  evening using `politics.ts`. Mayors can head it off by changing a policy,
  which the feed reports as a climbdown.
- Promise-keeping: each platform plank maps to a measurable (homes built,
  food days, wood stock, festivals held). At the next election the chronicle
  and rally lines say whether it was delivered, and voters weigh it.
- Town hall: a new blueprint proposed on becoming a town; meetings relocate
  there and are rendered as people at a table with issue glyphs. It is also
  where the chronicle lives in-world.

**Touches.** `politics.ts`, `planner.ts`, `market.ts`, `economy.ts`,
`events.ts`, `seasons.ts`, `defs.ts`, `blueprints.ts` (town hall),
`ui/townPanel.ts`, chronicle (idea 5).

**Open questions.** Where do player priorities sit against mayoral policy
when they disagree? The README says the player stays in charge; perhaps the
mayor's agenda is what the town *proposes* while the player's priorities
remain the weighting. Can the player trigger a recall as a world event?

---

## Suggested order

1 (digest) and 2 (director) first: they change how the game is *watched*
and make everything after them land. Then 3 (courtship/weddings/funerals)
and 4 (aspirations), which deepen people without new systems. 5
(chronicle) once there is more story to record. 6 (lake) and 7 (fire) add
new pressure to winter and rebuilding. 9 and 10 share the money and
politics layers and are best done together. 8 (travelers) is independent
and can slot in whenever there are friends to send people to.
