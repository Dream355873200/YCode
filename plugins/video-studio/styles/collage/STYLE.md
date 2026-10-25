# Collage Cut-out — Style Prompt

> Old photos scissored onto newsprint: white-edge cutouts, halftone dots, jaw-flaps and flip-open heads at 12 fps with hand-placed jitter. Monty Python via modern editorial.
> References (grammar only): Monty Python collage animation, Soviet constructivist posters, Terry Gilliam's cut-out grammar. Copy none of their actual collages.

A **scene style** for music content, street-culture pieces, cultural cold-opens and irreverent explainers. See §11 for the jobs.

## 1. Essence, and what it is not

- **Everything is cut paper**: photos and printed matter with a **2–4 px scissor-white edge**, slightly rotated, casting tiny hard shadows on the page.
- **Deliberately stepped motion**: subjects animate on **12 fps** (holds on 6 fps), positions jitter ±2 px as if re-placed by hand each frame.
- **Surreal assembly**: scale relationships broken on purpose (tiny hands, giant heads); mouths are separate cut flaps; heads flip open like lids (Gilliam homage).
- **Page furniture is part of the picture**: torn-paper strips, tape, scribbles, stamps, bold diagonal constructivist type.

Not papercut-red (no folk symmetry or single red sheet — this is printed-matter chaos), not paper-popup (no 3D pop-up engineering), not collage-as-static-slideshow (things must *perform*).

## 2. Materials & rendering

- Ground: newsprint/kraft paper texture, warm grey-cream.
- Cutouts: photo subjects keyed out, white edge, **halftone dot filter** on tones; multiple paper tones (newsprint, kraft, old photo sepia).
- Layer structure bottom→top: paper grain → big colour blocks → photo cutouts → scribbles/tape/stamps → grain overlay.
- Type: bold constructivist sans or stencil, red/black, set on strong diagonals.

## 3. Colour logic

- Muted paper base; **one saturated red or accent** carries energy; photo cutouts keep their own muted vintage tones, unified by the halftone pass.

## 4. Type & subtitles

- Type as printed scraps: cut-out letters, stamped words, torn headline strips; may slam in with a hand-slap motion + paper sound. CJK in heavy heiti or stencil; idiomatic, punchy.

## 5. Motion quality

- Puppet articulation: pivot at shoulders/elbows/jaw; mouth flap swaps 2–3 frames synced to sound.
- Transitions: a hand slaps the next element onto the page, or the whole page flips/torsos a torn strip across.
- The jitter is constant at hold — the collage never fully rests.

## 6. Camera grammar

- Flat page camera; the only moves are pushes to a cutout and quick re-frames *between* beats, as if re-photographing the board. Optional paper-grain flicker.

## 7. Sound palette

- Vinyl crackle under a jazzy boom-bap bed; paper rustles, scissors snips, slaps, a comic *pop* on reveals — all cut on the stepped grid.

## 8. Native moves

- Slap-in hook → head/lid flips open revealing an impossible interior → contents spill as cascading cutouts → type slams diagonally → torn-paper wipe to the end card.

## 9. Pitfalls of the medium

- Clean edges kill it: no anti-aliased floating PNGs — the white scissor edge and hard shadow are the craft.
- Smooth motion kills it: any eased glide breaks the stop-motion contract; step *everything*.
- IP caution: public-domain or licensed photos only; invented mastheads, never real magazine brands.

## 10. Engine

- Prepare cutout PNGs with baked white edge + halftone as textures; Remotion positions them on a paper backdrop; stepped animation via `Math.floor(frame/2.5)` time quantisation plus seeded ±2 px jitter per step.

## 11. Variation space

- Swap the subject matter (music, history, product parody); palette follows the paper era. Works natively in 9:16 as an editorial scrapbook.
