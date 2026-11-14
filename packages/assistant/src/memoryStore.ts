import type { Household, PlanRequest, WeekPlan } from "@mealplan/core";
import type { PlannerStore } from "./store";

/** In-memory store for local dev and tests. New users start in personal mode. */
export class MemoryStore implements PlannerStore {
  private households = new Map<string, Household>();
  private plans = new Map<string, { plan: WeekPlan; request: PlanRequest }>();
  private conversations = new Map<string, unknown[]>();
  private tokens = new Map<string, string>();

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
  async getConversation(userId: string, key: string) { return this.conversations.get(`${userId}:${key}`) ?? []; }
  async saveConversation(userId: string, key: string, messages: unknown[]) { this.conversations.set(`${userId}:${key}`, messages); }
  async grocerToken(userId: string, grocer: string) { return this.tokens.get(`${userId}:${grocer}`); }
  async saveGrocerToken(userId: string, grocer: string, t: { accessToken: string }) { this.tokens.set(`${userId}:${grocer}`, t.accessToken); }
}
