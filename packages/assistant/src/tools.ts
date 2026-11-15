import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import {
  WEEKDAYS, defaultSlots, formatQuantity, generateWeekPlan, swapMeal, weeklyLongevityReport, queryForPlan,
  dailyTargets, type GroceryList, type Household, type Member, type PlanRequest, type Recipe, type RecipeProvider, type WeekPlan,
} from "@mealplan/core";
import type { Card } from "./cards";
import { findByName, loadGroceryList } from "./groceryList";
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
  cards: Card[];
  /** Saves a shared recipe (link and/or pasted text) to this household's private library. Absent when importing is disabled. */
  importRecipe?: (req: { url?: string; text?: string }) => Promise<Recipe>;
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
    description: "Read the user's household: personal or family mode, members, diet, allergies and pantry staples. Call this first in a new conversation.",
    input: z.strictObject({}),
    run: async (_, ctx) => {
      const h = await ctx.store.getHousehold(ctx.userId);
      return { ...h, members: h.members.map((m) => ({ ...m, dailyTargets: dailyTargets(m, "standard") })) };
    },
  }),

  update_household: tool({
    description: "Change household settings: switch between personal (just me) and family mode, set the diet, add/update/remove members, or update pantry staples (always-on-hand items left off the grocery list). Only pass fields that change.",
    input: z.strictObject({
      mode: z.enum(["personal", "family"]).optional(),
      diet: z.enum(["omnivore", "pescatarian", "vegetarian", "vegan", "keto", "paleo", "mediterranean"]).optional(),
      upsertMembers: z.array(MemberInput).optional().describe("Members to add, or update when the name matches an existing member"),
      removeMembers: z.array(z.string()).optional().describe("Names of members to remove"),
      pantryAdd: z.array(z.string()).optional(),
      pantryRemove: z.array(z.string()).optional(),
    }),
    run: async (input, ctx) => {
      const h = await ctx.store.getHousehold(ctx.userId);
      const next: Household = {
        ...h,
        mode: input.mode ?? h.mode,
        diet: input.diet ?? h.diet,
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
    description: "Show the grocery list: the current plan's ingredients (scaled to the household, grouped by aisle, pantry staples left off) plus items the user added themselves, with what's already checked off. Works without a plan.",
    input: z.strictObject({}),
    run: async (_, ctx) => {
      const list = await loadGroceryList(ctx.store, ctx.recipes, await ctx.store.getHousehold(ctx.userId));
      ctx.cards.push({ type: "shopping-list", list });
      return summariseList(list);
    },
  }),

  add_to_shopping_list: tool({
    description: "Add items the user wants that aren't from the meal plan (\"paper towels\", \"2 litres of milk\"). They stay on the list when the plan changes, until removed.",
    input: z.strictObject({
      items: z.array(z.strictObject({
        name: z.string().min(1).max(80),
        quantity: z.string().max(40).optional().describe("Free text, e.g. '2 rolls' or '1 L'"),
      })).min(1).max(30),
    }),
    run: async (input, ctx) => {
      const household = await ctx.store.getHousehold(ctx.userId);
      const added = await ctx.store.addExtras(household.id, input.items);
      const list = await loadGroceryList(ctx.store, ctx.recipes, household);
      ctx.cards.push({ type: "shopping-list", list });
      return { added: added.map((a) => a.name), list: summariseList(list) };
    },
  }),

  update_shopping_list: tool({
    description:
      "Check off items the user has bought or already has, uncheck them, or remove items they added themselves. Plan ingredients can't be removed, only checked off; for things they always keep at home, add them to the pantry with update_household instead.",
    input: z.strictObject({
      checkOff: z.array(z.string()).optional().describe("Item names to mark as got"),
      uncheck: z.array(z.string()).optional(),
      remove: z.array(z.string()).optional().describe("Names of items the user added themselves"),
    }),
    run: async (input, ctx) => {
      const household = await ctx.store.getHousehold(ctx.userId);
      let list = await loadGroceryList(ctx.store, ctx.recipes, household);
      const notFound: string[] = [];
      const cantRemove: string[] = [];

      const setChecked = async (name: string, checked: boolean) => {
        const item = findByName(list.items, name);
        if (item && list.planId) return ctx.store.setChecked(list.planId, item.key, checked);
        const extra = findByName(list.extras, name);
        if (extra) return void (await ctx.store.updateExtra(household.id, extra.id, { checked }));
        notFound.push(name);
      };
      for (const n of input.checkOff ?? []) await setChecked(n, true);
      for (const n of input.uncheck ?? []) await setChecked(n, false);

      const removeIds: string[] = [];
      for (const n of input.remove ?? []) {
        const extra = findByName(list.extras, n);
        if (extra) removeIds.push(extra.id);
        else if (findByName(list.items, n)) cantRemove.push(n);
        else notFound.push(n);
      }
      await ctx.store.removeExtras(household.id, removeIds);

      list = await loadGroceryList(ctx.store, ctx.recipes, household);
      ctx.cards.push({ type: "shopping-list", list });
      return { notFound, cantRemoveBecauseFromPlan: cantRemove, list: summariseList(list) };
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

  save_recipe: tool({
    description:
      "Save a recipe the user shares into their household's private recipe library so the planner can use it. Accepts a recipe web page link, a TikTok link, or the recipe text the user pasted (ingredients with amounts), or a link plus pasted text. TikTok doesn't share captions with apps, so a TikTok link needs the pasted ingredients too; if the user only gave the link, the result explains what to send. Nutrition is calculated from the ingredients when the source doesn't publish it.",
    input: z.strictObject({
      url: z.string().optional().describe("Recipe page or TikTok link the user gave"),
      recipeText: z.string().optional().describe("The recipe or ingredient list the user pasted, verbatim"),
    }),
    run: async (input, ctx) => {
      if (!ctx.importRecipe) throw new Error("Recipe import isn't available right now.");
      if (!input.url && !input.recipeText?.trim()) throw new Error("Ask the user for a recipe link or the recipe text.");
      const r = await ctx.importRecipe({ url: input.url, text: input.recipeText });
      return {
        id: r.id, title: r.title, servings: r.servings, minutes: r.timeMinutes, perServing: r.nutritionPerServing, mealTypes: r.mealTypes,
        source: r.source?.name,
        nutrition: r.nutritionBasis && {
          how: r.nutritionBasis.method === "published" ? "published by the source" : `calculated from the ingredients (${r.nutritionBasis.database})`,
          notCounted: r.nutritionBasis.missing,
          approximate: r.nutritionBasis.uncertain,
          servingsEstimated: r.nutritionBasis.servingsEstimated ?? false,
        },
      };
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

/** Compact view of the list for the model: what's left, what's done, what the user added. */
function summariseList(list: GroceryList) {
  return {
    hasPlan: list.planId !== null,
    toBuy: list.items.filter((i) => !i.checked).map((i) => `${i.name} (${formatQuantity(i.quantity, i.unit)})`),
    checkedOff: list.items.filter((i) => i.checked).map((i) => i.name),
    ownItems: list.extras.map((e) => ({ name: e.name, quantity: e.quantity, checked: e.checked })),
    pantryLeftOff: list.pantryExcluded,
  };
}
