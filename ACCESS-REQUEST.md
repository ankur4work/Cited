# `product_review` API Access Request — submission guide

**Status:** **test access GRANTED 2026-08-14** — dev store only. This is step 2 of 4; final approval still requires submitting the working implementation for review (§1).
**Owner:** Ankur
**Why it matters:** this is the longest-lead-time item in the project and it gates the core architecture, Shop-app review surfacing, and the AEO wedge. See `PLAN.md` §5.2.1.

---

## 0. What you are asking for

Access to the **standard `product_review` metaobject definition**, a *restricted* definition Shopify grants only to approved product review apps, plus the `write_product_reviews` scope.

Without it, Cited can still collect and display reviews from its own database — but it cannot write to the standard metaobject, cannot populate the `reviews.rating` / `reviews.rating_count` product metafields, and therefore cannot surface reviews in the Shop app or be read by Shopify-native surfaces. The server-rendered theme block has nothing to render from.

---

## 1. The process (from Shopify's docs, verbatim where quoted)

| # | Step | Detail |
|---|------|--------|
| 1 | **Request the scope** | From your **development app**, go to **Partners Internal** → **API Access**. "Click on the card to request access to the scope for standard product reviews." |
| 2 | **Test access is granted** | "This will enable the scopes on your dev test store only." The **Shop app channel is enabled on your dev shop** so Shop-app behaviour can be tested. |
| 3 | **Build and test** | Implement syndication with the dev app and test thoroughly in the dev store, including Shop app functionality. |
| 4 | **Submit for review** | Submit the implementation. Optionally include the **production app ID** if you want an existing app opted in rather than promoting the dev app. |
| 5 | **Sign + receive scopes** | On approval you "sign an updated agreement." Then the dev app is promoted to live with the scopes, **or** the named production app receives them. |

**No timeline is stated in the documentation.** Treat it as unknown and file early — that is the entire reason this is the critical path.

> Note the ordering trap: step 3 requires a *working, tested* implementation before step 4. This is not a paperwork request you file and forget. Filing step 1 early is free and unblocks the dev-store testing you cannot otherwise do.

---

## 2. Mandatory requirements for approved apps — and where Cited stands

Shopify lists these as **must** requirements. This is what the reviewer is checking.

| # | Requirement | Status | Where |
|---|---|---|---|
| R1 | Syndicate **all valid reviews** to metaobject entries, with proper validation | ✅ Built | `jobs/processors/syndicate-review.ts`, `lib/shopify/metaobjects.ts` |
| R2 | Maintain aggregates — update `reviews.rating` and `reviews.rating_count` on each product | ✅ Built | `jobs/processors/syndicate-aggregate.ts`, `setProductRatingMetafields()` |
| R3 | Subscribe to **all metaobject webhooks** (CREATE, UPDATE, DELETE), scoped to the review type | ✅ Built | `shopify.app.toml` subscription, `app/api/webhooks/metaobjects/route.ts`, `jobs/processors/reconcile-metaobject.ts` |
| R4 | Display the **"Verified by Shop" badge** using **only official Shopify assets** on syndicated reviews | ✅ Resolved | `extensions/reviews-widget/blocks/reviews.liquid` — we display no Shop badge at all; ours is now unmistakably distinct, see §3 |
| R5 | Handle webhooks **asynchronously** to avoid API throttling | ✅ Built | webhooks enqueue to BullMQ; nothing processes inline |
| R6 | Implement **retry / backoff** for failed operations | ✅ Built | `syndicationQueue` — 6 attempts, exponential backoff; terminal errors short-circuit instead of burning retries |

**All 6 are done in code.** What remains before step 4 is verification against a real dev store, not construction — see §4.

---

## 3. The remaining gap, and one unconfirmed detail

### R3 — Metaobject webhooks — BUILT, one detail unconfirmed

Shopify requires subscriptions to metaobject **CREATE, UPDATE and DELETE**, scoped with the `subTopic` field (the metaobject type, i.e. `product_review`).

Why it's required, and why it genuinely matters: reviews can be modified **outside our app** — by the merchant in the Shopify admin, by another approved review app, or by Shopify itself. Without these webhooks our database silently drifts out of sync with what shoppers actually see, and we'd be serving stale review data while believing we're authoritative.

Built as of 2026-08-14:

- **Subscription** in `shopify.app.toml` for all three topics.
- **`app/api/webhooks/metaobjects/route.ts`** — HMAC verification, replay rejection via the `WebhookEvent` unique index, then enqueue and return. No Shopify or database work happens inline, so the 5s webhook timeout is never at risk.
- **`jobs/processors/reconcile-metaobject.ts`** — compares Shopify's stored metaobject against the exact field set we would write and re-syndicates from Postgres on any difference. Handles the entry we did not create by ignoring it: a foreign metaobject is left alone rather than imported, because our aggregates are computed from our own reviews and pushed to the shop-wide rating metafields, so ingesting one would double-count it.

**Resolved — it is `filter`, not `sub_topic`.** Sub-topics were **deprecated in Admin API 2024-07**, and the `metaobjects/*` topics now *require* a filter. We are on `2025-07`, so `sub_topic` would have been rejected. The config now reads:

```toml
filter = "type:product_review"
```

`product_review` is a Shopify **standard** definition, so the plain type is correct; an app-owned definition would need the full `app--{id}--{namespace}` form. The route does not depend on this anyway — it re-checks the metaobject type itself and ignores anything that isn't `product_review`, so a dropped filter degrades to wasted work rather than wrong behaviour.

### R4 — Our verified badge vs the "Verified by Shop" rule — RESOLVED

Shopify's rules confirmed: apps must "use only the official badge assets provided by Shopify" and "do not modify, recreate, or alter the badge in any way." Three official variants exist (purple, black, grey), and the badge may only be shown "for reviews that are successfully syndicated to or from the standard product review metaobject."

The block previously rendered a **custom SVG checkmark labelled "Verified buyer"** — a hand-drawn check next to the word "Verified" is exactly what a reviewer flags.

**Taken: option 2.** The deciding point is that the two badges do not mean the same thing. "Verified by Shop" is *Shopify* attesting through the Shop app. Ours attests only that Cited matched the reviewer's email to a real order for that product on that store. Showing a Shop-like mark for our own claim would misrepresent both. So we display **no Shop badge at all**, and ours is now distinct on every axis a reviewer checks:

| | Before | Now |
|---|---|---|
| Mark | checkmark | bag outline — a check-in-circle is the shape read as Shopify's |
| Wording | "Verified buyer" | "Verified purchase", with a title naming Cited as the verifier |
| Colour | green `#0a7c42` | unchanged, but now **hard-coded** — every other colour in the block is merchant-configurable, so a merchant could otherwise recolour it to Shop purple `#5A31F4` |

If we later display the real badge it will be an **additional** element using Shopify's own asset, never this one restyled.

---

## 4. Pre-submission checklist

Everything below the line is now verification against a real dev store, not construction.

- [x] **Step 1 filed** — Partners Internal → API Access → request standard product reviews scope
- [x] **Step 2 granted** — test access on the dev store, 2026-08-14
- [x] R3: metaobject CREATE/UPDATE/DELETE webhooks subscribed with `filter`, handler reconciles inbound changes
- [x] R4: verified badge resolved against the official-asset rule
- [x] `SHOPIFY_SCOPES` set in the Coolify environment, including `write_product_reviews` (§6.3)
- [x] Deployed — `cited-web` and `cited-worker` live at `https://cited.solnix.store`, migrations applied, worker consuming
- [ ] Dev store created, `dev_store_url` set in `shopify.app.toml`, app installed on it
- [ ] `shopify app deploy` run once — confirms the `filter` key and registers the subscriptions
- [ ] App URL + redirect URLs in the Partner Dashboard pointed at `https://cited.solnix.store` (`shopify.app.toml` still says `localhost:3000`)
- [ ] Reviews demonstrably syndicating: create a review → metaobject appears in the dev store
- [ ] `reviews.rating` and `reviews.rating_count` populated and correct on the product (API-only — not visible in admin, verify via GraphQL)
- [ ] Ratings visibly rendering **in the Shop app** on the dev shop
- [ ] Deletion path verified: deleting a review removes its metaobject
- [ ] Moderation path verified: unpublishing flips the metaobject to DRAFT, not delete
- [ ] Aggregates correct after edit/delete, not just on create
- [ ] Retry/backoff demonstrable (kill the API mid-sync, confirm recovery)
- [ ] Bulk limits respected: 20MB JSONL, batch 10,000 reviews, 250 IDs per bulk delete

---

## 5. Draft submission text

Adapt; keep it factual. Reviewers are checking implementation, not marketing.

> **App:** Cited — Product Reviews & AI Visibility
> **Production app ID:** `d7e7cc14dd8022014fdaff06422f2542`
> **Requested:** standard `product_review` metaobject definition + `write_product_reviews`
>
> **What the app does**
> Cited collects product reviews (post-fulfilment email requests, storefront forms, imports from other review apps) and renders them on the storefront through a theme app extension. Reviews are rendered server-side in Liquid from the standard metaobject rather than injected by JavaScript, so review content is present in the initial HTML response for crawlers and assistive technology, with no layout shift.
>
> **How syndication is implemented**
> Postgres is the source of truth; the Shopify metaobject is an eventually-consistent projection maintained by a dedicated queue. Every valid review is projected to a `product_review` metaobject, and `reviews.rating` / `reviews.rating_count` are maintained on every product.
>
> - The metaobject handle is derived from our internal review ID, making upserts idempotent — a retry after a timeout updates the existing entry rather than creating a duplicate review on the merchant's storefront.
> - Published reviews are set `ACTIVE` via the publishable capability; pending and merchant-hidden reviews are retained as `DRAFT` so moderation toggles visibility without a create/delete cycle. Deleted and spam-flagged reviews have their metaobject removed.
> - Aggregates are recomputed from published reviews only, and pool correctly across products that share a review group.
> - All webhook handling is asynchronous via a job queue; nothing is processed inline in the webhook response.
> - Syndication jobs retry with exponential backoff. Errors that cannot succeed on retry (permission, validation, dangling reference) are recorded as failed and surfaced to the merchant rather than consuming the retry budget.
> - Metaobject CREATE/UPDATE/DELETE webhooks are subscribed with `subTopic: product_review` and reconcile external changes back into our records.
>
> **Verification**
> Reviews are marked `verified_buyer` only when an order for that specific product by that specific customer email exists. A known customer without a matching purchase is recorded as `verified_reviewer`. Everything else is `unverified`.
>
> **Testing**
> Implemented and tested on dev store `<dev-store>.myshopify.com`, including Shop app rendering.

---

## 6. Code changes required **after** approval

Approval changes the granted scope set, and three places encode it. All three must change together or the app breaks.

1. ✅ **`shopify.app.toml`** — append `write_product_reviews` to `access_scopes.scopes`. *(done 2026-08-14)*
2. ✅ **`lib/shopify/app-identity.ts`** — append it to `APP_SCOPES`. This constant is compared against the live env in the health check, so a mismatch **fails every production health check** and rolls back the deploy in Coolify. *(done 2026-08-14)*
3. ✅ **`.env` / Coolify env** — `SHOPIFY_SCOPES` set on both `cited-web` and `cited-worker` including `write_product_reviews`, so all three sources agree and the health check passes. *(done 2026-08-14)*

Then, per store:

4. ✅ **`Store.reviewScopeGranted`** — no longer a manual step. `lib/shopify/store.ts` derives it from the scope string the token exchange actually returns, on install and on every app open, so a shop starts syndicating the moment Shopify grants the scope to it and stops if it is ever revoked. Until it is true, `syndicate-review` deliberately marks every review `SKIPPED` and returns without calling Shopify. *(done 2026-08-14)*
5. **Existing merchants must re-authorise** — a scope change requires re-granting. Plan the prompt.
6. ✅ **Store-wide backfill** — implemented in `jobs/processors/syndicate-backfill.ts`: 50 reviews per chunk, each chunk re-enqueuing the next with a cursor, so a crash or deploy costs one chunk rather than the store. It is **triggered automatically** by the same scope-flip in step 4, so no manual run is needed. *(done 2026-08-14)*

---

## 7. If access is refused

Documented fallback (`PLAN.md` §5.2.1): render from our own metafields and edge-cached JSON. We keep server-side rendering and crawlability — the SEO and AEO argument survives. We lose Shop-app review surfacing and native interoperability.

Degraded, not fatal. But plan for approval: the Shop app surface is a real distribution channel, and "reviews visible in the Shop app" is a line on the App Store listing that competitors have and we would not.
