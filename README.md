# Simmer — chat-first meal planning

*(Working name. Rename in `apps/app/app.json`.)*

A clean, simple meal planner in the spirit of Mealime, built around a chat. Tell it who
you're feeding and how you like to eat; it plans the week, writes the grocery list, and
hands the list to your grocer for delivery.

- **Just me or Family:** one switch. Family mode scales portions per person (adult, teen,
  child, toddler) and respects each member's allergies and dislikes.
- **Plan by meal type or by macros:** pick which meals to plan, or fit each day to the main
  adult's calorie and protein targets.
- **Longevity track:** for midlife adults focused on muscle span and healthspan. It favours
  30 g+ protein per meal, fiber, oily fish, legumes, fermented foods and plant variety, and
  scores the week against those goals.
- **Grocery delivery:** Instacart (Costco, Safeway, Publix, Aldi and others) and Kroger work
  through public APIs. Walmart, Amazon Fresh and Target are set up as adapters and need
  partner agreements before they can fill a cart.
- **One codebase for iOS, Android and desktop:** Expo (React Native + React Native Web).

## Layout

```
meal-planner/
├── packages/
│   ├── core/        Domain types + deterministic engine: portions, macros, planner,
│   │                shopping list, longevity scoring. Seed recipes. (no I/O)
│   ├── grocers/     GrocerAdapter interface, Instacart + Kroger adapters,
│   │                partner adapters (Walmart, Amazon Fresh, Target), registry
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
└── docs/            ARCHITECTURE.md, RECIPES.md, GROCERS.md, LONGEVITY.md, ROADMAP.md
```

## Run it locally (no accounts needed)

```bash
cd meal-planner
npm install
cp .env.example .env        # optional: ANTHROPIC_API_KEY for chat, recipe/grocer keys
npm run dev:api             # http://localhost:8787, in-memory dev backend
npm run dev:app             # Expo: press w for web/desktop, i for iOS, a for Android
npm test                    # unit tests (database tests skip)
npm run test:all            # everything, against a throwaway local Postgres (needs Postgres binaries)
npm run typecheck
```

With `SUPABASE_URL`/`DATABASE_URL` blank, the API runs in-memory with a dev `x-user-id`
header, and the app skips sign-in. Dev mode refuses to start when `NODE_ENV=production`.

## Connect Supabase

1. Create a Supabase project. In the SQL editor, run `supabase/migrations/*.sql` in order
   (or `supabase db push` with the Supabase CLI).
2. **Auth → Providers → Email:** keep it on. **Auth → Email Templates → Magic Link:** include
   `{{ .Token }}` so the email carries a 6-digit code (the app signs in with codes, which work
   the same on iOS, Android and desktop without deep links).
3. Fill `.env`: `SUPABASE_URL`, `DATABASE_URL` (Database → connection string; server only),
   `APP_SECRET_KEY` (`openssl rand -base64 32`), and for the app `EXPO_PUBLIC_SUPABASE_URL`
   and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Projects still on the legacy JWT secret also set
   `SUPABASE_JWT_SECRET`; projects on signing keys don't need it.
4. Load recipes: `npm run ingest -- --seed`, add Spoonacular/Edamam keys, and optionally
   import licensed sources (see [docs/RECIPES.md](docs/RECIPES.md)).

The first request from a new user creates their household (`ensure_household()`).

## Design rule

The engine sets every number: portions, macros, quantities, scores. Claude decides *what to
do* from the conversation (switch to family mode, plan by macros, swap Wednesday, send to
Kroger) and calls engine tools; it never writes nutrition figures itself. Cards under each
chat reply are rendered from tool results, so what people tap on is always engine output.
This is the same split Core Age uses, and it keeps plans consistent and testable.
