# Shape Morph — Style Prompt

> One hero shape continuously becomes 6–8 meaningful icons — cup → sun → gull → pin → heart — each morph bridged through a simple form, every landing on the beat. Apple-keynote-grade chain storytelling.
> References (grammar only): Apple keynote morph transitions, high-end explainer chains. Copy none of their icon sets or films.

A **scene style** for visual-storytelling chains: one idea flowing through transformations. See §11 for the jobs.

## 1. Essence, and what it is not

- **A single continuous subject**: the silhouette never cuts away; it *becomes*. The chain is written first as a storyboard of pairs (A→B) sharing a geometric echo.
- **Bridged morphs**: complex A→B never interpolates directly — collapse to an intermediate simple form (circle/capsule) then expand, 8–12 f per leg.
- **Deformation with life**: 10–15 % squash & stretch and slight rotation ride every morph, hiding mechanical interpolation; sub-parts morph in sync (steam → sun rays → waves).
- **No knots, ever**: paths are vertex-aligned before animating; every morph mid-point is still-checked for tangling.

Not shape-morph-as-page-transition (the morph *is* the narrative, not decoration), not liquid (the silhouette stays a crisp flat shape), not flat-vector (the frame serves the chain; there is no scene, no camera world).

## 2. Materials & rendering

- Flat bold shapes, minimal palette; each chapter may flip the background **colour field** with a clean block wipe synced to the morph landing.
- Icon geometry: single-weight silhouettes with rounded joins, chunky enough to survive interpolation.

## 3. Colour logic

- One hero colour constant through the chain; background fields rotate through a 3–4 colour story palette; the landing beat may flash the hero against a complementary field once.

## 4. Type & subtitles

- A wordmark or label may be the chain's final destination (the logo *is* the last morph). Supporting labels appear only between morphs, in a clean geometric sans.

## 5. Motion quality

- Mid-fastest easing `cubic-bezier(0.7,0,0.3,1)`; 3-frame cushions at both ends of every morph; landings land **on beats** with a pitched whoosh.
- Rotation ≤ 30° riding the morph, direction alternating to keep energy.

## 6. Camera grammar

- Locked frame. The silhouette is centred and stays centred; scale breathes slightly (±5 %) with the morph but the camera never moves.

## 7. Sound palette

- Rhythmic plucky arpeggio bed; one pitched whoosh per morph landing; a soft filter-lift across the whole chain.

## 8. Native moves

- The 6–8 step chain itself; a mid-chain double-morph (A→circle→B with the circle *held* one beat); the final morph into the logo with a field flip.

## 9. Pitfalls of the medium

- Vertex mismatch knots: normalise point counts and first-vertex orientation per pair, verify mid-stills.
- Meaningless chains: every B must earn its place in the story; random icon tours read as a demo reel.
- Beat drift: morph durations must lock to the track, not the other way round.

## 10. Engine

- Pre-author each silhouette as a same-vertex-count path (or use flubber-style optimal interpolation in build tooling); Remotion interpolates path `d` with the eased progress; field wipes as overlay Sequences.

## 11. Variation space

- Chain subjects: product features, day cycles, growth stories, cause→effect narratives. Flat colour world adapts to any brand palette.
