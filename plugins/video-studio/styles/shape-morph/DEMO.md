# Shape Morph — our demo

One example among many. Don't reuse its story, arc, shots, props or timings.

Demo: *morphe. — One Shape, Every Story* (10 s) · mg-styles-15 `08-morph`

## Story & structure

One hero shape continuously becomes 6–8 icons on the beat: coffee cup → (circle) → sun → sunset over sea → gull → paper plane → location pin → heart → invented brand logo + wordmark. Background colour fields wipe with each landing. Every A→B goes through a simple intermediate (circle/capsule) with rotation and 10–15 % squash & stretch; sub-parts morph in sync (steam → sun rays → waves).

## Technique notes

- Path alignment first: equal vertex counts, matching first-vertex orientation, else it knots; check every mid-point still.
- A→circle→B, 8–12 f per leg; easing `cubic-bezier(0.7,0,0.3,1)` with 3 f cushions at both ends.
- Mid-fastest speed curve; landings on beats with a pitched whoosh.
- Final morph INTO the logo — the wordmark is the chain's destination, not an overlay.

## Sound

Rhythmic plucky arpeggio; a pitched whoosh per morph landing.
