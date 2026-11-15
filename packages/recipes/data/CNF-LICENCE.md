# Canadian Nutrient File 2026 — attribution

`cnf-2026.json` is derived from the **Canadian Nutrient File 2026**, published by Health Canada:
https://open.canada.ca/data/en/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109

Contains information licensed under the Open Government Licence – Canada
(https://open.canada.ca/en/open-government-licence-canada).

## What was changed

`packages/recipes/scripts/build-cnf.mjs` reduces the published CSVs to what the meal
planner uses:

- Five nutrients per 100 g edible portion: energy (kcal), protein, total fat,
  carbohydrate (by difference) and total dietary fibre.
- Household measure weights in grams (Measure_Type 6), e.g. "1 clove" = 3 g.
- Baby foods (group 3) and fast-food items (group 21) are left out.

Values are otherwise unchanged. This product is not endorsed by Health Canada.

## Updating

Download `cnf_fcen_all-files-data_2026.zip` (or a newer release) from the link above,
unzip it, then run:

```bash
node packages/recipes/scripts/build-cnf.mjs <unzipped-folder>
```
