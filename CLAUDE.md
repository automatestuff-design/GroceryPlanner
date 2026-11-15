# GroceryPlanner

Chat-first meal planner (personal or family, plan by meal type or macros, Longevity
track) with a shared grocery list. No grocer ordering or store prices: removed on purpose,
since grocers don't offer that data to outside apps (see docs/ROADMAP.md before re-adding). npm workspaces monorepo, TypeScript throughout. The README has
product context and setup; `docs/` has architecture, recipes, Longevity, roadmap.

## Commands

```bash
npm install
npm test               # all workspaces; database tests skip without TEST_DATABASE_URL
npm run test:all       # everything, against a throwaway local Postgres (scripts/test-db.sh)
npm run typecheck      # tsc -b over the packages + the Expo app's tsc --noEmit
npm run dev:api        # API on :8787; in-memory dev backend when SUPABASE_URL/DATABASE_URL are blank
npm run dev:app        # Expo (w = web/desktop, i = iOS, a = Android)
npm run ingest -- --seed                     # load seed recipes into DATABASE_URL
npm run ingest -- recipes/sources.manifest.json
```

Run one package's tests with `npx vitest run --dir src` inside it. Keep `--dir src`:
`tsc -b` emits compiled copies of tests into `dist/`.

For DB tests by hand: `eval "$(scripts/test-db.sh)"`, then `scripts/stop-test-db.sh` when done.
The script needs local Postgres binaries (`/usr/lib/postgresql/*/bin`) and stubs Supabase's
`auth` schema and roles (`supabase/test/supabase-stubs.sql`).

## Layout

- `packages/core`: domain types and the deterministic engine (planner, portions, macros,
  shopping list, Longevity scoring, `RecipeProvider`). Pure: no I/O.
- `packages/recipes`: normaliser plus sources (Spoonacular, Edamam, schema.org JSON-LD),
  `createRecipeProvider`, catalog ingest.
- `packages/assistant`: Claude tool-use agent; tools are zod schemas over the engine.
  `loadGroceryList` is the one place the list is assembled, for chat and the API alike.
- `packages/db`: `PostgresStore` (households, plans, chat, grocery list), recipe catalog/cache.
- `apps/api`: Hono server, Supabase JWT auth (`auth.ts`), backend wiring (`backend.ts`).
- `apps/app`: Expo Router app (iOS, Android, web/desktop).
- `supabase/migrations`: schema and RLS. Add new migrations; never edit applied ones.

## Rules that matter

- **The engine sets every number.** Calories, protein, portions, quantities and scores come
  from `packages/core`. The assistant chooses tools; it never writes nutrition figures, and
  chat cards render tool results only.
- **Database access goes through `asUser()`** (`packages/db/src/pool.ts`): the
  `authenticated` role with the caller's JWT claims, so RLS applies. Use `asServer()` only
  for `recipe_cache` and catalog ingest. A new table needs RLS policies and grants in its
  migration, plus a cross-user test in `packages/db/src/db.test.ts`.
- **Stored recipes need a storage license.** Spoonacular and Edamam results are cached
  only up to their TTL (expired rows are deleted) and plans keep just the id. The catalog
  stores only manifest sources with an accepted license, or a household's own private
  imports. See `docs/RECIPES.md` before adding a source.
- **Recipes without nutrition are rejected** at normalisation (`hasUsableNutrition`).
- **User-supplied URLs** go through `fetchJsonLdRecipe`, which resolves every hop and refuses
  private addresses. Don't fetch user URLs any other way.
- **Dev auth** (`x-user-id` header) exists only in the in-memory backend and refuses to run
  with `NODE_ENV=production`.
- **Claude model:** `claude-opus-5-5` (`packages/assistant/src/agent.ts`), with server-side
  refusal fallback enabled. The system prompt stays frozen, with no dates or user data, so it caches.

## Expo app

- Expo SDK 58. Pin native modules to the versions in
  `node_modules/expo/bundledNativeModules.json`; `npx expo install --check` needs network
  access to Expo's API.
- Import only types from `@mealplan/core` in the app, plus pure helpers such as `WEEKDAYS`.
  Never import server packages.
- Layout switches at 900 px: bottom tabs on phones; side rail and two-pane chat on desktop.
- Verify UI changes with `npx expo export --platform web` plus a Playwright screenshot.
