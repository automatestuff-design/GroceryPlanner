import type { GrocerId, ShoppingList } from "@mealplan/core";
import type { CartResult, GrocerAdapter, GrocerCapability } from "../types";

/**
 * Grocers without a public cart API. Each needs a partnership (or affiliate program)
 * before ordering can be automated. Until then the adapter returns a search link per
 * item so the user can still shop the list, and the UI labels it "coming soon".
 */
export class PartnerGrocerAdapter implements GrocerAdapter {
  constructor(
    private id: GrocerId,
    private name: string,
    private searchUrl: (q: string) => string,
    private plannedCapabilities: GrocerCapability[],
    private note: string,
  ) {}

  info() {
    return { id: this.id, name: this.name, status: "partner" as const, configured: false, capabilities: this.plannedCapabilities, banners: [this.note] };
  }

  async createCart(list: ShoppingList): Promise<CartResult> {
    return {
      grocer: this.id,
      checkoutUrl: this.searchUrl(list.items[0]?.name ?? ""),
      matched: list.items.map((item) => ({ item, packageCount: 1, confidence: "none", productName: this.searchUrl(item.name) })),
      unmatched: [],
    };
  }
}

const q = encodeURIComponent;
export const walmart = new PartnerGrocerAdapter("walmart", "Walmart", (s) => `https://www.walmart.com/search?q=${q(s)}`, ["cart-link"],
  "Walmart affiliate add-to-cart links today; full cart API via Walmart partner program");
export const amazonFresh = new PartnerGrocerAdapter("amazon-fresh", "Amazon Fresh / Whole Foods", (s) => `https://www.amazon.com/s?k=${q(s)}&i=amazonfresh`, ["cart-link"],
  "Amazon 'add to cart' form links; deeper ordering needs an Amazon partnership");
export const target = new PartnerGrocerAdapter("target", "Target", (s) => `https://www.target.com/s?searchTerm=${q(s)}`, ["cart-link"],
  "Target (Shipt) — partnership required");
