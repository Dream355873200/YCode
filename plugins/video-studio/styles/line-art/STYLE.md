# Line Art — Style Prompt

> A single constant-width line draws itself across the entire film. The tail of each figure is the start of the next; the last stroke closes a logo and fills from its anchor. Luxury-brand restraint.
> References (grammar only): one-stroke brand idents, luxury architecture films. Copy none of their figures, wordmarks or layouts.

A **scene style** for brand stories, logo reveals and single-idea luxury pieces. See §11 for the jobs.

## 1. Essence, and what it is not

- **One line, one colour, constant width (2–4 px), round caps.** The line is the only drawing tool in the world.
- **We watch it draw itself**: `stroke-dashoffset`-style self-description, draw speed easing into corners (`cubic-bezier(0.65,0,0.35,1)`), a softly glowing pen tip leading the stroke.
- **One-stroke narrative**: the end point of every figure is the start point of the next — seed → sapling → building → skyline → monogram — designed as one continuous path *before* animating.
- **Line-to-fill moment**: after the logo closes, the same path's fill expands from its anchor point. Once, at the climax, never before.
- As the camera moves on, **older segments dim to ~35 %** so the tip stays the brightest thing.

Not one-line (no ink physics, no pressure width, no paper material, no comedy character — the line here is elegant, not alive), not whiteboard (no hand, no marker, no boards), not blueprint (no construction grammar).

## 2. Materials & rendering

- Deep near-black ground (`#0B1320` family) or warm paper — one ground, no texture beyond a faint vignette.
- A single champagne-gold (or equivalent luxury) line at constant ~3 px, round caps, subtle glow on the moving tip only.
- Optional camera drift/push keeping the tip in frame; final dolly-out reveals the whole drawing composed as a poster.
- Fills appear only in the line-to-fill moment: the existing path's fill animating from its anchor, same hue at low alpha.

## 3. Colour logic

- One line colour + one ground. That is all. An accent is spent once (the fill moment or one key figure) — never as a second line.

## 4. Type & subtitles

- Thin letter-spaced serif or refined sans, small, fading up *after* the drawing completes — type never competes with the stroke.
- No subtitles inside the drawing phase; if needed, HUD-quiet, bottom, ground-colour at 60 %.

## 5. Motion quality

- Draw speed follows curvature: eases into corners, accelerates on straights; the tip never stops dead (flow, then hand-off to the next figure).
- Transitions between figures are *growths*, not cuts: the line travels through shared vertices.
- The fill moment: fill expands anchor-outward in ~12 f while the line brightens once, then everything rests.

## 6. Camera grammar

- A virtual camera follows the tip (small lag, slight push), then dollies out to reveal the full poster at the end.
- Older geometry dims rather than leaving frame — the whole drawing accumulates.

## 7. Sound palette

- Minimal felt piano + soft string swell; a pen-on-paper whisper whose level follows tip speed; one delicate chime on the fill. Nothing percussive.

## 8. Native moves

- Continuous one-stroke chain across 3–5 figures → monogram closes → line-to-fill → wordmark fades up → dolly-out to the composed poster.

## 9. Pitfalls of the medium

- Broken continuity: any jump between figures kills the illusion — the path must be designed end-to-start first.
- Width drift: the line must stay constant; width modulation belongs to one-line, not here.
- Fill abuse: line-to-fill happens once. Filling every shape turns this into a colouring book.

## 10. Engine

- Pre-build the whole film as one or few SVG path strings with known total length; drive `strokeDasharray/strokeDashoffset` from arc-length mapping in Remotion; fill via `fillOpacity` keyed off the same path; tip glow as a small radial element positioned at the current arc-length point.

## 11. Variation space

- Ground/line swaps (paper/ink, navy/silver) keep the grammar. Subjects: brand stories, logo reveals, architecture journeys, timeline-as-path narratives.
