# Recipe sources

The planner only uses recipes **with nutrition data** (calories, protein, carbs and fat
per serving). Every source is normalised into the same `Recipe` shape by
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
| **"Add a recipe from a link"** | Any page a user chooses that publishes schema.org nutrition | Yes, private to that household | `POST /recipes/import`, chat tool |

Between Edamam and Spoonacular, this covers most of the recipe web *with* nutrition, and
both APIs exclude allergens and diets at the source. Results are re-checked against our
own rules, because their labels are coarser than ours.

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

**USDA FoodData Central** (public domain, free API key) is the next step if you want
recipes *without* published nutrition: compute it from the ingredient list. Not built yet.

## Safety

User-supplied links are fetched server-side, so the importer resolves every hostname
(including each redirect) and refuses private, loopback, link-local and metadata addresses,
non-web schemes and non-standard ports. A residual DNS-rebinding window remains between the
check and the fetch; pin the resolved address in the HTTP agent if imports become high-volume.
