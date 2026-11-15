# Simmer — chat-first meal planning

*(Working name. Rename in `apps/app/app.json`.)*

A clean, simple meal planner in the spirit of Mealime, built around a chat. Tell it who
you're feeding and how you like to eat; it plans the week and keeps one grocery list you
can tick off in the store or share with whoever's shopping.

- **Just me or Family:** one switch. Family mode scales portions per person (adult, teen,
  child, toddler) and respects each member's allergies and dislikes.
- **Plan by meal type or by macros:** pick which meals to plan, or fit each day to the main
  adult's calorie and protein targets.
- **Longevity track:** for midlife adults focused on muscle span and healthspan. It favours
  30 g+ protein per meal, fiber, oily fish, legumes, fermented foods and plant variety, and
  scores the week against those goals.
- **Grocery list:** the week's ingredients, scaled to the household, rounded to amounts you
  can buy and grouped by aisle, minus pantry staples. Add your own items ("paper towels"),
  check things off (saved, so the list matches on every device and in chat), and share it
  as text. The app doesn't order groceries or compare store prices: no grocer offers that
  data to outside apps in Canada, so it was taken out (see the Roadmap).
- **One codebase for iOS, Android and desktop:** Expo (React Native + React Native Web).

## Layout

```
meal-planner/
├── packages/
│   ├── core/        Domain types + deterministic engine: portions, macros, planner,
│   │                shopping list, longevity scoring. Seed recipes. (no I/O)
│   ├── recipes/     Recipe sources (Spoonacular, Edamam, schema.org JSON-LD),
│   │                normaliser, provider that merges catalog + live APIs, ingest
│   ├── assistant/   Claude tool-use agent: system prompt, tools over the engine,
│   │                UI cards, quick replies, PlannerStore interface
│   └── db/          Postgres store, recipe catalog and cache. Every query runs
│                    as the signed-in user, so Supabase RLS applies
├── apps/
│   ├── api/         Hono server: Supabase JWT auth, /chat, REST routes, ingest CLI
│   └── app/         Expo Router app: sign-in, Chat, Plan, Groceries, Longevity, Household
├── supabase/migrations/   Postgres schema with row-level security
├── recipes/         sources.manifest.example.json (licensed catalog imports)
├── scripts/         throwaway Postgres for tests (test-db.sh, test-all.sh)
└── docs/            ARCHITECTURE.md, RECIPES.md, LONGEVITY.md, ROADMAP.md
```

## Run it locally (no accounts needed)

```bash
cd meal-planner
npm install
cp .env.example .env                    # API: optional ANTHROPIC_API_KEY, recipe API keys
cp apps/app/.env.example apps/app/.env  # app: API URL, Supabase URL + publishable key
npm run dev:api             # http://localhost:8787, in-memory dev backend
npm run dev:app             # Expo: press w for web/desktop, i for iOS, a for Android
npm test                    # unit tests (database tests skip)
npm run test:all            # everything, against a throwaway local Postgres (needs Postgres binaries)
npm run typecheck
```

With `SUPABASE_URL`/`DATABASE_URL` blank, the API runs in-memory with a dev `x-user-id`
header, and the app skips sign-in. Dev mode refuses to start when `NODE_ENV=production`.

## Connect Supabase

1. Create a Supabase project, then apply the migrations **in filename order** (oldest first).
   Either:
   - **Dashboard:** SQL Editor → New query → paste `supabase/migrations/20261114000000_meal_planner.sql`
     → Run. Repeat, one new query per file, with `20261115000000_auth_and_recipe_sources.sql`,
     `20261116000000_api_role_membership.sql` (lets the API act as the signed-in user), and
     `20261117000000_lists_not_ordering.sql` (grocery list items; removes the old grocer tables).
   - **CLI:** `supabase login`, `supabase init` (keeps the existing `supabase/migrations/`),
     `supabase link --project-ref <ref>`, then `supabase db push`. It records which migrations
     ran, so later ones apply with another `db push`.

   Don't run `supabase/test/supabase-stubs.sql` on a real project. It stands in for Supabase's
   own `auth` schema in local tests only.
2. **Auth → Providers → Email:** keep it on. **Auth → Email Templates → Magic Link:** include
   `{{ .Token }}` so the email carries a one-time code (6–10 digits, set under Email OTP Length; the app signs in with codes, which work
   the same on iOS, Android and desktop without deep links).
3. Fill the root `.env` (API, server only): `SUPABASE_URL`, `DATABASE_URL` (dashboard **Connect** →
   Session pooler URI, with your database password).
   Fill `apps/app/.env` (app): `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   (the publishable key). Expo only reads `.env` from the app's folder, hence two files. Projects still on the legacy JWT secret also set
   `SUPABASE_JWT_SECRET`; projects on signing keys don't need it.
4. Load recipes: `npm run ingest -- --seed`, add Spoonacular/Edamam keys, and optionally
   import licensed sources (see [docs/RECIPES.md](docs/RECIPES.md)).

The first request from a new user creates their household (`ensure_household()`).

## Design rule

The engine sets every number: portions, macros, quantities, scores. Claude decides *what to
do* from the conversation (switch to family mode, plan by macros, swap Wednesday, add milk
to the list) and calls engine tools; it never writes nutrition figures itself. Cards under each
chat reply are rendered from tool results, so what people tap on is always engine output.
This is the same split Core Age uses, and it keeps plans consistent and testable.
