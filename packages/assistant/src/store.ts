import type { Household, PlanRequest, WeekPlan } from "@mealplan/core";

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
  /** OAuth token for a linked grocer account, if the user linked one. */
  grocerToken(userId: string, grocer: string): Promise<string | undefined>;
  saveGrocerToken(userId: string, grocer: string, token: { accessToken: string; refreshToken?: string; expiresIn: number }): Promise<void>;
}
