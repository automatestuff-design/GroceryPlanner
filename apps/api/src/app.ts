import { Hono } from "hono";
import { z } from "zod";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type Anthropic from "@anthropic-ai/sdk";
import { chatTurn, loadGroceryList } from "@mealplan/assistant";
import {
  defaultSlots, generateWeekPlan, queryForPlan, swapMeal, weeklyLongevityReport,
  type Household, type MealType, type PlanRequest, type PlanStrategy, type PlanTrack, type Weekday,
} from "@mealplan/core";
import type { Claims } from "@mealplan/db";
import { JsonLdError } from "@mealplan/recipes";
import type { Backend, RequestServices } from "./backend";

export interface AppDeps {
  backend: Backend;
  anthropic?: Anthropic;
}

type Env = { Variables: { claims: Claims; svc: RequestServices } };

/** Routes reachable without a signed-in user. */
const PUBLIC = new Set(["/health"]);

/**
 * REST + chat API shared by the iOS, Android and desktop/web clients.
 * Every route except PUBLIC requires a verified Supabase session; its services
 * (store, recipes) are bound to that user, so Postgres RLS scopes every query.
 */
export function createApp(deps: AppDeps) {
  const { backend } = deps;
  const app = new Hono<Env>();

  // Auth is a bearer token, not a cookie, so CORS isn't the security boundary; still, list the app's origins in production.
  app.use("*", cors({ origin: corsOrigins(process.env.CORS_ORIGINS), allowHeaders: ["Authorization", "Content-Type", "x-user-id"], allowMethods: ["GET", "POST", "PATCH", "DELETE"] }));

  app.use("*", async (c, next) => {
    if (PUBLIC.has(c.req.path)) return next();
    const auth = await backend.authenticate(c.req.header("authorization"), c.req.header("x-user-id"));
    if ("error" in auth) {
      console.warn(`[auth] 401 ${c.req.method} ${c.req.path}: ${auth.error}`);
      throw new HTTPException(401, { message: auth.error });
    }
    const { claims } = auth;
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
      { store: svc.store, recipes: svc.recipes, client: deps.anthropic, importRecipe: svc.importRecipe },
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

  // ---------- grocery list ----------
  // The list is the current plan's ingredients plus the household's own items.
  // Check-offs and own items are saved, so the list is the same on every device.
  const groceryList = async (svc: RequestServices, userId: string) => {
    const household = await svc.store.getHousehold(userId);
    return { household, list: await loadGroceryList(svc.store, svc.recipes, household) };
  };

  app.get("/shopping-list", async (c) => c.json((await groceryList(c.get("svc"), c.get("claims").sub)).list));

  app.post("/shopping-list/check", async (c) => {
    const body = parse(CheckBody, await c.req.json());
    const svc = c.get("svc");
    const { household } = await groceryList(svc, c.get("claims").sub);
    const current = await svc.store.getCurrentPlan(household.id);
    if (!current) throw new HTTPException(409, { message: "There's no plan yet, so there's nothing to check off." });
    await svc.store.setChecked(current.plan.id, body.key, body.checked);
    return c.json((await groceryList(svc, c.get("claims").sub)).list);
  });

  app.post("/shopping-list/extras", async (c) => {
    const body = parse(AddExtrasBody, await c.req.json());
    const svc = c.get("svc");
    const household = await svc.store.getHousehold(c.get("claims").sub);
    await svc.store.addExtras(household.id, body.items);
    return c.json((await groceryList(svc, c.get("claims").sub)).list, 201);
  });

  app.patch("/shopping-list/extras/:id", async (c) => {
    const body = parse(UpdateExtraBody, await c.req.json());
    const svc = c.get("svc");
    const household = await svc.store.getHousehold(c.get("claims").sub);
    if (!(await svc.store.updateExtra(household.id, c.req.param("id"), body))) throw new HTTPException(404, { message: "Item not found" });
    return c.json((await groceryList(svc, c.get("claims").sub)).list);
  });

  app.delete("/shopping-list/extras/:id", async (c) => {
    const svc = c.get("svc");
    const household = await svc.store.getHousehold(c.get("claims").sub);
    if (!(await svc.store.removeExtras(household.id, [c.req.param("id")]))) throw new HTTPException(404, { message: "Item not found" });
    return c.json((await groceryList(svc, c.get("claims").sub)).list);
  });

  /** After a shopping trip: drop the household's own items that are checked off. */
  app.post("/shopping-list/clear-checked", async (c) => {
    const svc = c.get("svc");
    const { household, list } = await groceryList(svc, c.get("claims").sub);
    await svc.store.removeExtras(household.id, list.extras.filter((e) => e.checked).map((e) => e.id));
    return c.json((await groceryList(svc, c.get("claims").sub)).list);
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Something went wrong" }, 500);
  });

  return app;
}

/**
 * CORS_ORIGINS from .env. A blank `CORS_ORIGINS=` line arrives as "", not undefined,
 * and must mean "any origin" like an absent one: an empty allow-list blocks the app.
 */
export function corsOrigins(raw: string | undefined): string | string[] {
  const list = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : "*";
}

const Allergen = z.enum(["gluten", "dairy", "egg", "peanut", "tree-nut", "soy", "fish", "shellfish", "sesame"]);
/** What a client may change directly. Unknown fields (id, anything else) are dropped. */
const CheckBody = z.object({ key: z.string().min(1).max(200), checked: z.boolean() });
const ExtraInput = z.object({ name: z.string().trim().min(1).max(80), quantity: z.string().trim().max(40).optional() });
const AddExtrasBody = z.object({ items: z.array(ExtraInput).min(1).max(50) });
const UpdateExtraBody = z.object({
  checked: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  quantity: z.string().trim().max(40).nullable().optional(),
});

/** Validate a request body or answer 400 with what's wrong. */
function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HTTPException(400, { message: z.prettifyError(r.error) });
  return r.data;
}

const HouseholdPatch = z.object({
  name: z.string().min(1).max(80),
  mode: z.enum(["personal", "family"]),
  diet: z.enum(["omnivore", "pescatarian", "vegetarian", "vegan", "keto", "paleo", "mediterranean"]),
  pantry: z.array(z.string().max(80)).max(200),
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
