# Faster town growth and a real-world treasury

Status: agreed in conversation on 2026-10-20/21. To be built after the performance work (see "Order of work").

## Intent

An hour-long session should feel like watching a town boom. The town starts with 18 founders and ends with **a couple hundred people**. Along the way the player watches three things: buildings going up, the treasury growing bigger, and individual small relationships (friendships, couples, birthdays).

Today, growth stalls. Headless runs of seeds 5, 7 and 42, 150 game days each with no player input, all show the same shape:

- 18 people grow to about 40 by day 25.
- The population then plateaus at 40–55, and buildings stop at about 50 by day 60–65.
- City tier (50 people) is reached only between days 80 and 125, and is barely held.

The clock was already sped up in PR #17: Fastest now runs 60 game minutes per real second, so an hour of play is 150 game days. The player was explicit that **faster growth must come mainly from the game's mechanics, not just a faster clock**. The clock may still go up some more.

## Goals

- About 200 people within an hour of play, growing steadily rather than in a burst followed by a plateau.
- Buildings keep going up for the whole hour.
- The treasury visibly grows as the town grows, because growth pays for itself the way it does in a real town.
- Individual relationships stay followable at 200 people.

## Non-goals

- Making the clock the main growth lever.
- Redesigning relationships, needs, or the utility AI.

## Anti-goals

These would make the work a failure even if it technically worked:

- A town of 200 that the game can't run at full speed. Performance has to keep up (see "Order of work").
- Growth that comes only from spawning people, with no visible homes, buildings or money behind it.
- A treasury that grows by magic rather than from taxing residents.

## Why it stalls today

Found by reading the code; all paths are under `src/`.

1. **Building land runs out.**
   - `findSite` (`sim/planner.ts:310-362`) only accepts sites within 70 tiles of the town centre, on a 132×92 map (`world/town.ts:6-7`).
   - Finished dirt paths, plazas (`sim/planner.ts:459-460`) and farm fields permanently use up buildable ground.
   - With no site there's no new house, so no beds. Newcomers and births both stop.
2. **Both growth channels wait for a spare bed, and beds are only built after a shortage.**
   - Newcomers need at least one free bed (`sim/life.ts:206`) and are put into the first household with room (`sim/life.ts:214`). That fills families' spare beds and blocks births.
   - Births need a spare bed (`sim/life.ts:98`). Extensions only follow overcrowding (`sim/planner.ts:189-197`). So couples stop at about 2 children: replacement level.
   - The only speculative house is a single one at score 0.65, and only when fewer than 2 beds are free (`sim/planner.ts:204-207`).
3. **Every new person costs the treasury money, and residents pay no tax.**
   - The town pays every non-office worker (`sim/market.ts:57-61`), and every newcomer is a town-paid laborer (`sim/life.ts:222`).
   - Revenue is need-driven shop spending (`sim/market.ts:69-75`) plus a 15% tax on a fixed office of about 7 people (`sim/market.ts:11`, desks in `world/town.ts:113-124`).
   - Savings pile up in pockets and vanish on death or departure.
4. **The treasury's own rules keep it flat.**
   - The project cushion is max(250, yesterday's wages) (`sim/market.ts:175-176`), which blocks non-urgent projects when money is short.
   - Midnight bonuses pay out half of everything above max(900, 3×wages) (`sim/market.ts:172-178`, `204-213`).
5. **The planner throttles itself.** It starts at most one project every 2 game hours, with concurrent projects capped at `min(3 + tier, 1 + builders/2)` (`sim/planner.ts:674-683`).

Deaths and departures are not the limit: people live to about 85, and departures are rare.

## Decisions (agreed with the player)

### Treasury: work like a real town

A real town is not everyone's employer. Most people work for private businesses; the town collects taxes and pays for public services. That is why growth pays for itself: more residents means more taxpayers, which pays for more services and housing, which attracts more residents.

- **Residents pay taxes**, so revenue grows with population:
  - income tax on wages
  - sales tax on shop purchases
  - property tax per home, per day
- **Private work.** Farmers, crafters and shopkeepers earn from selling their goods instead of drawing town wages. The treasury pays only public jobs: builders, teachers, the doctor, the librarian.
- **Keep the surplus** as a rainy-day fund and project money. Stop paying it out every midnight as bonuses.
- **Borrowing (optional):** the town can take a loan to build homes ahead of demand, then repay it from taxes, as real towns do with bonds.

### Growth: land, housing ahead of demand, immigration, births

- **Land.** Both of these:
  - Denser housing as the town grows: row houses at Town tier and apartment buildings at City tier, with roughly 8–12 beds on the land a house uses today.
  - More land: the buildable area widens with each tier, and the map grows so the town can spread past today's edges.
- **Build ahead of demand.** Keep about 10% of beds free, paid for from the treasury (or a loan). Town meetings may start more than one project at once when there's money and builders.
- **Immigration is the main engine,** at roughly two-thirds of growth:
  - Arrivals speed up with free homes, open jobs, good mood and a higher tier ("word gets around").
  - Families arrive, not just single laborers.
  - Newcomers get their own home instead of filling a family's spare beds.
- **Births** make up about one-third: couples can have more than two children, and extensions are built as the family grows rather than after it is overcrowded.
- **Pacing:** 200 people in 150 game days is about +1.3 people per day overall.

## Constraints

- **Performance.** At 200 people the sim must still hold full Fastest speed: about 20 steps per 60fps frame inside a 10ms budget (`src/main.ts`), so a step must stay under about 0.5ms. Hot spots that grow with the square of the population are listed in the performance work.
- **Determinism.** Seed-tuned tests in `tests/` assume deterministic runs. Mechanics changes will legitimately change outcomes and need those tests retuned, as earlier phases did.
- **Saves.** Saves carry a version (`sim/save.ts`). New state must load from older saves with sensible defaults, as the health phase did.
- **Feel.** The founders' story and the small relationships the player enjoys must stay visible.

## Left to the builder

- Exact tax rates, wage levels, prices, and the vacancy target. Tune them so the treasury grows visibly but isn't flooded.
- The row-house and apartment blueprints (art from the existing Kenney sheets), and how the map grows: a bigger initial map, or unlocking edges by tier.
- Whether borrowing ships in the first cut.
- How the Town view shows taxes, the budget, and any loan.

## Order of work

1. **Performance first**, as a separate piece of work. Get a 200-person town and the existing day 70–85 slowdowns running at full Fastest speed, with simulation results unchanged.
2. **Treasury.**
3. **Growth.**

Measure population, buildings and treasury over 150-day headless runs on several seeds after steps 2 and 3, using the same harness as the baseline above.
