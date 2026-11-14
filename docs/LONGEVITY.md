# Longevity track

For people in midlife who want to keep muscle and stay healthy longer. Framed as food goals,
never as medical advice. Thresholds live in `packages/core/src/engine/longevity.ts`.

| Goal | Default | Why it's there |
| --- | --- | --- |
| Protein per main meal | 30 g+ | Spreading protein evenly helps older adults maintain muscle |
| Leucine per main meal | ~2.5 g | The amino acid that triggers muscle protein synthesis; older muscle needs more per meal |
| Daily protein (macro mode) | 1.6 g/kg | Upper end of ranges commonly used for active midlife adults doing resistance training |
| Fiber | 30 g/day | Linked to lower cardiometabolic risk; scaled down when only some meals are planned |
| Oily fish | 2 meals/week | EPA/DHA omega-3s |
| Legumes | 3 meals/week | Fiber plus plant protein |
| Fermented foods | 5 servings/week | Microbiome diversity |
| Plant variety | 30 different plants/week | Microbiome diversity |
| Whole foods | Mostly | Ultra-processed foods are deprioritised, not banned |

The weekly score (0-100) averages each meal's recipe score; the report lists the goals met
and the meals under 30 g protein, so chat can offer "fix the low-protein meals".

**Before launch:** have a registered dietitian review the thresholds and copy. Add a screen
that steers people with kidney disease, who are pregnant, or on medication to check targets
with their clinician (the system prompt already does this in chat). This pairs naturally with
the Core Age app in this repo: its waist, strength and protein data can set Longevity targets.
