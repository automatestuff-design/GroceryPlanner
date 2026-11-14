import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import {
  WEEKDAYS, buildShoppingList, defaultSlots, generateWeekPlan, swapMeal, weeklyLongevityReport, queryForPlan,
  dailyTargets, type Household, type Member, type PlanRequest, type Recipe, type RecipeProvider, type WeekPlan,
} from "@mealplan/core";
import type { GrocerRegistry } from "@mealplan/grocers";
import type { Card } from "./cards";
import type { PlannerStore } from "./store";

const MealType = z.enum(["breakfast", "lunch", "dinner", "snack"]);
const Weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const Allergen = z.enum(["gluten", "dairy", "egg", "peanut", "tree-nut", "soy", "fish", "shellfish", "sesame"]);

const MemberInput = z.strictObject({
  name: z.string().describe("First name"),
  ageGroup: z.enum(["adult", "teen", "child", "toddler"]),
  age: z.number().int().optional(),
  sex: z.enum(["female", "male"]).optional(),
  heightCm: z.number().optional(),
  weightKg: z.number().optional(),
  activity: z.enum(["sedentary", "light", "moderate", "active", "very-active"]).optional(),
  allergies: z.array(Allergen).optional(),
  dislikes: z.array(z.string()).optional(),
});

export interface ToolContext {
  userId: string;
  store: PlannerStore;
  recipes: RecipeProvider;
  grocers: GrocerRegistry;
  cards: Card[];
  /** Imports a recipe page into this household's private library. Absent when importing is disabled. */
  importRecipe?: (url: string) => Promise<Recipe>;
}

interface ToolDef<S extends z.ZodType> {
  description: string;
  input: S;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}
const tool = <S extends z.ZodType>(d: ToolDef<S>) => d;

/**
 * The assistant's whole surface. Each tool calls the deterministic engine; the
 * model decides *what* to do from the conversation, never *what the numbers are*.
 */
export const TOOLS = {
  get_household: tool({
    description: "Read the user's household: personal or family mode, members, diet, allergies, pantry and preferred grocer. Call this first in a new conversation.",
    input: z.strictObject({}),
    run: async (_, ctx) => {
      const h = await ctx.store.getHousehold(ctx.userId);
      return { ...h, members: h.members.map((m) => ({ ...m, dailyTargets: dailyTargets(m, "standard") })) };
    },
  }),

  update_household: tool({
    description: "Change household settings: switch between personal (just me) and family mode, set the diet, add/update/remove members, update pantry staples or the preferred grocer. Only pass fields that change.",
    input: z.strictObject({
      mode: z.enum(["personal", "family"]).optional(),
      diet: z.enum(["omnivore", "pescatarian", "vegetarian", "vegan", "keto", "paleo", "mediterranean"]).optional(),
      upsertMembers: z.array(MemberInput).optional().describe("Members to add, or update when the name matches an existing member"),
      removeMembers: z.array(z.string()).optional().describe("Names of members to remove"),
      pantryAdd: z.array(z.string()).optional(),
      pantryRemove: z.array(z.string()).optional(),
      preferredGrocer: z.enum(["instacart", "kroger", "walmart", "amazon-fresh", "target"]).optional(),
      postalCode: z.string().optional(),
    }),
    run: async (input, ctx) => {
      const h = await ctx.store.getHousehold(ctx.userId);
      const next: Household = {
        ...h,
        mode: input.mode ?? h.mode,
        diet: input.diet ?? h.diet,
        preferredGrocer: input.preferredGrocer ?? h.preferredGrocer,
        postalCode: input.postalCode ?? h.postalCode,
        pantry: [...new Set([...h.pantry, ...(input.pantryAdd ?? [])])].filter((p) => !input.pantryRemove?.includes(p)),
        members: upsertMembers(h.members, input.upsertMembers ?? [], input.removeMembers ?? []),
      };
      await ctx.store.saveHousehold(ctx.userId, next);
      ctx.cards.push({ type: "household", household: next });
      return next;
    },
  }),

  create_week_plan: tool({
    description:
      "Generate a week of meals. strategy 'meal-type' picks meals for the chosen slots; 'macro' also fits each day to the main adult's calorie/protein targets. track 'longevity' favours 30 g+ protein meals, fiber, oily fish, legumes and fermented foods for midlife muscle span and healthspan. Replaces the current plan.",
    input: z.strictObject({
      strategy: z.enum(["meal-type", "macro"]),
      track: z.enum(["standard", "longevity"]),
      mealTypes: z.array(MealType).optional().describe("Meals to plan each day. Default: dinner only for personal, breakfast/lunch/dinner for family"),
      days: z.array(Weekday).optional().describe("Days to plan. Default: all seven"),
      maxCookMinutes: z.number().int().optional(),
      leftovers: z.boolean().optional().describe("Cook dinner once and eat it again for the next day's lunch"),
      weekStart: z.string().optional().describe("ISO date of the Monday. Default: next Monday"),
      focus: z.string().optional().describe("Ingredient or style to lean towards, e.g. 'salmon', 'sheet pan', 'mexican'"),
    }),
    run: async (input, ctx) => {
      const household = await ctx.store.getHousehold(ctx.userId);
      const days = input.days ?? WEEKDAYS;
      const all = defaultSlots(household.mode, input.mealTypes);
      const slots = Object.fromEntries(days.map((d) => [d, all[d] ?? []]));
      const prev = await ctx.store.getCurrentPlan(household.id);
      const request: PlanRequest = {
        household, slots, strategy: input.strategy, track: input.track,
        weekStart: input.weekStart ?? nextMonday(), maxCookMinutes: input.maxCookMinutes, leftovers: input.leftovers,
        seed: (prev?.request.seed ?? 0) + 1,
      };
      let recipes = await ctx.recipes.search({ ...queryForPlan(request, input.focus), seed: request.seed });
      if (input.focus && recipes.length < 7) recipes = [...recipes, ...(await ctx.recipes.search({ ...queryForPlan(request), seed: request.seed }))];
      if (!recipes.length) throw new Error("No recipes match this household's diet, allergies and time limit.");
      const plan = generateWeekPlan(request, recipes);
      await ctx.store.savePlan(plan, request);
      ctx.cards.push(planCard(plan, recipes));
      return summarisePlan(plan, recipes);
    },
  }),

  swap_meal: tool({
    description: "Replace one planned meal with the next-best option that fits the household.",
    input: z.strictObject({ day: Weekday, slot: MealType }),
    run: async (input, ctx) => {
      const { current, recipes: inPlan } = await requirePlan(ctx);
      const pool = await ctx.recipes.search({ ...queryForPlan(current.request), seed: (current.request.seed ?? 0) + 100 });
      const plan = swapMeal(current.plan, input.day, input.slot, current.request, pool);
      await ctx.store.savePlan(plan, current.request);
      const recipes = [...inPlan, ...pool];
      ctx.cards.push(planCard(plan, recipes));
      return summarisePlan(plan, recipes);
    },
  }),

  get_shopping_list: tool({
    description: "Build the grocery list for the current plan, scaled to the household and grouped by aisle. Pantry staples are left off.",
    input: z.strictObject({}),
    run: async (_, ctx) => {
      const { current, recipes, household } = await requirePlan(ctx);
      const list = buildShoppingList(current.plan, byId(recipes), household.pantry);
      ctx.cards.push({ type: "shopping-list", list });
      return { itemCount: list.items.length, pantryExcluded: list.pantryExcluded, items: list.items.map((i) => `${i.quantity} ${i.unit} ${i.name}`) };
    },
  }),

  get_longevity_report: tool({
    description: "Score the current plan against the Longevity goals (protein and leucine per meal, fiber, oily fish, legumes, fermented foods, plant variety).",
    input: z.strictObject({}),
    run: async (_, ctx) => {
      const { current, recipes } = await requirePlan(ctx);
      const report = weeklyLongevityReport(current.plan.meals, byId(recipes));
      ctx.cards.push({ type: "longevity", report });
      return report;
    },
  }),

  import_recipe_from_url: tool({
    description: "Save a recipe from a web page the user shares into their household's private recipe library, so the planner can use it. Only works for pages that publish nutrition information.",
    input: z.strictObject({ url: z.string().describe("The recipe page URL the user gave") }),
    run: async (input, ctx) => {
      if (!ctx.importRecipe) throw new Error("Recipe import isn't available right now.");
      const r = await ctx.importRecipe(input.url);
      return { id: r.id, title: r.title, servings: r.servings, minutes: r.timeMinutes, perServing: r.nutritionPerServing, mealTypes: r.mealTypes };
    },
  }),

  list_grocers: tool({
    description: "List grocery integrations, which are live, and which need a partnership before ordering works.",
    input: z.strictObject({}),
    run: async (_, ctx) => ctx.grocers.list(),
  }),

  send_to_grocer: tool({
    description: "Send the current grocery list to a grocer. Creates a cart or cart link the user reviews and checks out themselves; it never places or pays for an order. Ask the user which grocer first if they have no preference.",
    input: z.strictObject({ grocer: z.enum(["instacart", "kroger", "walmart", "amazon-fresh", "target"]).optional() }),
    run: async (input, ctx) => {
      const { current, recipes, household } = await requirePlan(ctx);
      const adapter = input.grocer ? ctx.grocers.get(input.grocer) : ctx.grocers.pick(household.preferredGrocer);
      if (!adapter) throw new Error("No grocer is configured yet.");
      const info = adapter.info();
      const list = buildShoppingList(current.plan, byId(recipes), household.pantry);
      const cart = await adapter.createCart(list, {
        postalCode: household.postalCode, title: `Meals for the week of ${current.plan.weekStart}`,
        userAccessToken: await ctx.store.grocerToken?.(ctx.userId, info.id),
      });
      ctx.cards.push({ type: "cart", cart, grocerName: info.name });
      return { grocer: info.name, status: info.status, checkoutUrl: cart.checkoutUrl, matched: cart.matched.length, unmatched: cart.unmatched.map((u) => u.name) };
    },
  }),
};

export type ToolName = keyof typeof TOOLS;

/** Tool definitions for the Messages API, generated from the zod schemas. */
export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    input_schema: z.toJSONSchema(t.input) as Anthropic.Beta.BetaTool.InputSchema,
  }));
}

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const t = TOOLS[name as ToolName] as ToolDef<z.ZodType> | undefined;
  if (!t) return { content: `Unknown tool: ${name}`, isError: true };
  const parsed = t.input.safeParse(rawInput);
  if (!parsed.success) return { content: `Invalid input: ${z.prettifyError(parsed.error)}`, isError: true };
  try {
    return { content: JSON.stringify(await t.run(parsed.data, ctx)), isError: false };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}

// ---------- helpers ----------

async function requirePlan(ctx: ToolContext) {
  const household = await ctx.store.getHousehold(ctx.userId);
  const current = await ctx.store.getCurrentPlan(household.id);
  if (!current) throw new Error("There is no plan yet. Create one with create_week_plan.");
  const recipes = await ctx.recipes.getMany([...new Set(current.plan.meals.map((m) => m.recipeId))]);
  return { household, current, recipes };
}

function upsertMembers(existing: Member[], upserts: z.infer<typeof MemberInput>[], removals: string[]): Member[] {
  const out = existing.filter((m) => !removals.some((r) => r.toLowerCase() === m.name.toLowerCase()));
  for (const u of upserts) {
    const i = out.findIndex((m) => m.name.toLowerCase() === u.name.toLowerCase());
    if (i >= 0) out[i] = { ...out[i]!, ...u, allergies: u.allergies ?? out[i]!.allergies, dislikes: u.dislikes ?? out[i]!.dislikes };
    else out.push({ id: crypto.randomUUID(), ...u, allergies: u.allergies ?? [], dislikes: u.dislikes ?? [] });
  }
  return out;
}

const byId = (recipes: Recipe[]) => new Map(recipes.map((r) => [r.id, r]));

function planCard(plan: WeekPlan, recipes: Recipe[]): Card {
  const ids = new Set(plan.meals.map((m) => m.recipeId));
  return {
    type: "plan", plan,
    recipes: [...new Map(recipes.filter((r) => ids.has(r.id)).map((r) => [r.id, r])).values()]
      .map(({ id, title, timeMinutes, nutritionPerServing, imageUrl, source }) => ({ id, title, timeMinutes, nutritionPerServing, imageUrl, source })),
  };
}

function summarisePlan(plan: WeekPlan, recipes: Recipe[]) {
  const map = byId(recipes);
  return {
    weekStart: plan.weekStart, strategy: plan.strategy, track: plan.track,
    meals: plan.meals.map((m) => {
      const r = map.get(m.recipeId);
      return { day: m.day, slot: m.slot, title: r?.title, minutes: r?.timeMinutes, servings: m.servings, proteinG: r?.nutritionPerServing.proteinG, kcal: r?.nutritionPerServing.calories, leftover: !!m.leftoverOf };
    }),
  };
}

function nextMonday(from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + (((8 - d.getUTCDay()) % 7) || 7));
  return d.toISOString().slice(0, 10);
}
