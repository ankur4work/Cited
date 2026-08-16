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
- [ ] 🔴 **Protected customer data access approved** — blocks `shopify app deploy`, see §4.1 (answers drafted in §4.2)
- [x] **Five missing webhook route handlers built** — including all three mandatory compliance topics, see §4.3
- [x] Transit encryption enforced in code — production boot fails without TLS on both datastores (§4.4)
- [x] Retention periods and audit logging implemented (§4.4)
- [ ] Operator actions: repoint dev `.env`, add TLS to the production connection strings, enable encrypted backups, publish the policy and DPA (§4.5)
- [ ] `shopify app deploy` run once — confirms the `filter` key and registers the subscriptions
- [x] App URL + redirect URLs set to `https://cited.solnix.store` in `shopify.app.toml` — reaches the Partner Dashboard on the next `shopify app deploy`
- [ ] Reviews demonstrably syndicating: create a review → metaobject appears in the dev store
- [ ] `reviews.rating` and `reviews.rating_count` populated and correct on the product (API-only — not visible in admin, verify via GraphQL)
- [ ] Ratings visibly rendering **in the Shop app** on the dev shop
- [ ] Deletion path verified: deleting a review removes its metaobject
- [ ] Moderation path verified: unpublishing flips the metaobject to DRAFT, not delete
- [ ] Aggregates correct after edit/delete, not just on create
- [ ] Retry/backoff demonstrable (kill the API mid-sync, confirm recovery)
- [ ] Bulk limits respected: 20MB JSONL, batch 10,000 reviews, 250 IDs per bulk delete

### 4.1 Blocker — protected customer data access (found 2026-08-14)

`shopify app deploy` reached the Partner Dashboard, built the extension and
then **refused to create the app version**:

> This app is not approved to subscribe to webhook topics containing protected
> customer data.

The error is raised **twice — once per offending topic**. The offenders are
`orders/fulfilled` and `orders/paid`; every other subscribed topic is either
app lifecycle (`app/uninstalled`, `app_subscriptions/update`), catalogue
(`products/*`), our own metaobjects, or a mandatory compliance topic, none of
which carry customer data.

This is a **second, separate approval from the `product_review` scope** and it
is not a CLI operation — it is a form at **Partner Dashboard → the Cited app →
API access → Protected customer data access**, where you declare which data
you use and why, plus the Level 2 fields (name, email, phone, address) the
review-request engine reads off an order.

Nothing else can proceed until it clears, because the version is rejected
whole: the metaobject subscriptions and the `https://cited.solnix.store` URLs
in this file do **not** reach the dashboard on a failed deploy.

The tempting shortcut — dropping the two `orders/*` topics to force the deploy
through — is wrong. They are the trigger for post-fulfilment review requests,
so a deploy without them is a released version whose collection engine is
silently dead. Request the access instead.

### 4.2 Protected customer data — declared answers (drafted 2026-08-16)

**Step 1 — data use.** Reason: **App functionality** only. The app cannot
function without matching an order to a reviewer. Not customer service, store
management, personalization or analytics — none describe what we do. Not
marketing: a review request solicits feedback rather than promoting a product,
and the UGC→ad-creative feature exports review *media*, not customer data.

**Step 1 — fields: Name and Email. Nothing else.** This is not a judgment
call; it is exactly what `jobs/processors/ingest-orders.ts:73` asks Shopify
for (`customer { email firstName lastName }`). Phone and Address are read
nowhere — the only `countryCode` in the schema is on `Store`, i.e. the
merchant's shop. Note `customerName` is currently written but never read; it
is ingested for the review-request greeting that has not shipped yet.

**Step 2 — data protection details.** Answers below are what is *true today*,
not what we intend. Shopify does not require all-Yes; this is a risk
assessment. A false attestation on a scope Shopify states may be audited at
any time is a far worse position than a truthful mixed answer.

The first assessment of these answers found **nine** Nos. The compliance build
(§4.4) closed most of them. Current state:

| Question | Answer | Basis |
|---|---|---|
| Minimum personal data | Yes | Email + name only, per the query above |
| Disclose what we process, and why | Yes¹ | `docs/PRIVACY.md` — states the fields, purposes, retention and erasure behaviour |
| Limit use to that purpose | Yes | Email → order matching + send; name → greeting; nothing else reads either |
| DPA with merchants | Yes¹ | `docs/DPA.md` |
| Respect consent decisions | N/A *today* | No pixel and no email engine are implemented, so nothing is consent-gated yet. `ANALYTICS_PIXEL_DEFAULT_ENABLED` defaults **true**, so this flips the moment either ships |
| Opt-out of data being sold | N/A | We neither sell nor share personal data |
| Automated decision-making opt-out | N/A | AI classifies review spam; declining to publish a review is not a legal or similarly significant effect |
| Retention periods | Yes | `lib/compliance/retention.ts` + a daily sweep registered by the worker itself, so it cannot be switched off by forgetting to configure a cron |
| Encrypt at rest and in transit | Yes² | AES-256-GCM at rest, unchanged. In transit is now **enforced**: production boot fails unless Postgres sets `sslmode` and Redis uses `rediss://` or is loopback-local |
| Encrypt backups | **No** | Server configuration, outside the repo — see §4.5 |
| Separate test and production data | Yes² | `.env.example` points at the local docker stack and says why; the live `.env` still needs repointing — see §4.5 |
| Data loss prevention | Yes¹ | Backups, tested restore and access control, documented in `docs/INCIDENT-RESPONSE.md` §5 — conditional on §4.5 |
| Limit staff access | Yes | Solo operator |
| Strong staff passwords | Yes, conditional | Nothing in the app governs this; true only if Partners/GitHub/server all have strong unique credentials and 2FA |
| Log access to personal data | Yes | `audit_logs` + `lib/audit.ts` — decryption, bulk export, erasure and retention sweeps |
| Security incident response policy | Yes¹ | `docs/INCIDENT-RESPONSE.md` |
| Audits / certifications | *leave blank* | We have none |

¹ Drafted and committed, but each carries `{{PLACEHOLDER}}` fields only you can
fill (legal entity, address, sub-processor regions, transfer mechanism). The
privacy policy and DPA must also be **published at a URL** and wired to
`DPA_URL` / `PRIVACY_CONTACT_EMAIL` before the answer is honestly Yes.

² True once the operator actions in §4.5 are done. The code now refuses to run
otherwise, which is the point — this can no longer regress silently.

### 4.5 Operator actions still outstanding

None of these are code, and none can be done from the repository:

1. **Repoint the live `.env`** at the local docker stack for development
   (`localhost:5433` / `localhost:6380`). Today it is `NODE_ENV=development`
   pointed at the production datastores, so dev runs read and write real
   customer data.
2. **Add TLS to the production connection strings** — `?sslmode=require` on
   Postgres, `rediss://` on Redis. The app will now refuse to boot without
   them, so this must happen before the next production deploy.
3. **Enable encrypted backups** on the database host, and run one restore into
   a scratch environment to confirm it works. This is the only remaining
   **No**.
4. **Fill the `{{PLACEHOLDER}}` fields** in the three documents, have them
   reviewed, publish the privacy policy and DPA, and point `DPA_URL` and
   `PRIVACY_CONTACT_EMAIL` at them.

### 4.3 Webhook route gap — RESOLVED 2026-08-16

`shopify.app.toml` subscribed to six endpoints while the app implemented three
route handlers in total (`api/auth`, `api/auth/callback`,
`api/webhooks/metaobjects`). Five of six were 404s, including all three
mandatory compliance topics and the `orders/*` topics §4.1 requests access
for. All five are now built:

| Route | Topics | Behaviour |
|---|---|---|
| `/api/webhooks/privacy` | `customers/data_request`, `customers/redact`, `shop/redact` | Records a ledger row, enqueues the purge |
| `/api/webhooks/orders` | `orders/paid`, `orders/fulfilled` | Debounced incremental order pull |
| `/api/webhooks/products` | `products/create\|update\|delete` | Debounced incremental catalog pull |
| `/api/webhooks/app-uninstalled` | `app/uninstalled` | Clears the token, starts the 48h redact clock |
| `/api/webhooks/app-subscriptions-update` | `app_subscriptions/update` | Re-reads the subscription, writes a BillingEvent |

The contradiction is resolved too: `lib/shopify/client.ts` declared the
compliance topics as three separate paths that matched neither the toml nor
reality. It now names the single `/api/webhooks/privacy` route, and the
constant is documented as an assertion target rather than a registration
mechanism — subscriptions come from the toml.

One design note on the order and product routes. The ingestion processors run
Shopify **bulk** operations and a shop may only have one in flight at a time,
so a job per webhook would produce contention rather than throughput — a flash
sale would be hundreds of jobs competing for one slot. Instead a burst
collapses into a single delayed pull per store, with the delay acting as the
debounce window.

### 4.4 What the compliance build added (2026-08-16)

| Concern | Implementation |
|---|---|
| Erasure | `lib/compliance/redact.ts` — customer and shop redaction |
| Payload parsing | `lib/compliance/payload.ts` (+ 13 tests) — numeric order IDs → GIDs, large-ID safety, case normalisation |
| Request ledger | `ComplianceRequest` — every request recorded with what was erased and when; survives the store deletion it describes |
| Execution | `jobs/processors/compliance-purge.ts` on the maintenance queue, 6 attempts with backoff |
| Retention | `lib/compliance/retention.ts` + `jobs/processors/retention-sweep.ts`, scheduled daily by the worker |
| Audit trail | `AuditLog` + `lib/audit.ts` |
| Transit encryption | `lib/env.ts` refuses to boot in production without TLS on both datastores |
| Documents | `docs/PRIVACY.md`, `docs/DPA.md`, `docs/INCIDENT-RESPONSE.md` |

Three decisions in there are judgement calls a reviewer may ask about, so they
are argued in the code rather than left implicit:

- **Reviews are anonymised, not deleted.** Identifiers go; the rating and body
  stay. Deleting them would silently move a merchant's public star rating.
  Once the link to a person is severed the remaining row is not personal data.
- **Suppression entries survive erasure.** They hold a keyed hash and "do not
  email this person". Deleting one would mean honouring the erasure by
  breaking the opt-out.
- **Redacted reviews are re-syndicated.** The author name is a field on the
  Shopify metaobject too, so stripping it in Postgres alone would leave the
  erased name rendering on the storefront.

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
