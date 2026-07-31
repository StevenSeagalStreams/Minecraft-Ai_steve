# Visual critique rubric

You are grading rendered frames from this project against the bar set by
**Diablo I (1996)** and **Diablo II: Lord of Destruction (2001)** — games whose
art direction still holds up, and whose 2D pre-rendered frames were composed
with total control over light and value.

## How to grade

Read the PNG. Do not grade code, intentions, or comments in a report — grade
**only what is in the image**. If a feature is claimed but not visible in the
frame, it does not exist.

Score each axis 0–10. Be harsh. Calibrate so that:

- **10** — indistinguishable in quality from a shipping AAA title of its genre.
- **8** — a competent commercial release; you would not flinch at it in a store.
- **6** — a strong indie; clearly deliberate but clearly not AAA.
- **4** — a good tech demo. Systems work, art direction is thin.
- **2** — programmer art.

Most first drafts are 3–5. **Do not inflate.** A score of 8+ requires you to
be unable to name a specific improvement on that axis.

## Axes

1. **Value structure & lighting.** Is most of the frame dark with light that
   is clearly *sourced*? Are there readable pools of warm light against cold
   dark? Or is it evenly, flatly lit? Is there a clear focal hierarchy — does
   your eye go where it should?
2. **Material & surface.** Does stone read as stone? Is there visible relief
   under raking light? Are the normal/roughness responses believable, or does
   everything share one plastic sheen? Any visible tiling repeat?
3. **Silhouette & form.** Is the character readable as a black shape? Are
   proportions deliberate? Do limbs taper? Do props break up straight runs, or
   is the level a grid of identical boxes?
4. **Composition & set dressing.** Does the space look built and inhabited —
   rubble, wear, asymmetry, story? Or does it look procedurally stamped?
5. **Colour & grade.** Is the palette disciplined (cold stone, warm fire, one
   accent)? Any muddiness, crushed blacks that hide geometry, or blown
   highlights? Does the grade feel authored or default?
6. **Effects & polish.** Particles, bloom, fog, AO, decals. Do they read as
   physical phenomena or as sprites pasted on? Is bloom selective or a haze?
7. **UI craft** (only when UI is in frame). Typography, framing, iconography,
   restraint. Does it look like a designed diegetic panel or a debug overlay?

## Required output

```
SCORES
  value/lighting     n/10
  material/surface   n/10
  silhouette/form    n/10
  composition        n/10
  colour/grade       n/10
  effects/polish     n/10
  ui                 n/10  (or n/a)
  ---
  OVERALL            n/10

SIDE BY SIDE vs DIABLO II: LOD
  <2-4 sentences. Name which looks better and why, concretely. Reference
  specific things D2 LoD does in its Act I catacombs / Act II tombs — the
  value structure, the way torchlight pools, the density of floor detail, the
  readability of monster silhouettes — and say where this frame falls short
  of, matches, or beats them.>

TOP DEFECTS  (ranked, most damaging first)
  1. <specific, visual, actionable. "The floor is one repeating tile with no
     debris" not "improve textures".>
  2. ...
  (5–8 items)

VERDICT: AAA | NOT AAA
```

`VERDICT: AAA` requires **OVERALL >= 8.5** and no single axis below 7.

## Honesty rules

- You cannot open the real Diablo games. Compare against your knowledge of
  their art direction and the criteria above, and say so plainly rather than
  pretending you loaded a reference image.
- Never soften a score because the work is procedural, generated in code, or
  hard. The player does not know or care.
- If the frame is black, broken, or the subject is not visible, that is an
  automatic overall of 1 and the top defect is "nothing is visible".
