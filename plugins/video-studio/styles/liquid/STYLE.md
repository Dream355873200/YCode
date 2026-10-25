# Liquid Motion — Style Prompt

> Glossy candy liquid drips, fuses and floods across the frame, then coalesces into a wordmark. Organic, squishy, high energy — the screen is always wet.
> References (grammar only): liquid ident reels, food/beverage CG ads. Copy none of their logos or films.

A **scene style** for music packaging, food & drink, logo genesis and transitions. See §11 for the jobs.

## 1. Essence, and what it is not

- **Everything moves like fluid**: stretched necks before fusion, snap rebounds, droplets trailing 2–3 f behind their parent, landing splashes that squash flat. Straight lines and even pacing are forbidden — liquid is *flung*, `cubic-bezier(0.22,1,0.36,1)`.
- **The transition is a flood**: a wavy liquid front with 3–5 phase-offset bulges sweeps the frame; the next scene is *inside* the colour.
- **Glossy 3D read from 2D**: specular highlights + fresnel rim on the blob field so it reads as thick shiny liquid, never flat circles.
- **It ends in a wordmark**: text emerges *from* the liquid (SDF/metaball blend), one last drip falls and ripples.

Not watercolor (no paper, no pigment bloom), not glass-product (no rigid glass), not liquid *typing* effects alone — the fluid is the protagonist.

## 2. Materials & rendering

- Metaball field (smooth-min SDF union) rendered in a fragment shader; **fake 3D lighting from field-gradient normals**: specular key light, fresnel rim, soft environment tint.
- Optional blur-threshold fake: heavy Gaussian blur → alpha threshold (feColorMatrix) so proximity auto-fuses blobs — the canonical 2D metaball trick.
- Background: one deep saturated ground (deep plum, ink, cocoa); the liquid is the only bright family.

## 3. Colour logic

- Liquid gradient across 2–3 adjacent candy hues (hot orange → pink → violet), colours drifting *along* the flow, never hard-banded. Ground stays dark and quiet so the gloss reads.

## 4. Type & subtitles

- The wordmark is liquid: text as an SDF/metaball source that the blobs merge into; while liquid, letterforms wobble (vertex wobble before settling crisp).
- Subtitles: minimal, appear after the mark settles; small, ground-colour.

## 5. Motion quality

- Flung eases only; secondary droplets **lag 2–3 f** (follow-through); landings flatten (squash) then rebound.
- Flood front: sine-bulged leading edge sweeping in ~12–18 f; wave crests catch highlights.
- Drip cycle: neck thins → snap → both ends rebound 2–3 f → droplet falls on gravity.

## 6. Camera grammar

- Static or slow push; the *liquid* provides all movement. The flood may travel with a slight camera follow.

## 7. Sound palette

- Bubbly gloop, pour, splash, drip; a deep bass swell under a glossy synth bed; every snap and landing gets a wet hit.

## 8. Native moves

- Droplets fall and splash → blob fusion chain → full-frame flood transition → coalescence into wordmark → final drip + ripple hold.

## 9. Pitfalls of the medium

- Flat blobs: without gradient normals the metaballs read as circles — lighting is not optional.
- Eased-by-numbers motion: uniform speed kills fluidity; every move is flung and settling.
- Flood without front: a full-frame fade is not a liquid transition — the wavy bulged edge is the signature.

## 10. Engine

- WebGL fragment shader (SDF metaballs, smooth-min, gradient-normal lighting) inside Remotion via @remotion/three or a `<canvas>` + `useCurrentFrame` uniform; text SDF blended in the same field; deterministic seeded droplet schedule.

## 11. Variation space

- Swap hue families (tropical, chocolate, neon) and the mark. Subjects: beverage pours, music idents, scene transitions, paint/configurator intros.
