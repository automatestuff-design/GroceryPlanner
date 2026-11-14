import type {
  Household, LongevityReport, MealType, PlanStrategy, PlanTrack, Recipe, ShoppingList, WeekPlan, Weekday,
} from "@mealplan/core";

/** Mirrors packages/assistant Card; kept as a type-only import so the app never bundles server code. */
export type Card =
  | { type: "household"; household: Household }
  | { type: "plan"; plan: WeekPlan; recipes: Pick<Recipe, "id" | "title" | "timeMinutes" | "nutritionPerServing" | "imageUrl">[] }
  | { type: "shopping-list"; list: ShoppingList }
  | { type: "longevity"; report: LongevityReport }
  | { type: "cart"; cart: { checkoutUrl?: string; matched: unknown[]; unmatched: unknown[] }; grocerName: string };

export interface ChatReply { text: string; cards: Card[]; quickReplies: string[] }
export interface GrocerInfo { id: string; name: string; status: "live" | "partner"; configured: boolean; banners?: string[] }

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";
// TODO: replace with the Supabase session's access token once auth is wired up.
const USER_ID = "dev-user";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-user-id": USER_ID, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export const api = {
  chat: (text: string) => req<ChatReply>("/chat", { method: "POST", body: JSON.stringify({ text }) }),
  household: () => req<Household>("/household"),
  updateHousehold: (patch: Partial<Household>) => req<Household>("/household", { method: "PATCH", body: JSON.stringify(patch) }),
  createPlan: (body: { strategy: PlanStrategy; track: PlanTrack; mealTypes?: MealType[]; weekStart: string; leftovers?: boolean }) =>
    req<WeekPlan>("/plans", { method: "POST", body: JSON.stringify(body) }),
  currentPlan: () => req<{ plan: WeekPlan; recipes: Recipe[] }>("/plans/current"),
  swap: (day: Weekday, slot: MealType) => req<WeekPlan>("/plans/current/swap", { method: "POST", body: JSON.stringify({ day, slot }) }),
  shoppingList: () => req<ShoppingList>("/plans/current/shopping-list"),
  longevity: () => req<LongevityReport>("/plans/current/longevity"),
  recipe: (id: string) => req<Recipe>(`/recipes/${id}`),
  grocers: () => req<GrocerInfo[]>("/grocers"),
  sendToGrocer: (id: string) => req<{ checkoutUrl?: string }>(`/grocers/${id}/cart`, { method: "POST" }),
};

export function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return d.toISOString().slice(0, 10);
}
