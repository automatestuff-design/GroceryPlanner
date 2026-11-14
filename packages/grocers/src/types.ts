import type { GrocerId, ShoppingItem, ShoppingList } from "@mealplan/core";

/**
 * How far a grocer integration can go:
 * - "cart-link":   we build a hosted cart/shopping-list page; the user checks out on the grocer's site/app.
 * - "cart-api":    we add items to the user's real cart via OAuth; they confirm checkout.
 * - "order-api":   we can place the order and pick a delivery slot (partner agreement required).
 */
export type GrocerCapability = "cart-link" | "cart-api" | "order-api" | "product-search" | "store-locator";

/** "live": public API we can use today. "partner": needs a business agreement before it can be switched on. */
export type IntegrationStatus = "live" | "partner";

export interface GrocerInfo {
  id: GrocerId;
  name: string;
  capabilities: GrocerCapability[];
  status: IntegrationStatus;
  /** Banners reached through this integration (e.g. Instacart → Costco, Safeway, Publix...). */
  banners?: string[];
  configured: boolean;
}

export interface ProductMatch {
  item: ShoppingItem;
  productId?: string;
  productName?: string;
  /** Packages to buy, e.g. 2 × 400 g cans. */
  packageCount: number;
  priceCents?: number;
  confidence: "exact" | "likely" | "none";
}

export interface CartResult {
  grocer: GrocerId;
  /** Where to send the user to review and check out. */
  checkoutUrl?: string;
  matched: ProductMatch[];
  unmatched: ShoppingItem[];
  estimatedTotalCents?: number;
}

export interface GrocerContext {
  postalCode?: string;
  storeId?: string;
  /** OAuth access token for the user's grocer account, when the grocer needs one. */
  userAccessToken?: string;
  title?: string;
}

export interface GrocerAdapter {
  info(): GrocerInfo;
  /** OAuth URL to link the user's account (cart-api grocers only). */
  authorizeUrl?(state: string): string;
  exchangeCode?(code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }>;
  searchProducts?(query: string, ctx: GrocerContext): Promise<{ id: string; name: string; priceCents?: number; size?: string }[]>;
  /** Turn a shopping list into a cart or a cart link. */
  createCart(list: ShoppingList, ctx: GrocerContext): Promise<CartResult>;
}

export class GrocerNotConfiguredError extends Error {
  constructor(id: GrocerId) {
    super(`Grocer "${id}" is not configured. Set its keys in .env (see .env.example).`);
  }
}
