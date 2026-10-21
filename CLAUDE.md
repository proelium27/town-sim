# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Townsfolk is a top-down pixel-art town sim (Vite + TypeScript + PixiJS 8, tests in Vitest). The townsfolk build the town themselves; the player only sets priorities and triggers world events. README.md describes every system and the controls; PRODUCT.md and DESIGN.md hold the UI's audience, tokens and rules.

## Commands

```bash
npm run dev                  # Vite dev server (http://localhost:5173)
npm run typecheck            # tsc --noEmit over src and tests
npm run build                # typecheck + production bundle in dist/
npx vitest run --maxWorkers=2 --minWorkers=1                      # full suite
npx vitest run tests/politics.test.ts --maxWorkers=2 --minWorkers=1   # one file
npx vitest run tests/pantry.test.ts -t "starving kid"            # one test by name
```

- Always pass `--maxWorkers=2 --minWorkers=1`. The tests run multi-week headless simulations, and by default Vitest starts a worker per core. Several agents running the suite at once overheat the machine, so run only the files you touched and the full suite once at the end.
- `tests/diag*.test.ts` are diagnostics gated behind `DIAG=1`; they are skipped in normal runs.
- In the browser, `?seed=N` opens a scratch town that never touches the autosave. `window.sim`, `window.camera`, `select` and `setSpeed` are exposed in every build for poking at a running town (for example `sim.run(minutes)` from the console or a Playwright `evaluate`).

## Architecture

**The sim is headless and deterministic.** `src/sim/` has no rendering dependencies. `Sim` (sim.ts) advances a fixed `STEP` of 0.05 game minutes; each `step()` runs the subsystems in this order: events, seasons, market, politics, life, planner, economy, agents, traffic. All randomness goes through `sim.rng` (seeded), so the same seed always plays out the same way, and any change that consumes the RNG differently shifts the whole later history of a seed.

**Behaviour lives in a few places:**
- `ai.ts`: the utility AI. `buildOptions` scores every action a person could take (weighted by needs, schedule, traits and place); `decide` picks one with inertia; per-action effects run while an action is in its `perform` stage.
- `planner.ts` + `labor.ts`: town meetings choose projects (`roleDemand`, `openSlots`, `allocateRoles` set the crews); labor plans turn projects into chop, haul and build work.
- `defs.ts`: needs, goods, roles, traits and memories as data tables. Add a need or good there, not in the UI.
- The other modules (`economy`, `market`, `seasons`, `health`, `careers`, `growth`, `politics`, `workshop`, `life`, `social`) each own one system, with a `tick*` function that `Sim.step` calls.

**Rendering** (`src/render/`) reads the sim and repaints incrementally, driven by version counters on the sim and map (`propVersion`, `wallVersion`, `groundVersion`, `lawnVersion`, `populationVersion`, `activityVersion`). If you change state the renderer shows, bump the matching counter, and don't bump one for state it doesn't show (a wasted bump forces a repaint). `src/ui/` holds DOM panels over the Pixi canvas.

**Saving** (`save.ts`): `saveSim` serialises the whole `Sim` with `JSON.stringify` and a replacer that handles Maps, Sets, typed arrays and infinities. `loadSim` builds a fresh `Sim` and assigns the saved fields over it, then backfills fields missing from older saves.
- A new field with a class default (`foo = 0`) is already set when the save is assigned, so `sim.foo ??= x` never fires. Check the file instead: `if (!('foo' in rest)) sim.foo = x`.
- Per-person backfills run before the generic `NEEDS[k].backfill ?? 80` loop.
- Cover every new saved field with a test in `tests/save.test.ts` that deletes it from a save and reloads.

**Assets** are Kenney 16px sheets in `public/assets/kenney/`, addressed by sheet and cell in `src/assets/manifest.ts`. Load them through `import.meta.env.BASE_URL` (never a leading `/assets`), because the deployed site lives under `/town-sim/`.

## Tests

Many tests are tuned to one seed's storyline ("on seed 7, a grown-up walks a kid to school"). A behaviour change anywhere can move that storyline and break an unrelated test. Before changing such a test, find out whether behaviour broke or only the story moved (log the scenario with a `DIAG`-gated test), and say in the commit message when a threshold was loosened. For gameplay changes, measure over several seeds for 30 game days rather than trusting one test.

## Deploying and git

- Pushing to `main` deploys to GitHub Pages (https://proelium27.github.io/town-sim/) through `.github/workflows/pages.yml`, which typechecks and builds with `--base=/<repo>/`.
- The repository is public.
- To reproduce the CI typecheck faithfully, run `npm ci && npx tsc --noEmit` in a copy outside the home folder. A stray `~/node_modules/@types/node` once made local typechecks pass while CI failed.
- Work on a branch and open a PR. Never push to `main`, and merge only when the user says so.
