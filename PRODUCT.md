# Product

## Register

product

## Users

One player (the developer, then friends) who keeps Townsfolk open on a laptop or second monitor and watches a little town live its day. Sessions are long and mostly passive: glance over, notice someone wandering off for coffee or falling apart, click them to find out why, nudge the speed, look away again. Occasionally they lean in and follow one person for a while.

> Inferred from README.md, the scene note in `src/styles.css` and the code. Not yet confirmed in an interview.

## Product Purpose

A cozy, legible people-and-town simulator. Twelve-plus townsfolk with needs, traits, jobs, schedules and relationships make their own decisions; the game's job is to make those decisions *watchable* and *explainable*. The town is growing into a builder (resources, farms, new buildings), so the interface must make room for more systems without crowding the world.

Success: the town itself is the hero of the screen; any "why is she doing that?" is answerable in one click; the place feels alive at every hour of the day.

## Brand Personality

Warm, observant, toy-like. A diorama you can lean into, not a spreadsheet about people. Calm at a glance, rich on inspection. Copy is plain and a little wry ("Nothing yet. Give it a minute; the town is just waking up.").

## Anti-references

- SaaS dashboards: docked sidebars on three sides squeezing the content, stat tiles, analytics chrome.
- Mobile-game candy: glossy bevels, bouncing coins, notification spam.
- "Cozy game" cliché skins: parchment scrolls, wood-plank panels, pixel fonts for body text.
- Glassmorphism HUDs floating over the world.

## Design Principles

1. **The town is the screen.** Chrome floats over the world and gets out of the way; nothing permanently docks over more than it must.
2. **Glance, then dig.** Every surface has a one-second read (status, color, icon) and a depth layer (inspector, history) one click away.
3. **Match the pixels.** UI shapes, shadows and motion share the art's crispness: hard edges, stepped light, no blurry gloss.
4. **Time is visible.** Hour, weather and light are felt in the world itself, not just printed in a clock.
5. **Room to grow.** New systems (resources, buildings, jobs) slot into existing patterns rather than adding new panels.

## Accessibility & Inclusion

- Aim for WCAG AA contrast on all UI text over panels.
- Need/status color is never the only signal: pair with labels, values or glyphs.
- Respect `prefers-reduced-motion` (no pulsing or eased panel motion).
- Full keyboard control already exists (Tab cycling, Space, 1-3, /, F, Esc); keep it working and discoverable.
