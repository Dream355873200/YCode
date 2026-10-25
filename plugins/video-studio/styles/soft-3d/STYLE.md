# Soft 3D Render — Style Prompt

> A pastel infinite studio: candy-soft materials, a cloner field rippling, an inflated wordmark dropping in with jelly physics. The C4D/Octane product-ident look.
> References (grammar only): Maxon demo reels, high-end product idents. Copy none of their objects or films.

A **scene style** for premium product idents, brand releases and satisfying-material moments. See §11 for the jobs.

## 1. Essence, and what it is not

- **Material is the subject**: SSS gummy (subsurface-scattered candy), glossy plastic, frosted glass or chrome — one hero object, physically *soft*.
- **Soft-body physics feel**: landings squash, collisions jiggle with damped springs, the cloner field ripples when disturbed.
- **Pastel infinite cyc**: seamless studio backdrop, big soft area lights + HDRI, shallow DOF (f/1.8 feel), real motion blur, 24 fps.
- **Long-tail easing**: ~80 % of any move completes in the first 20 % of its time; the tail is slow and luxurious.

Not glass-product (no black studio, no glass-and-light-strip grammar — this is candy in daylight pastel), not hologram-hud (no wireframes, no HUD furniture), not aurora-glass (no UI cards, no blur gradients — here everything is a *lit 3D object*).

## 2. Materials & rendering

- Material trio: **SSS gummy** (candy pink/peach, glow from within), **glossy plastic** (cream/lilac, tight specular), **frosted glass or chrome accent** (one element only).
- AO everywhere in creases; soft reflections of the cyc; subtle subsurface glow on thin parts.
- Hero: inflated/bevelled 3D wordmark or a jelly logo shape — chunky, rounded, no hard edges anywhere.
- Cloner field: grid of glossy rounded pills/spheres as the surrounding medium.

## 3. Colour logic

- 2–3 pastels + 1 accent from a neighbouring hue; the cyc is a lighter tint of the hero family. Chrome/glass used once, as jewellery.

## 4. Type & subtitles

- Type is **3D geometry**: inflated, bevelled, lit like the rest. Flat overlay type minimal — one small caption at most, in a rounded sans.

## 5. Motion quality

- Damped-spring jiggle on every impact (amplitude decaying over ~8–10 oscillations).
- Cloner waves: effector falloff sweeping through the grid, each pill rotating/scaling in sequence.
- Motion blur always on fast elements; nothing teleports.

## 6. Camera grammar

- Slow arcs and pushes around the hero; ends on a clean hero composition held ~1 s. DOF breathes with the move; the hero stays tack-sharp.

## 7. Sound palette

- ASMR-satisfying soft thuds, squishes, bubbly pops; an airy cinematic pad underneath; every impact frame-synced.

## 8. Native moves

- Field ripples → hero drops in with squash jiggle → collides with and displaces the field → camera arcs as materials show off → hero settles into the poster composition.

## 9. Pitfalls of the medium

- R3F realism budget: SSS is expensive — approximate with layered translucency + rim glow; never let a frame render as flat unlit colour.
- Soft things moving fast read wrong: keep accelerations moderate, impacts squashy.
- Grey pastel: light must stay warm and multi-source; a single light kills the candy.

## 10. Engine

- Remotion + @remotion/three (R3F): MeshPhysicalMaterial with `transmission`/`thickness` for gummy and frosted; cloner field as instanced meshes with per-instance effector curves; DOF via postprocessing; deterministic seeded layout.

## 11. Variation space

- Swap hero (wordmark, bottle, device, abstract jewel) and pastel family. Pairs well with a real product silhouette rendered soft (never a real trademarked silhouette).
