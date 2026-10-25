# Flat Vector — Style Prompt

> One continuous shot through a flat vector world: bold colour fields, geometric characters with anchor-rigged limbs, everything moving on three-phase elastic easings. The canonical Google-explainer form at showreel polish.
> References (grammar only): Google brand explainers, Motion-Ocean, Buck's flat work. Copy none of their characters, palettes or layouts.

A **scene style**: the default language for product explainers, brand intros and "just a clean MG animation" — when the user asks for 普通MG动画 without naming a style, this is the entry point. See §11 for the jobs.

## 1. Essence, and what it is not

- **Strictly flat**: pure colour fields, no gradients, no textures, no outlines (or one minimal outline weight at most). Every element is a vector shape on a field.
- **One hero moves at a time**; everything else holds or breathes very slightly.
- Movement is elastic and warm: every entry is anticipation → overshoot → settle; squash & stretch ~10 % on any fast move.
- **Transitions are element-driven**: an object flies out and *carries* the cut, or a shape expands into a full-frame wipe. Never a straight cut.

Not midcentury-toon (no print misregistration, no breathing ink line, no 50s palette), not game-show (no variety pacing, no info cards), not cel-boil (no hand-drawn boil or cel FX layer).

## 2. Materials & rendering

- Pure flat fills in a **5–6 colour palette**: 1 deep ink, 1 cream ground, 3–4 saturated primaries (e.g. ultramarine `#2B2BFF`, coral `#FF5A4E`, sunflower `#FFC62B`, mint `#2EE6A8`, cream `#FFF6E9`, ink `#151433`).
- Characters are geometric: circle/bean head, capsule limbs, dot eyes, simple mouth. Limbs rig as **anchor rotations** (shoulder/elbow pivots); heads bob, eyes blink on a cycle.
- At most one soft shadow **shape** under the hero (ink at ~10 %, offset down-right) — a flat shape, never a gradient or blur.
- Decorative micro-elements (clouds, plus-signs, sparks, dots) share the palette and move with the same easings.

## 3. Colour logic

- The background **swaps field colour between chapters**; the hero keeps one identity colour throughout.
- Figure-ground first: the moving element always sits on a field it pops from; two saturated shapes of equal value never compete for attention.
- Depth comes only from overlap (later shapes overlap earlier ones), never from shading.

## 4. Type & subtitles

- Equal-weight geometric sans (Poppins/Montserrat; CJK 思源黑体 Heavy), generous tracking on labels.
- Type is an **element**: it enters with the same elastic easing and may ride inside a shape. End card = logo lockup + tagline, settled with 1 s of micro-motion.
- Subtitles as flat pills or plain ink text, 28–34 px at 1080p, in 2 frames before the voice.

## 5. Motion quality

- **Three-phase entries**: wind up 2–3 f → overshoot to 110–115 % → settle ~4 f. `cubic-bezier(0.34, 1.56, 0.64, 1)` family.
- Squash & stretch ~10 % on landings and fast translation. Limbs follow through after the body stops.
- **Stagger 2–4 f** when a family enters (buildings, icons) — each member gets its own mini overshoot.
- Holds stay alive: blink cycles, tiny float, a blinking cursor. A frozen frame is a bug.

## 6. Camera grammar

- **One continuous shot**: the camera pushes, pans and settles; cuts are disguised as shape wipes or element carries.
- Push-ins centre the acting element with ~10 % margin; the final pull-out reveals the whole composition as a poster.
- Flat translation and scale only — no rotation, no parallax, no perspective.

## 7. Sound palette

- Upbeat pop/future-bass around 120 BPM. Pop/boing/whoosh/tick on every entry, frame-synced; a soft swell into the end card; no dark or ambient textures.

## 8. Native moves

- Bold field → hero shape drops in with full elastic craft (0–1 s hook) → world builds element-by-element → push into a character beat → an object expands into a full-frame wipe → icons burst in rhythm → all collapse into the logo lockup → hold.

## 9. Pitfalls of the medium

- **Template smell**: symmetric centred layouts, default blue/purple, metronomic pacing. Compose asymmetrically, vary the beat, earn the polish.
- Elastic overload: overshoot everywhere reads as bouncy noise — contrast entries against calm holds.
- Flat ≠ empty: hold composition with negative space; a bold field is a stage, not a void.

## 10. Engine

- Shapes as positioned divs/SVG in Remotion; springs via `interpolate` with the elastic beziers above; one scene component per chapter; transitions as expanding overlay Sequences. No filters, no gradients, no blend modes beyond a flat shadow shape.

## 11. Variation space

- Brand palettes swap freely (keep the 5–6 flat structure). Subjects: product explainers, app demos, brand intros, event promos, annual-report numbers. Crops cleanly to 9:16.
