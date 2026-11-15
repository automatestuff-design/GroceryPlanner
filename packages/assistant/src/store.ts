import type { ExtraItem, Household, PlanRequest, WeekPlan } from "@mealplan/core";

/**
 * Persistence the assistant needs. Implementations: MemoryStore (dev/tests) and
 * PostgresStore (packages/db), which runs every query as the signed-in user so
 * Supabase row-level security applies. Recipes come from a RecipeProvider instead.
 */
export interface PlannerStore {
  getHousehold(userId: string): Promise<Household>;
  saveHousehold(userId: string, household: Household): Promise<void>;
  getCurrentPlan(householdId: string): Promise<{ plan: WeekPlan; request: PlanRequest } | null>;
  savePlan(plan: WeekPlan, request: PlanRequest): Promise<void>;
  /** Messages API content blocks, append-only. */
  getConversation(userId: string, key: string): Promise<unknown[]>;
  saveConversation(userId: string, key: string, messages: unknown[]): Promise<void>;

  // ---------- grocery list ----------
  /** Keys (see itemKey) of the plan's ingredients the household has checked off. */
  getCheckedKeys(planId: string): Promise<string[]>;
  setChecked(planId: string, key: string, checked: boolean): Promise<void>;
  /** The household's own items, oldest first. */
  listExtras(householdId: string): Promise<ExtraItem[]>;
  addExtras(householdId: string, items: { name: string; quantity?: string }[]): Promise<ExtraItem[]>;
  /** Returns null when the item doesn't exist or belongs to another household. */
  updateExtra(householdId: string, id: string, patch: { checked?: boolean; name?: string; quantity?: string | null }): Promise<ExtraItem | null>;
  /** Removes the given items; returns how many were removed. */
  removeExtras(householdId: string, ids: string[]): Promise<number>;
}
