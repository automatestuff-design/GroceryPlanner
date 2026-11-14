import type { ShoppingList } from "@mealplan/core";
import { GrocerNotConfiguredError, type CartResult, type GrocerAdapter, type GrocerContext, type ProductMatch } from "../types";
import { toStoreQuantity } from "../units";

/**
 * Kroger Public API — Kroger family banners (Kroger, Ralphs, Fred Meyer, King Soopers,
 * Harris Teeter, Smith's, Fry's, QFC...). Users link their Kroger account (OAuth),
 * we search products at their store and add them to their real cart.
 * Docs: https://developer.kroger.com/
 */
export class KrogerAdapter implements GrocerAdapter {
  private base = "https://api.kroger.com/v1";
  constructor(
    private clientId = process.env.KROGER_CLIENT_ID,
    private clientSecret = process.env.KROGER_CLIENT_SECRET,
    private redirectUri = process.env.KROGER_REDIRECT_URI,
  ) {}

  info() {
    return {
      id: "kroger" as const, name: "Kroger", status: "live" as const, configured: !!(this.clientId && this.clientSecret),
      capabilities: ["cart-api" as const, "product-search" as const, "store-locator" as const],
      banners: ["Kroger", "Ralphs", "Fred Meyer", "King Soopers", "Harris Teeter", "Smith's", "Fry's", "QFC"],
    };
  }

  authorizeUrl(state: string): string {
    if (!this.clientId || !this.redirectUri) throw new GrocerNotConfiguredError("kroger");
    const p = new URLSearchParams({ scope: "cart.basic:write product.compact", response_type: "code", client_id: this.clientId, redirect_uri: this.redirectUri, state });
    return `${this.base}/connect/oauth2/authorize?${p}`;
  }

  async exchangeCode(code: string) {
    const json = await this.token(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.redirectUri ?? "" }));
    return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: json.expires_in };
  }

  async searchProducts(query: string, ctx: GrocerContext) {
    const { access_token } = await this.token(new URLSearchParams({ grant_type: "client_credentials", scope: "product.compact" }));
    const p = new URLSearchParams({ "filter.term": query, "filter.limit": "5", ...(ctx.storeId ? { "filter.locationId": ctx.storeId } : {}) });
    const res = await fetch(`${this.base}/products?${p}`, { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Kroger products ${res.status}`);
    const { data } = (await res.json()) as { data: { upc: string; description: string; items?: { price?: { regular?: number }; size?: string }[] }[] };
    return data.map((d) => ({
      id: d.upc, name: d.description, size: d.items?.[0]?.size,
      priceCents: d.items?.[0]?.price?.regular ? Math.round(d.items[0].price.regular * 100) : undefined,
    }));
  }

  async createCart(list: ShoppingList, ctx: GrocerContext): Promise<CartResult> {
    if (!ctx.userAccessToken) throw new Error("Link your Kroger account first.");
    const matched: ProductMatch[] = [];
    const unmatched = [];
    for (const item of list.items) {
      const [hit] = await this.searchProducts(item.name, ctx);
      if (!hit) { unmatched.push(item); continue; }
      matched.push({ item, productId: hit.id, productName: hit.name, priceCents: hit.priceCents, packageCount: Math.max(1, Math.ceil(toStoreQuantity(item).quantity)), confidence: "likely" });
    }
    const res = await fetch(`${this.base}/cart/add`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${ctx.userAccessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items: matched.map((m) => ({ upc: m.productId, quantity: m.packageCount, modality: "DELIVERY" })) }),
    });
    if (!res.ok) throw new Error(`Kroger cart ${res.status}`);
    return {
      grocer: "kroger", checkoutUrl: "https://www.kroger.com/cart", matched, unmatched,
      estimatedTotalCents: matched.reduce((s, m) => s + (m.priceCents ?? 0) * m.packageCount, 0),
    };
  }

  private async token(body: URLSearchParams) {
    if (!this.clientId || !this.clientSecret) throw new GrocerNotConfiguredError("kroger");
    const res = await fetch(`${this.base}/connect/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Kroger token ${res.status}`);
    return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  }
}
