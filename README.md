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
│   └── assistant/   Claude tool-use agent: system prompt, tools over the engine,
│                    UI cards, quick replies, PlannerStore interface
├── apps/
│   ├── api/         Hono server: /chat plus REST routes for the tap-first screens
│   └── app/         Expo Router app: Chat, Plan, Groceries, Longevity, Household
├── supabase/migrations/   Postgres schema with row-level security
└── docs/            ARCHITECTURE.md, GROCERS.md, LONGEVITY.md, ROADMAP.md
```

## Run it

```bash
cd meal-planner
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY for chat; grocer keys are optional
npm run dev:api             # http://localhost:8787
npm run dev:app             # Expo: press w for web/desktop, i for iOS, a for Android
npm test                    # engine, grocers, assistant tools, API (no network)
npm run typecheck
```

Everything except chat works without keys: the Plan, Groceries and Longevity tabs call the
engine through REST. Grocer buttons stay disabled until their keys are set.

## Design rule

The engine sets every number: portions, macros, quantities, scores. Claude decides *what to
do* from the conversation (switch to family mode, plan by macros, swap Wednesday, send to
Kroger) and calls engine tools; it never writes nutrition figures itself. Cards under each
chat reply are rendered from tool results, so what people tap on is always engine output.
This is the same split Core Age uses, and it keeps plans consistent and testable.
