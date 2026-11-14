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
         ├── PlannerStore → PostgresStore (as the user, RLS)  |  MemoryStore in dev
         ├── RecipeProvider → Postgres catalog + Spoonacular + Edamam (cached ≤1h)
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

## Auth and data

- **Sign-in:** Supabase Auth, passwordless. The app emails a one-time code (6–10 digits, per the project's Email OTP Length)
  (`signInWithOtp` + `verifyOtp`), keeps the session in AsyncStorage (native) or
  localStorage (web), and refreshes tokens while in the foreground. `Stack.Protected` in
  `app/_layout.tsx` keeps signed-out users on `/sign-in`.
- **API auth:** every route except `/health` and the Kroger callback needs
  `Authorization: Bearer <Supabase access token>`. `auth.ts` verifies it with the project's
  JWKS (or the legacy HS256 secret), and checks issuer, audience `authenticated` and expiry.
- **Data access:** the API connects to Supabase Postgres with `pg`. Each request runs in a
  transaction as the `authenticated` role with the caller's claims set
  (`packages/db/src/pool.ts`), so the same RLS policies apply as through Supabase's own
  API. Only the live-recipe cache and the catalog ingest use the server's own role.
- **First sign-in:** `ensure_household()` (security definer) creates the household, the
  owner membership and a "Me" member. Two adults can share a household via `household_users`.
- **Secrets:** grocer OAuth tokens are AES-256-GCM encrypted with `APP_SECRET_KEY`; the
  Kroger OAuth `state` is HMAC-signed and expires after 10 minutes.
- **Tests:** `scripts/test-db.sh` starts a throwaway Postgres with Supabase stand-ins
  (`supabase/test/supabase-stubs.sql`) and all migrations; `npm run test:all` runs the RLS,
  store and full-API tests against it.
