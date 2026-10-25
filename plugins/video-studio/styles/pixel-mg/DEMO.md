# Pixel Art MG — our demo

One example among many. Don't reuse its story, arc, shots, props or timings.

Demo: *PIXEL QUEST* (10 s) · mg-styles-15 `20-pixel`

## Story & structure

320×180 internal, ×6 nearest-neighbour. 16–32 colour palette, dithered sky. Hero sprite (16×16–24×24, 6–8 frame run cycle at 10–12 fps) runs through 3–4 whole-pixel parallax layers, jumps, collects coins (sparkle burst), bops a slime (2 f hit-stop + white flash); palette shifts day → sunset; a treasure chest opens with a light burst; pixel CJK dialogue types 「欢迎来到像素世界！」; chunky logo drops in with a shine sweep; optional restrained CRT pass.

## Technique notes

- Strictly: nearest-neighbour (`image-rendering: pixelated`), integer pixel positions, steps() timing — no smooth easing on sprites.
- Dither (Bayer) for all gradients; palette-swap for day/sunset — never new colours.
- Parallax layers move at different integer speeds; camera scrolls in whole pixels.
- CRT pass must keep pixel edges crisp: scanlines + slight barrel + phosphor glow at low strength.

## Sound

Chiptune (pulse lead, triangle bass, noise drums); jump blips, coin arpeggios, chest fanfare on the stepped clock.
