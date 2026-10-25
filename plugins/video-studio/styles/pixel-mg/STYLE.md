# Pixel Art MG — Style Prompt

> A dithered parallax world at 320×180 internal pixels: a hero sprite runs, coins sparkle, a chest bursts open — stepped timing, nearest-neighbour, pure pixel craft. Not a game's story language; the pixel aesthetic itself.
> References (grammar only): retro side-scroller attract modes, Aseprite-era craft, PICO-8 palettes. Copy none of their sprites or games.

A **scene style** for game trailers, nostalgia marketing and 8-bit music moments. See §11 for the jobs.

## 1. Essence, and what it is not

- **320×180 native framebuffer** scaled ×6 nearest-neighbour to 1080p; everything — text included — lives in the framebuffer and obeys the pixel grid.
- **Stepped sprite animation**: run cycles 6–8 frames at 10–12 fps, idle breath 2–4 frames; `steps()` quantised timing, **no smooth easing on sprites ever**.
- **Dither is the gradient**: skies and glows are ordered dither (Bayer), never blends. Palette: 16–32 indexed colours.
- **Parallax by whole pixels**: 3–4 layers (sky, far mountains, mid forest/city, near ground) scrolling at different integer speeds.
- Optional CRT pass (scanlines, slight barrel, phosphor glow) that must never blur pixels into mush.

Not pixel-rpg (no dialogue boxes, menus, battle messages or save screens — this is a *world in motion*, not a game's UI telling a story), not HD-2D (no depth-of-field or realtime light), not ascii-crt.

## 2. Materials & rendering

- All art authored on the 320×180 grid: rounded chunky sprites 16–24 px tall, 2–3 px black-ish outlines, hard edges.
- Sky dither bands; clouds as 1-frame float cycles; water as 2-frame shimmer rows; light bursts as palette-swap flashes.
- Text: pixel CJK font, drawn into the framebuffer; logos chunky with a 1-frame shine sweep.

## 3. Colour logic

- Indexed palette with **palette-swap storytelling**: day → sunset → night shifts remap the same sprites; gold reserved for rewards (coins, chests); purple dusk only in the shift.

## 4. Type & subtitles

- Pixel CJK font, typing-on 1 char per 2 frames with a blip; logo drop-in with bounce-on-land (2 frames of squash) then shine sweep.

## 5. Motion quality

- Everything stepped to the sprite grid; camera scrolls in whole pixels; jumps arc on stepped curves (5–7 frames of discrete positions).
- Impacts: 2-frame hit-stop + 1-frame white flash; collectibles pop with a 4-frame sparkle burst.

## 6. Camera grammar

- Side-scroll follow with the hero at 1/3 frame; occasional locked "arena" beats for set-pieces; final frame composes like a cartridge cover.

## 7. Sound palette

- Chiptune: pulse lead, triangle bass, noise drums; jump blips, coin arpeggios, chest fanfare — every effect quantised to the same stepped clock.

## 8. Native moves

- Title card → hero drops in → run through parallax world → collect/bop set-pieces with hit-stops → palette shifts day to sunset → chest burst → logo slam.

## 9. Pitfalls of the medium

- Sub-pixel anything: fractional positions, smooth tweens or rotated sprites destroy the medium instantly.
- Palette drift: new colours invented per scene break the indexed read — swap, don't add.
- CRT mush: the scanline pass must keep pixel edges crisp; if it blurs, halve its strength.

## 10. Engine

- Author sprites as indexed PNGs; Remotion composites on a 320×180 canvas scaled ×6 with `image-rendering: pixelated`; all animation time quantised (`Math.floor(frame/2.5)` at 12 fps); parallax offsets integer; palette swaps as pre-computed PNG variants.

## 11. Variation space

- Worlds swap (forest, city, dungeon, space); palette families per era (Game Boy green, PICO-8, NES). Vertical 9:16 works as a vertical scroller.
