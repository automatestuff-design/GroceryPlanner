import type { ShoppingList } from "@mealplan/core";
import { GrocerNotConfiguredError, type CartResult, type GrocerAdapter, type GrocerContext } from "../types";
import { toStoreQuantity } from "../units";

/**
 * Instacart Developer Platform — the widest single reach (Costco, Safeway, Albertsons,
 * Publix, Aldi, Sprouts, Wegmans, CVS and many regional grocers).
 * We create a hosted "shopping list" page; the user picks a store and checks out in Instacart.
 * Docs: https://docs.instacart.com/developer_platform_api/
 */
export class InstacartAdapter implements GrocerAdapter {
  constructor(private apiKey = process.env.INSTACART_API_KEY, private env = process.env.INSTACART_ENV ?? "development") {}

  private get baseUrl() {
    return this.env === "production" ? "https://connect.instacart.com" : "https://connect.dev.instacart.tools";
  }

  info() {
    return {
      id: "instacart" as const, name: "Instacart", status: "live" as const, configured: !!this.apiKey,
      capabilities: ["cart-link" as const],
      banners: ["Costco", "Safeway", "Albertsons", "Publix", "Aldi", "Sprouts", "Wegmans", "Kroger (select areas)"],
    };
  }

  async createCart(list: ShoppingList, ctx: GrocerContext): Promise<CartResult> {
    if (!this.apiKey) throw new GrocerNotConfiguredError("instacart");
    const body = {
      title: ctx.title ?? "This week's meal plan",
      link_type: "shopping_list",
      line_items: list.items.map((item) => {
        const q = toStoreQuantity(item);
        return { name: item.name, display_text: item.name, line_item_measurements: [{ quantity: q.quantity, unit: q.unit }] };
      }),
    };
    const res = await fetch(`${this.baseUrl}/idp/v1/products/products_link`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Instacart ${res.status}: ${await res.text()}`);
    const { products_link_url } = (await res.json()) as { products_link_url: string };
    // Instacart matches products on its side, so every item counts as "likely".
    return {
      grocer: "instacart",
      checkoutUrl: products_link_url,
      matched: list.items.map((item) => ({ item, packageCount: toStoreQuantity(item).quantity, confidence: "likely" })),
      unmatched: [],
    };
  }
}
