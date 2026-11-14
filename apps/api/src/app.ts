import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { chatTurn, MemoryStore, type PlannerStore } from "@mealplan/assistant";
import {
  buildShoppingList, defaultSlots, generateWeekPlan, swapMeal, weeklyLongevityReport,
  type GrocerId, type MealType, type PlanStrategy, type PlanTrack, type Weekday,
} from "@mealplan/core";
import { createGrocerRegistry, KrogerAdapter, type GrocerRegistry } from "@mealplan/grocers";
import type Anthropic from "@anthropic-ai/sdk";

export interface AppDeps {
  store?: PlannerStore;
  grocers?: GrocerRegistry;
  anthropic?: Anthropic;
}

/**
 * REST + chat API shared by the iOS, Android and desktop/web clients.
 * The chat endpoint is the primary surface; the REST routes back the
 * tap-to-edit screens (plan grid, list checkboxes, settings toggles).
 */
export function createApp(deps: AppDeps = {}) {
  const store: PlannerStore = deps.store ?? new MemoryStore();
  const grocers = deps.grocers ?? createGrocerRegistry();
  const conversations = new Map<string, Anthropic.Beta.BetaMessageParam[]>(); // TODO: persist in `conversations` table
  const app = new Hono<{ Variables: { userId: string } }>();

  app.use("*", cors());

  // Auth placeholder: replace with Supabase JWT verification (see docs/ARCHITECTURE.md).
  app.use("*", async (c, next) => {
    if (c.req.path === "/health" || c.req.path.startsWith("/grocers/kroger/callback")) return next();
    const userId = c.req.header("x-user-id");
    if (!userId) throw new HTTPException(401, { message: "Missing x-user-id" });
    c.set("userId", userId);
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // ---------- chat ----------
  app.post("/chat", async (c) => {
    const { text, conversationId = "default" } = await c.req.json<{ text: string; conversationId?: string }>();
    if (!text?.trim()) throw new HTTPException(400, { message: "text is required" });
    const key = `${c.get("userId")}:${conversationId}`;
    const result = await chatTurn({ store, grocers, client: deps.anthropic }, c.get("userId"), conversations.get(key) ?? [], text);
    conversations.set(key, result.messages);
    return c.json({ text: result.text, cards: result.cards, quickReplies: result.quickReplies });
  });

  // ---------- household ----------
  app.get("/household", async (c) => c.json(await store.getHousehold(c.get("userId"))));
  app.patch("/household", async (c) => {
    const current = await store.getHousehold(c.get("userId"));
    const patch = await c.req.json();
    const next = { ...current, ...patch, id: current.id };
    await store.saveHousehold(c.get("userId"), next);
    return c.json(next);
  });

  // ---------- plans ----------
  app.post("/plans", async (c) => {
    const body = await c.req.json<{ strategy: PlanStrategy; track: PlanTrack; mealTypes?: MealType[]; weekStart: string; leftovers?: boolean; maxCookMinutes?: number }>();
    const household = await store.getHousehold(c.get("userId"));
    const prev = await store.getCurrentPlan(household.id);
    const request = { household, ...body, slots: defaultSlots(household.mode, body.mealTypes), seed: (prev?.request.seed ?? 0) + 1 };
    const plan = generateWeekPlan(request, await store.recipes());
    await store.savePlan(plan, request);
    return c.json(plan, 201);
  });

  const current = async (userId: string) => {
    const household = await store.getHousehold(userId);
    const cur = await store.getCurrentPlan(household.id);
    if (!cur) throw new HTTPException(404, { message: "No plan yet" });
    const recipes = await store.recipes();
    return { household, ...cur, recipes, byId: new Map(recipes.map((r) => [r.id, r])) };
  };

  app.get("/plans/current", async (c) => {
    const { plan, byId } = await current(c.get("userId"));
    return c.json({ plan, recipes: [...new Set(plan.meals.map((m) => m.recipeId))].map((id) => byId.get(id)) });
  });
  app.post("/plans/current/swap", async (c) => {
    const { day, slot } = await c.req.json<{ day: Weekday; slot: MealType }>();
    const { plan, request, recipes } = await current(c.get("userId"));
    const next = swapMeal(plan, day, slot, request, recipes);
    await store.savePlan(next, request);
    return c.json(next);
  });
  app.get("/plans/current/shopping-list", async (c) => {
    const { plan, byId, household } = await current(c.get("userId"));
    return c.json(buildShoppingList(plan, byId, household.pantry));
  });
  app.get("/plans/current/longevity", async (c) => {
    const { plan, byId } = await current(c.get("userId"));
    return c.json(weeklyLongevityReport(plan.meals, byId));
  });

  app.get("/recipes/:id", async (c) => {
    const r = (await store.recipes()).find((x) => x.id === c.req.param("id"));
    if (!r) throw new HTTPException(404);
    return c.json(r);
  });

  // ---------- grocers ----------
  app.get("/grocers", (c) => c.json(grocers.list()));
  app.post("/grocers/:id/cart", async (c) => {
    const adapter = grocers.get(c.req.param("id") as GrocerId);
    if (!adapter) throw new HTTPException(404, { message: "Unknown grocer" });
    const { plan, byId, household } = await current(c.get("userId"));
    const list = buildShoppingList(plan, byId, household.pantry);
    const token = await store.grocerToken?.(c.get("userId"), adapter.info().id);
    return c.json(await adapter.createCart(list, { postalCode: household.postalCode, userAccessToken: token }));
  });
  app.get("/grocers/kroger/connect", (c) => {
    const kroger = grocers.get("kroger") as KrogerAdapter | undefined;
    // TODO: sign `state` (user id + nonce) and verify it in the callback.
    return c.redirect(kroger!.authorizeUrl(c.get("userId")));
  });
  app.get("/grocers/kroger/callback", async (c) => {
    const kroger = grocers.get("kroger") as KrogerAdapter | undefined;
    const tokens = await kroger!.exchangeCode(c.req.query("code") ?? "");
    // TODO: store tokens encrypted in `grocer_accounts`, keyed by the verified state's user id.
    void tokens;
    return c.html("<p>Kroger linked. You can close this window and return to the app.</p>");
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Something went wrong" }, 500);
  });

  return app;
}
