# Isometric Miniature City — Style Prompt

> A pastel miniature city builds itself on a floating board: tiles drop in a wave, buildings grow with overshoot, life flows through, then the whole island is revealed floating in a pastel void.
> References (grammar only): School-of-Motion isometric mograph showpieces, premium Dribbble/Behance heroes. Copy none of their cities or layouts.

A **scene style** for showing a *system growing* — campuses, cities, platforms, networks. See §11 for the jobs.

## 1. Essence, and what it is not

- **True isometric, never rotating**: orthographic 30° projection (35.264° elevation, 45° azimuth); the camera only **parallel-slides** with 1 : 0.8 : 0.6 layer parallax (foreground clouds slowest to cross).
- **The film is a build-up**: ground → structures → life → reveal. Construction choreography *is* the story.
- **Soft and premium**: pastel studio palette (lavender ground, mint, peach, sky, white), soft shadows + ambient occlusion so blocks read as physical models.
- **Text may join the isometric plane** — skewed into iso space for titles ("SMART CITY OS" sits *on* the grid, not over it).

Not iso-infographic (no Isotype counting, no leader lines, no cutaway sections — this style shows life, not labels), not lowpoly-island (no low-poly facets, this is clean flat-face modelling).

## 2. Materials & rendering

- True-isometric projection maths; painter depth sort on `x+y+z`.
- **Three tones per face** derived from one base: top light, left mid, right dark; flat fills, no outlines on solids.
- Soft AO in creases, one soft ground shadow blob per structure; nothing glossy — matte clay/model feel.
- Tiles, roads, trees, cars, trains, drones, data streams: all built from the same primitive family (rounded boxes, cylinders, spheres).

## 3. Colour logic

- Pastel adjacent-hue set on a pale ground; one accent (a warm glow) reserved for *life*: lit windows, data pulses, the vehicle being followed.

## 4. Type & subtitles

- Rounded geometric sans; titles set **on the iso plane** (skewed to the grid) or as floating flat cards with a small pin. No subtitle bars — labels live on signs if needed.

## 5. Motion quality

- **Build wave**: tiles flip/drop from centre outward with a tiny bounce each; buildings grow `scaleY` 0→1 with overshoot, roof caps landing 2–3 f after walls; windows light up in sequence.
- **Life loops**: cars follow roads at constant speed, a little train, drones carrying packets, data streams pulsing between buildings, a turbine spinning — all running simultaneously at different periods.
- Everything eased with a soft back-out; nothing snaps.

## 6. Camera grammar

- Parallel slides across the board (no rotation ever); one slow pull-out to reveal the island floating in the void; optional foreground cloud layer at 0.6× parallax.

## 7. Sound palette

- Bright plucky tech melody (FM marimba/pluck); soft clicks/pops for every tile and building landing; an airy whoosh on the final pull-out.

## 8. Native moves

- 0–2 s tile wave → 2–5 s structures grow → 5–8 s life flows, camera slides → 8–10 s pull back, island floats, on-plane title.

## 9. Pitfalls of the medium

- Projection drift: one degree off 30° and the whole world reads broken — lock the projection maths.
- Build chaos: the wave must have a visible front; random scatter kills the choreography read.
- Dead city: after the build, at least three life loops must keep running in the hold.

## 10. Engine

- Write the projection once (a shared `iso(x,y,z)` helper), depth-sort per frame, draw flat-shaded polygons in Remotion; grow animations as transforms on pre-computed building groups; loops as periodic functions of `frame`.

## 11. Variation space

- Swap the subject, keep the build: data centres, factory lines, university campuses, transport networks, game maps. Palette follows brand (stay pastel-adjacent).
