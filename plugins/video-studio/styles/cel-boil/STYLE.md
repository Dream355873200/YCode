# Frame-by-Frame Cel Boil — Style Prompt

> Clean shapes with a hand-drawn soul: ink lines that boil on twos, cel FX (smoke, sparks, speed lines) drawn frame by frame over a vector hero, paper grain over everything. The Buck/Giant-Ant hybrid.
> References (grammar only): Buck, Giant Ant, traditional cel pipelines. Copy none of their characters or films.

A **scene style** for craft-feeling brand pieces, music moments and anywhere digital polish should feel *hand-made*. See §11 for the jobs.

## 1. Essence, and what it is not

- **The line boils**: ink outlines are redrawn with slight variation every 2 frames (24 fps timeline, animated on 2s) so the picture breathes. Boil is the signature — quiet frames still boil.
- **Two drawing registers coexist**: the hero/subject stays clean vector; the *effects* (smoke, water, fire, sparks, speed lines, dust) are hand-drawn cel frames with wobble.
- **Fills sit slightly off-register** like hand colouring, re-rolled on twos.
- **Timing is stepped**: 2s (12 effective fps) for normal action, **1s (24 fps)** only for the fastest hits, **3s** for holds.

Not cel-anime-80s (no painted backgrounds, no 透過光, no videotape layer — this is paper and ink, not 1986 broadcast), not rubber-hose (no 1930s world-bounce), not midcentury-toon (no offset-print characters as the hero).

## 2. Materials & rendering

- Warm paper ground with grain multiplied at 10–15 %.
- Ink linework: per-2-frame displacement of control points (Turbulent-Displace logic: amount 2–5 %, size ~50) — **seed-stepped**, never smooth noise.
- Fills: tomato/turmeric-family flat colours, offset 1–2 px from their lines, jittering on twos.
- Cel FX library: 3–4 frame hand-drawn cycles for smoke puffs, sparks, star bursts, speed lines; drawn as filled polygons with rough edges.

## 3. Colour logic

- 3–4 colours: ink black, 1–2 warm secondaries (tomato red, sunny yellow), cream paper. Cel FX share the palette exactly — no new colours for effects.

## 4. Type & subtitles

- **Hand-lettered or rough display type** that keeps boiling on holds; a held title animates on 3s (re-drawn every 3 frames).
- Subtitles: handwritten family, ink colour, in on twos.

## 5. Motion quality

- Anticipation and smear: fast actions get a **smear frame** (subject elongated 150–300 % for a single frame) on 1s; impacts land with 2–3 f of settle.
- FX follow-through: smoke lingers 6–10 f after its source leaves; sparks burst then fall with gravity on stepped timing.
- Everything steps — smooth interpolation anywhere breaks the illusion.

## 6. Camera grammar

- Static or gently pushed frames; camera moves themselves stepped (jump-pans on 2s), never gliding.

## 7. Sound palette

- Playful jazzy pizzicato/xylophone bed; cartoon SFX — strike, fwoosh, pop, poof, sparkle — cut to the same stepped grid as the picture.

## 8. Native moves

- Strike/splash hook with smear → hero character enters with anticipation → dance/action on 2s → bursts into cel FX → FX re-form into a boiling hand-lettered title → held on 3s.

## 9. Pitfalls of the medium

- **Fake boil** must be seed-stepped (discrete per-2-frame variants), not continuous noise — continuous wobble reads as VHS, as hand-drawing it reads as life.
- Boiling the *background*: paper grain is static; only linework boils.
- Over-FX: cel effects accent one moment; constant smoke everywhere buries the hero.

## 10. Engine

- Pre-generate N (2–3) displaced variants of each ink path at build time; Remotion picks variant `floor(frame/2) % N`; fills re-register with the same seed. FX as pre-authored frame sequences selected on the stepped grid.

## 11. Variation space

- Palette swaps within the 3–4 colour rule; subjects: maker/craft brands, music stings, title sequences, comedy beats. Boils well in 9:16.
