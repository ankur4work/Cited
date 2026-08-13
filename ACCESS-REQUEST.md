# `product_review` API Access Request — submission guide

**Status:** not yet filed
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
| R3 | Subscribe to **all metaobject webhooks** (CREATE, UPDATE, DELETE) using the `subTopic` field | ❌ **MISSING** | see §3 |
| R4 | Display the **"Verified by Shop" badge** using **only official Shopify assets** on syndicated reviews | ❌ **CONFLICT** | see §3 |
| R5 | Handle webhooks **asynchronously** to avoid API throttling | ✅ Built | webhooks enqueue to BullMQ; nothing processes inline |
| R6 | Implement **retry / backoff** for failed operations | ✅ Built | `syndicationQueue` — 6 attempts, exponential backoff; terminal errors short-circuit instead of burning retries |

**4 of 6 are done. Two must be fixed before step 4.**

---

## 3. The two gaps that would fail review

### R3 — Metaobject webhooks are not subscribed

Shopify requires subscriptions to metaobject **CREATE, UPDATE and DELETE**, scoped with the `subTopic` field (the metaobject type, i.e. `product_review`).

Why it's required, and why it genuinely matters: reviews can be modified **outside our app** — by the merchant in the Shopify admin, by another approved review app, or by Shopify itself. Without these webhooks our database silently drifts out of sync with what shoppers actually see, and we'd be serving stale review data while believing we're authoritative.

**Not yet in `shopify.app.toml`.** Needs a subscription block plus a handler that reconciles inbound metaobject changes against our `Review` rows — including the awkward case of an entry we did not create.

### R4 — Our verified badge conflicts with the "Verified by Shop" rule

`extensions/reviews-widget/blocks/reviews.liquid` currently renders a **custom SVG checkmark with the label "Verified buyer"**. Shopify's rules say the "Verified by Shop" badge must use **only official Shopify assets**, and separately that apps "cannot modify or recreate the official Verified by Shop badge."

A hand-drawn checkmark next to the word "Verified" on a syndicated review is exactly the kind of thing a reviewer flags. Resolution options, in order of preference:

1. Use the official Shopify-provided badge asset on syndicated reviews (correct, needs the asset — likely supplied with test access at step 2).
2. Keep our own badge but make it visually and textually distinct from Shopify's — different wording and mark, so it clearly denotes *our* order-matched verification, not Shop's.
3. Drop the badge from syndicated reviews entirely.

**Recommendation: decide this at step 3, once test access reveals what the official asset actually is.** Do not guess now and rebuild later.

---

## 4. Pre-submission checklist

File step 1 immediately. Complete these before step 4.

- [ ] **Step 1 filed** — Partners Internal → API Access → request standard product reviews scope
- [ ] Dev store created and app installed on it
- [ ] R3: metaobject CREATE/UPDATE/DELETE webhooks subscribed with `subTopic`, handler reconciles inbound changes
- [ ] R4: verified badge resolved against the official-asset rule
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

1. **`shopify.app.toml`** — append `write_product_reviews` to `access_scopes.scopes`.
2. **`lib/shopify/app-identity.ts`** — append it to `APP_SCOPES`. This constant is compared against the live env in the health check, so a mismatch **fails every production health check** and rolls back the deploy in Coolify.
3. **`.env` / Coolify env** — append it to `SHOPIFY_SCOPES` (it currently sits separately in `SHOPIFY_SCOPES_RESTRICTED`).

Then, per store:

4. **Flip `Store.reviewScopeGranted` to `true`.** Until this is set, `syndicate-review` deliberately marks every review `SKIPPED` and returns without calling Shopify. Nothing syndicates until it flips.
5. **Existing merchants must re-authorise** — a scope change requires re-granting. Plan the prompt.
6. **Run a store-wide backfill** to project reviews accumulated while access was pending. `syndicate:backfill` is currently a logged no-op; it needs the resumable, rate-limited implementation before it is run against a large catalog.

---

## 7. If access is refused

Documented fallback (`PLAN.md` §5.2.1): render from our own metafields and edge-cached JSON. We keep server-side rendering and crawlability — the SEO and AEO argument survives. We lose Shop-app review surfacing and native interoperability.

Degraded, not fatal. But plan for approval: the Shop app surface is a real distribution channel, and "reviews visible in the Shop app" is a line on the App Store listing that competitors have and we would not.
