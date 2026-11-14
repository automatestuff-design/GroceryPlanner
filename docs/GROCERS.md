# Grocery integrations

Every grocer implements one interface (`packages/grocers/src/types.ts`):
`info()`, optional OAuth (`authorizeUrl`, `exchangeCode`), optional `searchProducts`, and
`createCart(list) → { checkoutUrl, matched, unmatched }`. The app never places or pays
for an order itself; the user reviews and checks out with the grocer.

| Grocer | Route | Status | What works |
| --- | --- | --- | --- |
| Instacart | Developer Platform API | Live (API key) | Hosted shopping-list page; user picks any Instacart store: Costco, Safeway/Albertsons, Publix, Aldi, Sprouts, Wegmans and many regionals |
| Kroger family | Kroger Public API | Live (OAuth app) | Product search at the user's store, add to their real Kroger cart (Kroger, Ralphs, Fred Meyer, King Soopers, Harris Teeter...) |
| Walmart | Affiliate links, then partner API | Partner | Per-item search links today |
| Amazon Fresh / Whole Foods | Partner program | Partner | Per-item search links today |
| Target | Partnership (Shipt) | Partner | Per-item search links today |

Adding a grocer = one adapter file + one line in `registry.ts`.

## Next steps
1. Apply for Instacart Developer Platform production access and a Kroger production app.
2. Product matching: map ingredients to store products (`toStoreQuantity` handles units today;
   add a synonyms table and remember each household's picks).
3. Done: linked Kroger tokens are stored encrypted in `grocer_accounts`, and the OAuth `state` is signed.
4. Open partner conversations with Walmart, Amazon and Target (Shipt).
