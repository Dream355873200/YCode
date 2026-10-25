# 80s Synthwave / VHS — Style Prompt

> A chrome title slams over a rushing neon grid and striped retro sun; the whole tape bleeds through a VHS pass. OUTRUN 1986.
> References (grammar only): 80s title sequences, synthwave album art, VHS artifacts. Copy none of their titles or artwork.

A **scene style** for music videos, game trailers, retro events and era-flavoured stories. See §11 for the jobs.

## 1. Essence, and what it is not

- **The synthwave trinity**: perspective grid rushing to a vanishing point (vertical-scroll loop), a striped retro sun (horizontal band cut-outs, magenta→orange→yellow), wireframe mountains with palm silhouettes.
- **Double glow everywhere**: tight ~4 px bright core + wide ~30 px low-alpha halo; neon never glows once.
- **The tape is real**: RGB split (red/blue channels ±1–2 px), scanlines (2 px pitch at ~10 % dark), 1–2 random glitch hitches per second, occasional 15 fps stutter or 2-frame reverse, 4:3 rounded mask if era-strict.
- **The chrome title is the hero**: multi-stop metallic gradient + bevel highlight + one star glint sweeping across, SLAMMING in with a lens flare on a big chord.

Not ascii-crt (no terminal grammar — the CRT here is a *tape*, not a terminal), not cel-anime-80s (no cel layers — this is neon signage and tape), not backrooms (no found-footage dread).

## 2. Materials & rendering

- Sky: deep purple gradient; stars seeded, slow-twinkling.
- Sun: banded gradient disc sinking/rising behind mountains; bands as horizontal cut-outs of increasing height.
- Grid: one-point perspective, magenta/cyan lines, looped vertical scroll speed-matched to camera.
- Chrome type: 5–8 stop metallic gradient (sky → horizon colours), bevel edge, environment-sweep highlight.

## 3. Colour logic

- Magenta + cyan on deep purple/blue; the sun carries the warm oranges. Glow hues never mix toward white except at the chrome highlights and the single lens flare.

## 4. Type & subtitles

- Hero: chrome extended sans, all caps, tight tracking.
- Secondary: pink neon **script** that writes on like a tube with flicker (letters ignite in sequence, one flickers 2–3 times before holding).
- OSD furniture: `PLAY ▶`, timecode, `REC` — tape-era overlays in VCR pixel font.

## 5. Motion quality

- Grid/camera rush is smooth and relentless; *tape* moments stutter (dropped frames, tracking roll).
- Title slam: scale 3→1 in 4–6 f with 1-frame white flash + flare; neon write-on after the slam settles.

## 6. Camera grammar

- Low fast fly-over toward the sun; slight roll on glitches; end parked on the hero title frame as the "tape cover".

## 7. Sound palette

- Synthwave: gated-reverb snare, arpeggiated saw bass, lush pads; tape hiss bed; big chord + crash on the title slam; VHS tracking noise on glitches.

## 8. Native moves

- Tracking noise + `PLAY ▶` open → low fly-over, sun rises → chrome title slam → neon script write-on → sustained ride → end on hero frame.

## 9. Pitfalls of the medium

- Glow soup: if everything glows at 30 px nothing reads — the tight core does the defining.
- Glitch abuse: 1–2 hitches per second maximum; constant glitching is noise, not tape.
- Purple-only palettes: the warm sun band is what makes it 1986; all-magenta frames go flat.

## 10. Engine

- Grid/sun/mountains as a fragment shader or layered canvas gradients in Remotion; chrome text via layered gradient fills + stroke; VHS pass as a final transform overlay (channel-offset copies, scanline pattern, seeded glitch keyframes).

## 11. Variation space

- Y2K detour: liquid chrome metal, acid green/violet, skeuomorphic windows and cursor clicks — same tape-and-glow grammar, later era. Subjects: music, racing/games, retro product, party promos.
