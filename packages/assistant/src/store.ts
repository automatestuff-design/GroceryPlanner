import type { Household, PlanRequest, Recipe, WeekPlan } from "@mealplan/core";

/** Persistence the assistant needs. apps/api provides an in-memory and a Supabase implementation. */
export interface PlannerStore {
  getHousehold(userId: string): Promise<Household>;
  saveHousehold(userId: string, household: Household): Promise<void>;
  getCurrentPlan(householdId: string): Promise<{ plan: WeekPlan; request: PlanRequest } | null>;
  savePlan(plan: WeekPlan, request: PlanRequest): Promise<void>;
  recipes(): Promise<Recipe[]>;
  /** OAuth token for a linked grocer account, if the user linked one. */
  grocerToken?(userId: string, grocer: string): Promise<string | undefined>;
}
