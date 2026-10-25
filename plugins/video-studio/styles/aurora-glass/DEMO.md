# Aurora Glassmorphism — our demo

One example among many. Don't reuse its story, arc, shots, props or timings.

Demo: *Aurora — Think in Light* (10 s) · mg-styles-15 `12-aurora-glass`

## Story & structure

Deep indigo-black base. 4–5 aurora blobs (violet/blue/cyan/magenta, adjacent hues only) drift on long beziers blending into a mesh gradient, 3–5 % dither noise. Frosted glass cards float in with parallax and slight 3D tilt; micro-UI inside animates (chat bubble, voice waveform, toggles). A liquid-glass lens with true refraction, chromatic rim dispersion and specular edge glides across, magnifying aurora and cards. Title in a light elegant sans; sine/breathing easing everywhere.

## Technique notes

- Aurora blobs: pure colour circles blur 80–150 px, 20–40 s drift loops — **global 3–5 % noise or it bands**.
- Glass card recipe: backdrop blur 30 px + white 5–10 % fill + 1 px white 30 % inner stroke + large radius.
- Lens: refraction offsets the composited backdrop along normals; dispersion only at the rim.
- Nothing fast: entrances 600–900 ms; cards oscillate ±3 px on independent periods.

## Sound

Ambient cinematic pad, soft shimmer, subtle UI ticks; a low swell as the lens passes.
