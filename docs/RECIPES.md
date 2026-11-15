# Recipe sources

The planner only uses recipes **with nutrition data** (calories, protein, carbs and fat
per serving). Nutrition comes from the source when it publishes it; otherwise it is
**calculated from the ingredients** with Health Canada's Canadian Nutrient File (below). Every source is normalised into the same `Recipe` shape by
`packages/recipes/src/normalize.ts`, which also derives aisles, allergens, diets and the
Longevity profile from the ingredient list.

## "All publicly available recipes": what is and isn't possible

Recipes on the open web are publicly *visible*, but their text, photos and compilations
are usually copyrighted, and most sites' terms forbid copying them into another app.
A crawler that copies every recipe page into our database would expose the business to
takedowns and lawsuits, and would break the terms of the APIs below. So the app reaches
the public recipe web in three legitimate ways:

| Route | Coverage | Stored? | Where |
| --- | --- | --- | --- |
| **Edamam Recipe Search API** | Millions of recipes from public sites, each with full nutrition analysis | No. Cached up to 1 hour; plans keep only the id | `sources/edamam.ts` |
| **Spoonacular API** | Hundreds of thousands of recipes with nutrition, ingredients and steps | No. Cached up to 1 hour; plans keep only the id | `sources/spoonacular.ts` |
| **Licensed catalog import** | Any site whose license lets us store recipes (public domain, Creative Commons, our own, partners) | Yes, in `recipes` | `ingest.ts` + `recipes/sources.manifest.json` |
| **"Add a recipe"** | Any page, TikTok, photo or pasted recipe a user chooses | Yes, private to that household | `POST /recipes/import`, `save_recipe` chat tool, Household tab |

Between Edamam and Spoonacular, this covers most of the recipe web *with* nutrition, and
both APIs exclude allergens and diets at the source. Results are re-checked against our
own rules, because their labels are coarser than ours.

## Saving a recipe someone shares

`importRecipe()` in `packages/recipes/src/import.ts` routes whatever the user gives:

| They share | What happens |
| --- | --- |
| A recipe web page | schema.org data on the page; nutrition published, or calculated from its ingredients |
| A TikTok link **plus** pasted ingredients or screenshots | Claude reads the text/screenshots; nutrition calculated; credited to the creator with a link back |
| A TikTok link alone | Asked for the recipe (422 `needs_details`): TikTok doesn't share captions with apps |
| Pasted text, or photos of a cookbook or recipe card | Claude reads it; nutrition calculated |

**Why TikTok needs the user's help.** TikTok's terms forbid scraping, its research API is for
non-commercial academic work, and its public embed lookup (`/oembed`) now returns only an
embeddable player: no caption, title or creator (checked against TikTok's own docs example
and real recipe videos in November 2026). The creator's @handle and the video id are read
from the link itself; share links (`vm.tiktok.com/…`) are followed only between TikTok's
own hosts.

**What Claude does, and doesn't.** `extractRecipe()` (structured output, `claude-opus-5-5`,
low effort, refusal fallback on) transcribes the title, servings, ingredient lines (amount,
unit, generic food name) and steps. It never supplies nutrition, never invents missing
amounts (they come back as null and are reported), and says when servings were estimated.

## Calculated nutrition (Canadian Nutrient File 2026)

`packages/recipes/data/cnf-2026.json` is Health Canada's Canadian Nutrient File 2026 reduced
to five nutrients per 100 g plus household measure weights (5,757 foods, ~850 KB), under the
Open Government Licence – Canada; see `data/CNF-LICENCE.md`. Rebuild it with
`scripts/build-cnf.mjs` when a new release comes out.

`calculateNutrition()`:
1. **Matches each ingredient to a CNF food.** About 370 common names (229 distinct foods) map to codes looked
   up in the data by hand (`nutrition/aliases.ts`; a test checks every code exists). Anything
   else falls back to word matching, which is marked "low" confidence. Extra words that
   change the food ("rice vinegar", "cauliflower rice", "cooked quinoa") send it to the right
   entry instead of the alias; raw is preferred over dried or powdered unless asked for.
2. **Converts the amount to grams** with CNF's own measures (1 clove garlic = 3 g, 1 avocado =
   201 g, 250 ml of cooked brown rice = 213 g). Units without a measure fall back (a can →
   400 g, oil → 0.92 g/ml) and are flagged.
3. **Adds up and divides by servings.** Ingredients it couldn't count are listed as
   `missing` (light ones like salt or herbs are ignored), and fallbacks as `uncertain`. The
   recipe stores this as `nutritionBasis`, and the app shows it ("Not counted: …").

## How a plan gets its recipes

`createRecipeProvider` merges, per request:
1. the Postgres catalog (seed + licensed imports + this household's own imports), searched
   with full-text search, meal type, diet, allergen exclusion and cook time;
2. each live API that has keys, in parallel. If one fails, planning continues without it.

Live results go into `recipe_cache` with an expiry (`postgresRecipeCache`), and expired
rows are deleted. When a saved plan is opened after the cache expires, its recipes are
re-fetched by id, which both APIs allow.

## Attribution

Every recipe carries `source` (publisher, URL, attribution line, license). The recipe
screen shows it and links to the publisher; Edamam recipes have no steps in the API, so
the button reads "Get the steps on <publisher>". Edamam requires "Powered by Edamam";
Spoonacular asks for a credit and link back. Check both providers' current terms when you
sign up, as plan tiers differ.

## Licensed catalog import

```bash
cp recipes/sources.manifest.example.json recipes/sources.manifest.json   # edit it
npm run ingest -- recipes/sources.manifest.json --limit 20               # try a few first
npm run ingest -- recipes/sources.manifest.json
npm run ingest -- --seed                                                 # the 14 seed recipes
```

Each manifest entry must state a license (`public-domain`, `CC0`, `CC-BY-x`, `CC-BY-SA-x`,
`partner-agreement:<ref>` or `own`); anything else is refused, and the database rejects a
stored import without one. The importer reads schema.org `Recipe` JSON-LD (what sites
publish for search engines), expands sitemaps, waits `delayMs` between pages, and reports
every skipped page (most often: no nutrition).

**USDA MyPlate Kitchen** (~1,000 recipes) is the strongest free candidate, but verify first:
USDA asks for attribution, some of its recipes come from partners, and this environment
couldn't reach the site to confirm its pages publish nutrition markup.

Pages without published nutrition are no longer skipped: their nutrition is calculated from
the ingredient list (see above), and recorded as calculated.

## Safety

User-supplied links are fetched server-side, so the importer resolves every hostname
(including each redirect) and refuses private, loopback, link-local and metadata addresses,
non-web schemes and non-standard ports. A residual DNS-rebinding window remains between the
check and the fetch; pin the resolved address in the HTTP agent if imports become high-volume.
