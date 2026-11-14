import type { GrocerId } from "@mealplan/core";
import type { GrocerAdapter, GrocerInfo } from "./types";
import { InstacartAdapter } from "./adapters/instacart";
import { KrogerAdapter } from "./adapters/kroger";
import { amazonFresh, target, walmart } from "./adapters/partner";

/**
 * Single place the app asks "who can fulfil this list?". Adding a grocer = one adapter + one line here.
 * Costco, Albertsons/Safeway and most regional chains are reached through Instacart.
 */
export function createGrocerRegistry(adapters: GrocerAdapter[] = [new InstacartAdapter(), new KrogerAdapter(), walmart, amazonFresh, target]) {
  const byId = new Map<GrocerId, GrocerAdapter>(adapters.map((a) => [a.info().id, a]));
  return {
    list(): GrocerInfo[] {
      return adapters.map((a) => a.info());
    },
    get(id: GrocerId): GrocerAdapter | undefined {
      return byId.get(id);
    },
    /** Best available grocer for a user: their preference if usable, else the first live+configured one. */
    pick(preferred?: GrocerId): GrocerAdapter | undefined {
      const pref = preferred && byId.get(preferred);
      if (pref && pref.info().configured) return pref;
      return adapters.find((a) => a.info().status === "live" && a.info().configured) ?? pref;
    },
  };
}
export type GrocerRegistry = ReturnType<typeof createGrocerRegistry>;
