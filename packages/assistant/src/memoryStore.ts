import { SAMPLE_RECIPES, type Household, type PlanRequest, type Recipe, type WeekPlan } from "@mealplan/core";
import type { PlannerStore } from "./store";

/** In-memory store for local dev and tests. New users start in personal mode. */
export class MemoryStore implements PlannerStore {
  private households = new Map<string, Household>();
  private plans = new Map<string, { plan: WeekPlan; request: PlanRequest }>();
  constructor(private recipeList: Recipe[] = SAMPLE_RECIPES) {}

  async getHousehold(userId: string): Promise<Household> {
    let h = this.households.get(userId);
    if (!h) {
      h = { id: `hh_${userId}`, name: "My kitchen", mode: "personal", diet: "omnivore", pantry: ["salt", "black pepper", "olive oil"],
        members: [{ id: `m_${userId}`, name: "Me", ageGroup: "adult", allergies: [], dislikes: [] }] };
      this.households.set(userId, h);
    }
    return h;
  }
  async saveHousehold(userId: string, h: Household) { this.households.set(userId, h); }
  async getCurrentPlan(householdId: string) { return this.plans.get(householdId) ?? null; }
  async savePlan(plan: WeekPlan, request: PlanRequest) { this.plans.set(plan.householdId, { plan, request }); }
  async recipes() { return this.recipeList; }
}
