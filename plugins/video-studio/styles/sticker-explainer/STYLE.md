# Sticker Explainer — Style Prompt

> Photo stickers with bold white outlines, flat icons and exact charts laid across one huge canvas; one continuous camera strings the facts together. The PaperClip knowledge-video look.
> References (grammar only): PaperClip PaperClip, Lin Chao finance explainers, hard-core knowledge-channel packaging. Copy none of their episodes or charts.

A **scene style** for hard-core explainers, finance/knowledge content and corporate fact pieces. See §11 for the jobs.

## 1. Essence, and what it is not

- **Photos become stickers**: real imagery keyed out and given an **8–12 px white outline** + soft shadow, so any source photo unifies into the same language.
- **One huge canvas, one continuous camera**: information stations are laid out on a canvas several screens wide; the camera pans/zooms on long eases from station to station — never hard cuts.
- **Charts are exact**: bars to scale, counts that add up, numbers consistent between chart and narration. Precision *is* the credibility.
- **Every sentence gets a new visual element**: narration drives entries; a station without an incoming element is a dead beat.

Not visual-investigation (no case-board strings or evidence framing — this teaches, it doesn't investigate), not briefing-board (no engineering-sheet furniture), not whiteboard (no hand, no drawing-on).

## 2. Materials & rendering

- Calm blue-grey/off-white canvas (`#E9EEF2` + slate lines); subtle grid or dot lattice acceptable at very low contrast.
- Sticker pipeline: cutout photo → white outline → drop shadow (8 px blur, 15 %) → optional slight rotate (±3°).
- Flat icon set, single weight, slate + one accent (`#FF5A36` class); charts as crisp vector strokes on the same grid.

## 3. Colour logic

- Restrained: 2–3 neutrals + **one accent** spent on the *number that matters* (the count-up result, the highlighted bar). Seriousness is the brand.

## 4. Type & subtitles

- Equal-line-height sans (equal-weight sans), strict alignment to the canvas grid; station headers medium, data labels light.
- Title cards in the PaperClip manner: heavy sans, a huge number, a small caption — bold but never decorative.
- Subtitles: clean bottom bar or plain slate text; in 2 f before the voice.

## 5. Motion quality

- Long-ease camera moves (accelerate → glide → settle on the station); chart animations: bar growth, count-up rolls, leader-line draws — all 500–800 ms, landed before the sentence ends.
- Sticker entrances: 90 % scale + 6 px drop with a soft settle; never bouncy.

## 6. Camera grammar

- Continuous: zoom into a station for its detail, glide along the canvas to the next; final pull-out reveals the whole canvas as a poster, then a bold typographic title card.

## 7. Sound palette

- Clean tech-explainer bed (neutral, mid-tempo); UI ticks on sticker landings, ticking during count-ups, soft whoosh between stations.

## 8. Native moves

- Sticker hero intro → exploded-parts stickers with leader labels → chart station with count-up → map/routes drawing → pull-out to full canvas → bold title card.

## 9. Pitfalls of the medium

- Chart lies: one inconsistent number destroys the register. Data is checked before animating.
- Sticker zoo: limit concurrent stations to what the frame reads at 1080p; density comes from the *tour*, not one crowded frame.
- Camera seasickness: max one axis of motion at a time; ease long enough to read en route.

## 10. Engine

- Build the canvas as one large absolute-layout region in Remotion; camera as a transform group (translate/scale) on long bezier keyframes; stations as components with entrance curves tied to narration cue times.

## 11. Variation space

- Swap topic and sticker family (hardware teardown, supply chain, biology, finance). Works in 9:16 with a vertical station stack.
