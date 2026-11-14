# Architecture

```
 iOS / Android / Desktop (Expo app)
   Chat ─┐   Plan · Groceries · Longevity · Household (tap-first)
         │              │
         ▼              ▼
   POST /chat     REST /plans, /household, /grocers ...         apps/api (Hono)
         │              │
         ▼              │
   assistant.chatTurn ──┤  Claude (tool use) decides which tool to call
         │ tools        │
         ▼              ▼
   core engine: planner · portions · macros · shopping list · longevity    (pure, tested)
         │
         ├── PlannerStore → Supabase Postgres (RLS)  |  MemoryStore in dev/tests
         └── grocers registry → Instacart · Kroger · (Walmart · Amazon · Target via partners)
```

## Platforms

| Target | How | Notes |
| --- | --- | --- |
| iOS | Expo / EAS Build | Bundle id `com.automatestuff.simmer` |
| Android | Expo / EAS Build | Package `com.automatestuff.simmer` |
| Desktop | Expo web export as an installable PWA | Wide screens get a left rail and a pinned plan panel next to chat. Wrap in Tauri later if a store listing or offline file access is needed. |

One component tree serves all three. Layout switches at 900 px: bottom tabs on phones,
side rail and two-pane chat on tablets and desktop.

## Chat

- `packages/assistant/src/agent.ts` runs a manual tool-use loop on the Messages API
  (`claude-opus-5-5`, adaptive thinking, effort `medium`), with server-side refusal
  fallback enabled and the system prompt + tools cached.
- Tools are defined once with zod: the same schema generates the tool's JSON schema and
  validates every input before it runs. Bad input goes back to Claude as a tool error.
- Tools run one at a time because they share the household and plan.
- Each turn returns `{ text, cards, quickReplies }`. Quick-reply chips are chosen in code
  from what just happened, so a busy parent can plan a week with three taps.
- History is append-only (thinking and tool blocks kept verbatim). Today it lives in API
  memory; it moves to the `conversations` table with auth.

## Engine

- **Planner** (`core/src/engine/planner.ts`): filters recipes by diet, allergies, dislikes
  and cook time, then scores each candidate per slot: variety, reuse of perishables across
  the week (fewer half-used herbs), kid-friendliness when children eat, longevity score on
  that track, and distance from per-slot macro targets in macro mode. Seeded, so the same
  request gives the same week and "regenerate" gives a new one.
- **Leftovers:** dinner can roll into next day's lunch; the shopping list buys it once.
- **Portions:** adult 1.0, teen 1.15, child 0.6, toddler 0.35 servings (tunable per member).
- **Macros:** Mifflin-St Jeor energy × activity; protein 1.2 g/kg standard, 1.6 g/kg Longevity.

## Auth and data (next step)

Supabase magic-link auth. The API verifies the Supabase JWT (replacing the `x-user-id`
placeholder) and implements `PlannerStore` over the tables in `supabase/migrations`.
Two adults can share one household through `household_users`.
