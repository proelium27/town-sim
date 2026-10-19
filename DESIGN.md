# Design

Scene: a player keeps the town open on a laptop through the day and into the evening, glancing at it like an aquarium. The world swings from bright daylight grass to a dark, lamp-lit night, so the chrome has to read against both: warm charcoal panels that float over a full-bleed world.

## Layout

- The Pixi world fills the window. Nothing docks; every panel floats with a 12px margin from the window edge.
- **HUD** (top center): clock with day phase, weather, town stats, speed. One row.
- **Roster** (top left): compact people list, collapsible (`P`). One 52px row per person. A People | Town switch (`T`) at the top swaps the list for the **Town view**: stat tiles, stores with daily food balance, the player's priorities (Low / Normal / High, marigold only on High), world-event buttons (green square = good, red = bad), projects being built, and town history.
- **Saving** (Town view, last section above History): status line ("saved at 14:02", or why it couldn't) and four quiet buttons. New town is the only red one, and arms on the first click ("Click again to start over") rather than opening a dialog.
- **Feed** (bottom left): latest events, collapsible (`L`); expands to a taller scroll.
- **Inspector** (right): the selected person, tabbed (Now · Needs · Social · Mind) so it never needs a long scroll.
- **Relationship levels**: Nemesis, Rival, Tense, Acquaintance, Friendly, Friend, Close friend, then **Family** above them all: partners, parents, children, siblings, step-family, grandparents and in-laws. Family is listed first with its kinship and opinion, and sits at the top of the graph in rose (the social need hue, `#ea80a6`). Family that fall out below Rival show as estranged. In the sim, family fights cost half the opinion, people lean toward kin when looking for company, and new babies start with a bond to their siblings and grandparents.
- The camera centers on the unobstructed middle (CSS vars `--obstruct-left/right/top/bottom`), but the map may scroll beneath panels.

## Color (OKLCH, warm-tinted neutrals; hue ~60)

| Token | Value | Use |
| --- | --- | --- |
| `--panel` | `oklch(0.24 0.016 60)` | Panel fill |
| `--panel-2` | `oklch(0.29 0.018 60)` | Inset wells, hover |
| `--panel-3` | `oklch(0.35 0.02 60)` | Tracks, pressed |
| `--edge` | `oklch(0.14 0.015 60)` | 2px panel outline and hard shadow |
| `--text` / `-2` / `-3` | `0.95 / 0.80 / 0.64` L, cream | Ink levels |
| `--accent` | `oklch(0.83 0.15 82)` marigold | Selection, primary state, the selected person on the map |
| `--good` / `--warn` / `--bad` | green 150 / amber 70 / red 28 | Status |
| Needs | energy 100, hunger 45, hygiene 215, social 355, fun 300, work 255, mood 150 | Fixed data palette, also used in world badges |

Strategy: restrained. Neutrals carry the chrome; marigold only marks "this one / on". The pixel world supplies the color.

## Typography

- **Rubik** (400/500/600/700) for everything; tabular numerals for clocks, values, percentages.
- Scale: 11 (micro labels, uppercase +0.08em), 12 (secondary), 13 (body), 15 (names), 20 (clock / inspector name).

## Shape, depth, motion

- Radius 10px for panels, 6px for controls, 999px for pills.
- Depth is a hard offset shadow: `0 3px 0 var(--edge)` plus a 2px outline. No blur, no glass.
- Motion: 160–220ms ease-out-quart on opacity/transform only. Respect `prefers-reduced-motion`.

## World rendering

- **Shading** (`src/render/shading.ts`): grass tufts and flowers, interior ambient occlusion under walls, building cast shadows to the south-east, contact shadows under trees and lamps. Baked; rebuilt automatically when the wall/prop layout changes.
- **Lighting** (`src/render/lighting.ts`): multiply-blended color grade by hour (peach dawn, neutral day, amber dusk, deep blue night) and stepped additive light pools for lamps and lit rooms. Stepped (banded) light matches the pixel art.
- **Agents**: marigold selection ring, dark pill name tags, outlined speech bubbles that match the panels. Kids are drawn smaller; workers show what they carry (logs, stone, a basket of crops) above their heads.
- **Buildings** (`src/render/exteriors.ts`): 3/4-view exteriors in the Kenney Modern City style. A roof over the footprint and a front wall (2 to 3 storeys) along the south edge, y-sorted by that edge so people inside are covered and people on the street pass in front. Each type has a material and identity: homes get shingled gable roofs from a dusty palette (terracotta, slate, moss, plum, sand, brown, teal) over brick, sand or stone with wood windows, a colored door and a chimney; the office is a gravel flat roof with skylights and AC over a glass curtain wall; the café and market get striped awnings (green / orange) with their signs; the library is slate and stone with arched windows; the school is terracotta brick with a bell sign; diners get an orange awning and a bowl sign; storehouses are timber barns. North-facing doors show a small porch on the roof edge. Roofs lift (fade) at zoom 3x and up, for the building holding the selected person, or when toggled off with `R`. Cutaway walls take the building's material color. At night, roofed buildings glow through their front windows instead of their floors.
- **Small procedural props** (`Art.drawn`): drawn in the Kenney palette with a dark outline, 16px. A layer cake with pink icing and three lit marigold candles sits on a home's table during a birthday; headstones are rounded gray stones on a grassy mound.
- **Construction sites** (`worldView.drawSites`): cream survey string and stakes, then a dirt foundation, scaffold poles and walls rising with progress. Marigold progress bar above the plot on an edge-colored track, with a faint marigold band for how far delivered materials allow.
- The world changes as townsfolk chop and build: the ground canvas repaints per tile, and shading/lighting rebuild only the parts whose inputs (ground, walls, props) changed.
