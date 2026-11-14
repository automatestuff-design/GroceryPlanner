import { Hono } from "hono";
import { z } from "zod";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type Anthropic from "@anthropic-ai/sdk";
import { chatTurn } from "@mealplan/assistant";
import {
  buildShoppingList, defaultSlots, generateWeekPlan, queryForPlan, swapMeal, weeklyLongevityReport,
  type GrocerId, type Household, type MealType, type PlanRequest, type PlanStrategy, type PlanTrack, type Weekday,
} from "@mealplan/core";
import { signState, verifyState, type Claims } from "@mealplan/db";
import { createGrocerRegistry, KrogerAdapter, type GrocerRegistry } from "@mealplan/grocers";
import { JsonLdError } from "@mealplan/recipes";
import type { Backend, RequestServices } from "./backend";

export interface AppDeps {
  backend: Backend;
  grocers?: GrocerRegistry;
  anthropic?: Anthropic;
  /** Where the Kroger OAuth callback sends the browser afterwards. */
  appUrl?: string;
}

type Env = { Variables: { claims: Claims; svc: RequestServices } };

/** Routes reachable without a signed-in user. */
const PUBLIC = new Set(["/health", "/grocers/kroger/callback"]);

/**
 * REST + chat API shared by the iOS, Android and desktop/web clients.
 * Every route except PUBLIC requires a verified Supabase session; its services
 * (store, recipes) are bound to that user, so Postgres RLS scopes every query.
 */
export function createApp(deps: AppDeps) {
  const { backend } = deps;
  const grocers = deps.grocers ?? createGrocerRegistry();
  const app = new Hono<Env>();

  // Auth is a bearer token, not a cookie, so CORS isn't the security boundary; still, list the app's origins in production.
  app.use("*", cors({ origin: process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()) ?? "*", allowHeaders: ["Authorization", "Content-Type", "x-user-id"], allowMethods: ["GET", "POST", "PATCH", "DELETE"] }));

  app.use("*", async (c, next) => {
    if (PUBLIC.has(c.req.path)) return next();
    const claims = await backend.authenticate(c.req.header("authorization"), c.req.header("x-user-id"));
    if (!claims) throw new HTTPException(401, { message: "Sign in required" });
    c.set("claims", claims);
    c.set("svc", backend.servicesFor(claims));
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true, mode: backend.mode }));
  app.get("/me", (c) => c.json({ id: c.get("claims").sub, email: c.get("claims").email ?? null }));

  // ---------- chat ----------
  app.post("/chat", async (c) => {
    const { text, conversationId = "default" } = await c.req.json<{ text: string; conversationId?: string }>();
    if (!text?.trim()) throw new HTTPException(400, { message: "text is required" });
    const { sub } = c.get("claims");
    const svc = c.get("svc");
    const history = (await svc.store.getConversation(sub, conversationId)) as Anthropic.Beta.BetaMessageParam[];
    const result = await chatTurn(
      { store: svc.store, recipes: svc.recipes, grocers, client: deps.anthropic, importRecipe: svc.importRecipe },
      sub, history, text,
    );
    await svc.store.saveConversation(sub, conversationId, result.messages);
    return c.json({ text: result.text, cards: result.cards, quickReplies: result.quickReplies });
  });

  // ---------- household ----------
  app.get("/household", async (c) => c.json(await c.get("svc").store.getHousehold(c.get("claims").sub)));
  app.patch("/household", async (c) => {
    const { store } = c.get("svc");
    const current = await store.getHousehold(c.get("claims").sub);
    const parsed = HouseholdPatch.safeParse(await c.req.json());
    if (!parsed.success) throw new HTTPException(400, { message: z.prettifyError(parsed.error) });
    const next: Household = { ...current, ...parsed.data, id: current.id };
    await store.saveHousehold(c.get("claims").sub, next);
    return c.json(await store.getHousehold(c.get("claims").sub));
  });

  // ---------- plans ----------
  app.post("/plans", async (c) => {
    const body = await c.req.json<{ strategy: PlanStrategy; track: PlanTrack; mealTypes?: MealType[]; weekStart: string; leftovers?: boolean; maxCookMinutes?: number; focus?: string }>();
    const { store, recipes } = c.get("svc");
    const household = await store.getHousehold(c.get("claims").sub);
    const prev = await store.getCurrentPlan(household.id);
    const request: PlanRequest = {
      household, strategy: body.strategy, track: body.track, weekStart: body.weekStart, leftovers: body.leftovers,
      maxCookMinutes: body.maxCookMinutes, slots: defaultSlots(household.mode, body.mealTypes), seed: (prev?.request.seed ?? 0) + 1,
    };
    const pool = await recipes.search({ ...queryForPlan(request, body.focus), seed: request.seed });
    if (!pool.length) throw new HTTPException(422, { message: "No recipes match this household's diet, allergies and time limit." });
    const plan = generateWeekPlan(request, pool);
    await store.savePlan(plan, request);
    return c.json(plan, 201);
  });

  const current = async (svc: RequestServices, userId: string) => {
    const household = await svc.store.getHousehold(userId);
    const cur = await svc.store.getCurrentPlan(household.id);
    if (!cur) throw new HTTPException(404, { message: "No plan yet" });
    const recipes = await svc.recipes.getMany([...new Set(cur.plan.meals.map((m) => m.recipeId))]);
    return { household, ...cur, recipes, byId: new Map(recipes.map((r) => [r.id, r])) };
  };

  app.get("/plans/current", async (c) => {
    const { plan, recipes } = await current(c.get("svc"), c.get("claims").sub);
    return c.json({ plan, recipes });
  });
  app.post("/plans/current/swap", async (c) => {
    const { day, slot } = await c.req.json<{ day: Weekday; slot: MealType }>();
    const svc = c.get("svc");
    const { plan, request } = await current(svc, c.get("claims").sub);
    const pool = await svc.recipes.search({ ...queryForPlan(request), seed: (request.seed ?? 0) + 100 });
    const next = swapMeal(plan, day, slot, request, pool);
    await svc.store.savePlan(next, request);
    return c.json(next);
  });
  app.get("/plans/current/shopping-list", async (c) => {
    const { plan, byId, household } = await current(c.get("svc"), c.get("claims").sub);
    return c.json(buildShoppingList(plan, byId, household.pantry));
  });
  app.get("/plans/current/longevity", async (c) => {
    const { plan, byId } = await current(c.get("svc"), c.get("claims").sub);
    return c.json(weeklyLongevityReport(plan.meals, byId));
  });

  // ---------- recipes ----------
  app.get("/recipes/:id", async (c) => {
    const [r] = await c.get("svc").recipes.getMany([c.req.param("id")]);
    if (!r) throw new HTTPException(404, { message: "Recipe not found" });
    return c.json(r);
  });
  app.post("/recipes/import", async (c) => {
    const { url } = await c.req.json<{ url: string }>();
    try {
      return c.json(await c.get("svc").importRecipe(url), 201);
    } catch (err) {
      if (err instanceof JsonLdError || err instanceof TypeError) throw new HTTPException(422, { message: err.message });
      throw err;
    }
  });

  // ---------- grocers ----------
  app.get("/grocers", (c) => c.json(grocers.list()));
  app.post("/grocers/:id/cart", async (c) => {
    const adapter = grocers.get(c.req.param("id") as GrocerId);
    if (!adapter) throw new HTTPException(404, { message: "Unknown grocer" });
    const svc = c.get("svc");
    const { plan, byId, household } = await current(svc, c.get("claims").sub);
    const list = buildShoppingList(plan, byId, household.pantry);
    const token = await svc.store.grocerToken(c.get("claims").sub, adapter.info().id);
    return c.json(await adapter.createCart(list, { postalCode: household.postalCode, userAccessToken: token }));
  });

  // Kroger account linking. The app asks for the URL (authenticated), then opens it in a browser.
  app.post("/grocers/kroger/connect", (c) => {
    const kroger = grocers.get("kroger") as KrogerAdapter | undefined;
    if (!kroger?.info().configured) throw new HTTPException(503, { message: "Kroger isn't configured" });
    return c.json({ url: kroger.authorizeUrl(signState(c.get("claims").sub)) });
  });
  app.get("/grocers/kroger/callback", async (c) => {
    const userId = verifyState(c.req.query("state") ?? "");
    const code = c.req.query("code");
    if (!userId || !code) throw new HTTPException(400, { message: "This link has expired. Start linking again from the app." });
    const kroger = grocers.get("kroger") as KrogerAdapter;
    const tokens = await kroger.exchangeCode(code);
    // The signed state proves who started this flow, so act as that user.
    await backend.servicesFor({ sub: userId }).store.saveGrocerToken(userId, "kroger", tokens);
    return deps.appUrl ? c.redirect(`${deps.appUrl}/groceries?linked=kroger`) : c.html("<p>Kroger linked. You can close this window and return to the app.</p>");
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Something went wrong" }, 500);
  });

  return app;
}

const Allergen = z.enum(["gluten", "dairy", "egg", "peanut", "tree-nut", "soy", "fish", "shellfish", "sesame"]);
/** What a client may change directly. Unknown fields (id, anything else) are dropped. */
const HouseholdPatch = z.object({
  name: z.string().min(1).max(80),
  mode: z.enum(["personal", "family"]),
  diet: z.enum(["omnivore", "pescatarian", "vegetarian", "vegan", "keto", "paleo", "mediterranean"]),
  pantry: z.array(z.string().max(80)).max(200),
  preferredGrocer: z.enum(["instacart", "kroger", "walmart", "amazon-fresh", "target", "albertsons", "costco"]),
  postalCode: z.string().max(12),
  members: z.array(z.object({
    id: z.string().max(64),
    name: z.string().min(1).max(60),
    ageGroup: z.enum(["adult", "teen", "child", "toddler"]),
    age: z.number().int().min(0).max(120).optional(),
    sex: z.enum(["female", "male"]).optional(),
    heightCm: z.number().min(40).max(250).optional(),
    weightKg: z.number().min(5).max(400).optional(),
    activity: z.enum(["sedentary", "light", "moderate", "active", "very-active"]).optional(),
    allergies: z.array(Allergen),
    dislikes: z.array(z.string().max(60)).max(50),
    portionOverride: z.number().min(0.1).max(3).optional(),
  })).min(1).max(20),
}).partial();
