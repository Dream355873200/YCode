# Aurora Glassmorphism — Style Prompt

> Aurora blobs drift behind frosted glass cards; a liquid-glass lens glides across, refracting everything it passes. Slow, translucent, expensive — the AI-product-launch look of 2025–26.
> References (grammar only): iOS Liquid Glass era, premium AI brand films. Copy none of their products or UI.

A **scene style** for tech brand films, product launches and anything that must feel *quietly futuristic*. See §11 for the jobs.

## 1. Essence, and what it is not

- **Aurora floor, glass furniture**: 4–5 large blurred colour blobs (violet/blue/cyan/magenta — **adjacent hues only**, mixed hues turn muddy) drift on long bezier loops, blending into a mesh-gradient field.
- **Frosted glass cards are the interface**: backdrop blur 20–40 px, 5–10 % white fill, 1 px 30 %-white inner highlight, large radius; micro-UI (chat bubbles, waveforms, toggles) inside.
- **Everything is slow**: sine/breathing easing, opacity + 8 px-rise entrances, no fast cuts. Speed is the enemy of expensive.
- **One hero device**: a liquid-glass lens with true refraction, chromatic dispersion on its rim and a specular edge, gliding across to magnify the world.

Not glass-product (no black studio, no rigid glass hero object — the glass here is *flat UI* over light), not hologram-hud (no wireframes, no telemetry), not dark-keynote (no type-driven slides — light is the subject).

## 2. Materials & rendering

- Aurora: pure-colour large circles blurred 80–150 px, drifting 20–40 s loops, additive-ish blending; **3–5 % noise dithering globally — banding is a fail**.
- Glass recipe: `backdrop-blur(30px)` + white 5–10 % fill + 1 px inner white 30 % stroke + 24–40 px radius; a faint 1 px top-edge specular line.
- Lens: refraction offset of the backdrop along normals, chromatic dispersion at edges, moving specular highlight; parallax depth between cards (near cards drift slightly faster).
- Deep indigo-black base; cards never sit on busy zones.

## 3. Colour logic

- 2–3 neighbouring cool hues + one warm accent *inside the aurora only*; UI stays white-on-glass. Contrast comes from luminance, never hue clash.

## 4. Type & subtitles

- Light elegant sans, wide tracking, white at 90 %; titles fade up 8 px with the same breath easing; one line at a time — this style never sets paragraphs.

## 5. Motion quality

- Breathing curves (sine) on every loop; entrances 600–900 ms, exits slower; the lens moves on a long bezier with ease-in-out and its own subtle rotation.
- Cards float: ±3 px slow oscillation on independent periods.

## 6. Camera grammar

- Locked or single slow drift; depth comes from the card parallax stack, not camera moves. The lens glide is the "camera".

## 7. Sound palette

- Ambient cinematic pad, soft shimmer, very subtle UI ticks; a low swell when the lens passes; nothing percussive.

## 8. Native moves

- Aurora breathes → cards float in staggered → micro-UI animates inside → lens glides across magnifying the world → title breathes up → hold.

## 9. Pitfalls of the medium

- **Banding**: any gradient needs dither noise; banding is instantly cheap.
- Hue clash in the aurora: adjacent hues only; adding orange-blue contrast breaks the dream.
- Speed creep: one fast entrance ruins the temperature — audit every easing against "slow, translucent, expensive".

## 10. Engine

- Aurora as 4–5 blurred divs on long seeded beziers (or a fragment-shader mesh gradient); cards as backdrop-blur layers; lens as a circular refraction pass sampling the composited frame; all timings in seconds-scale sines.

## 11. Variation space

- Palette follows brand hue families (keep adjacency); subject is any product story: chat AI, creative tools, fintech, health. Crops to 9:16 with cards re-stacked.
