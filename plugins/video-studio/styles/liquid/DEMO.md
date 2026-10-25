# Liquid Motion — our demo

One example among many. Don't reuse its story, arc, shots, props or timings.

Demo: *drop. — It All Starts with a Drop* (10 s) · mg-styles-15 `07-liquid`

## Story & structure

Deep plum ground; glossy candy liquid (orange→pink→violet). 0–2 s droplets fall and splash with landing squash → 2–4 s metaball fusion: stretched necks, snap, 2–3 f rebound, secondary droplets lagging 2–3 f → 4–6 s a big liquid wave floods the frame as a transition (3–5 phase-offset bulges on the front) → 6–8.5 s the liquid coalesces into the wordmark (text SDF blended with the blob field) → 8.5–10 s one last drip falls and ripples.

## Technique notes

- WebGL fragment shader: 2D SDF metaballs (smooth-min) + **fake 3D lighting from field-gradient normals** (specular key + fresnel rim) — without it blobs read flat.
- 2D fake alternative: blur 20 px+ → alpha threshold; proximity auto-fuses.
- Flood front: hand-K'd wavy edge with phase-offset bulges sweeping 12–18 f.
- Easing `cubic-bezier(0.22,1,0.36,1)` — liquid is flung, never uniform.

## Sound

Bubbly gloop/pour/splash/drip; deep bass swell under a glossy synth bed; wet hit on every snap.
