# Roadmap

**Done:** engine, chat agent, REST API, Expo app, Supabase auth (email code), Postgres store
under RLS, persisted chat history, recipe sources (Spoonacular, Edamam, licensed JSON-LD
import, add-from-link), saved and shareable grocery list with your own items.

**Decided against (for now): grocer ordering and price comparison.** Instacart wasn't
accepting API applications, Kroger is US-only, and no Canadian grocer (Loblaw, Sobeys,
Walmart.ca, Costco, Co-op) or flyer service (Flipp) offers prices to outside apps without a
partnership; scraping their sites breaks their terms. The Instacart/Kroger adapters were
removed in the "lists, not ordering" change and can be recovered from git history if a
partnership (e.g. Walmart Canada, Flipp) comes through.

**MVP**
1. Sign up for Spoonacular and/or Edamam; confirm plan tiers allow our caching and display.
2. Licensed catalog: verify MyPlate Kitchen, add partner sources, editorial review for Longevity tags.
3. Streaming chat replies; push a weekly "plan next week?" nudge.
4. EAS builds to TestFlight / Play internal testing; deploy web as a PWA.

**Next**
- Recipe ratings feed the planner ("more like Tuesday's tacos").
- Shared family lists (two parents checking off in the same store).
- Prep mode: batch-cook Sunday, timers, step-by-step cook view.
- Longevity: link Core Age results to set protein and fiber targets.
- Revisit grocer/flyer partnerships (Walmart Canada, Flipp) once there's an audience.
