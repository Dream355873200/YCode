# Geometric Bauhaus — Style Prompt

> Circles, triangles and rectangles act on a strict module grid: one beat, one move, no overshoot, assembling into a perfect kinetic poster. Mechanical rationality you can dance to.
> References (grammar only): Bauhaus 1919, Swiss international style, kinetic poster tradition. Copy none of their posters.

A **scene style** for music/event packaging, cultural promos and kinetic posters. See §11 for the jobs.

## 1. Essence, and what it is not

- **Everything obeys the grid**: displacement = integer multiples of the module; every landing point sits on a grid line. The grid may draw itself in as lines at the open.
- **One beat, one action**: at 120 BPM each beat a module acts — a quarter-circle rotates 90° about a corner pivot, a semicircle slides one module, a triangle flips, a square splits.
- **Mechanical easing only**: `easeInOutQuad` or linear. **Overshoot is forbidden** — the rigidity is the character.
- **Rotation pivot play**: alternate pivots (own centre / corner vertex / frame centre) create the rhythm.
- It ends by **freezing into a perfect poster**: Swiss typography locked into the composition.

Not art-deco (no gold, no ornament, no airbrushed volume), not swiss-motion (type is *one element* here, geometry leads), not flat-vector (no elasticity, no characters).

## 2. Materials & rendering

- Flat primaries on cream paper: red `#E03C31`, yellow `#F2B705`, blue `#1E4FA3`, black `#111` on `#F1E9DA`; subtle paper tooth, slight print misregistration allowed (≤1 px).
- Shape set: circle, semicircle, quarter-circle, triangle, rectangle, bar — nothing else.
- Modest 240 px-style module at 1080p (scale to format).

## 3. Colour logic

- Primaries distributed so adjacent modules rarely repeat; black is structure (bars, type); cream ground breathes between clusters. One red element may be "the soloist" per section.

## 4. Type & subtitles

- Heavy geometric sans, set *into* the grid: a word may run vertically along a module column; small caps for sub-lines with wide tracking. Type lands on beats like a shape, never floats in.

## 5. Motion quality

- Discrete, metronomic: an action occupies its beat exactly, holding until its next cue.
- **Phase-shifted cascades**: the same action ripples across the grid with 1-beat offsets — the closest this style gets to fluency.
- Frame-perfect stops; no settle wobble.

## 6. Camera grammar

- Locked poster camera. The composition *is* the camera. At most a final snap-zoom to the locked poster frame.

## 7. Sound palette

- Minimal techno/click: pitched click or blip per action, kick on quarter beats, a drop where the cascade lands. Dry, no reverb washes.

## 8. Native moves

- Grid draws → first shape lands → modular assembly per beat → cascade wave on the drop → freeze into the full poster with type.

## 9. Pitfalls of the medium

- Wobbly easing: any spring/overshoot betrays the school. Hard stops only.
- Grid drift: shapes must land *exactly* on module edges — verify landings numerically.
- Shape zoo: only the six canonical forms; custom blobs are another style.

## 10. Engine

- Remotion: absolute-positioned SVG/div shapes on the module grid; time quantised to beats (`bpm→frames`); pivots as transform-origins; the poster lockup as the final keyframe state of the same elements.

## 11. Variation space

- Palette may swap to duotone/brand primaries (keep 3+black+paper). Subjects: festival idents, exhibition promos, album visualisers, title posters.
