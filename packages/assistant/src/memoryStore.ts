import type { ExtraItem, Household, PlanRequest, WeekPlan } from "@mealplan/core";
import type { PlannerStore } from "./store";

/** In-memory store for local dev and tests. New users start in personal mode. */
export class MemoryStore implements PlannerStore {
  private households = new Map<string, Household>();
  private plans = new Map<string, { plan: WeekPlan; request: PlanRequest }>();
  private conversations = new Map<string, unknown[]>();
  private checks = new Map<string, Set<string>>();
  private extras = new Map<string, ExtraItem[]>();

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

  async getCheckedKeys(planId: string) { return [...(this.checks.get(planId) ?? [])]; }
  async setChecked(planId: string, key: string, checked: boolean) {
    const set = this.checks.get(planId) ?? new Set<string>();
    if (checked) set.add(key); else set.delete(key);
    this.checks.set(planId, set);
  }
  async listExtras(householdId: string) { return [...(this.extras.get(householdId) ?? [])]; }
  async addExtras(householdId: string, items: { name: string; quantity?: string }[]) {
    const added = items.map((i) => ({ id: crypto.randomUUID(), name: i.name.trim(), quantity: i.quantity?.trim() || undefined, checked: false }));
    this.extras.set(householdId, [...(this.extras.get(householdId) ?? []), ...added]);
    return added;
  }
  async updateExtra(householdId: string, id: string, patch: { checked?: boolean; name?: string; quantity?: string | null }) {
    const list = this.extras.get(householdId) ?? [];
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return null;
    const next: ExtraItem = {
      ...list[i]!,
      ...(patch.checked !== undefined ? { checked: patch.checked } : {}),
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.quantity !== undefined ? { quantity: patch.quantity?.trim() || undefined } : {}),
    };
    list[i] = next;
    return next;
  }
  async removeExtras(householdId: string, ids: string[]) {
    const list = this.extras.get(householdId) ?? [];
    const keep = list.filter((e) => !ids.includes(e.id));
    this.extras.set(householdId, keep);
    return list.length - keep.length;
  }
}
