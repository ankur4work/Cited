# Reviews App — Full Build Plan

**Codename:** `Proofstack` (working name)
**Date:** 2026-08-13
**Target:** Shopify App Store, product reviews & UGC category
**Direct competitor:** Judge.me

---

## 0. TL;DR — the strategy in six lines

1. Judge.me cannot be beaten on features. It can be beaten on **what happens after the review is collected.**
2. Reviews collection/display is now a **commodity**. The value in 2026 sits in **AI-answer-engine visibility (AEO), PDP conversion, and merchandising insight** — which today only Yotpo sells, at $79–$500/mo.
3. Our wedge: **enterprise-grade review intelligence at Judge.me prices.**
4. Our technical differentiator: **server-rendered reviews (zero-JS, crawlable)** via Shopify Metaobjects + Theme App Extension Liquid blocks. Every competitor ships a JS widget. Crawlers and AI agents frequently don't see JS-injected review text. We will be the only app whose reviews are in the raw HTML.
5. Our free tier must be **strictly more generous than Judge.me's** — including no branding, which Judge.me charges $15/mo to remove. We monetize the intelligence layer, never the widget.
6. Free GTM gift: Judge.me went **Shopify-only** and finished offboarding WooCommerce/BigCommerce merchants in **January 2026**. There is a stranded, angry, addressable install base. Build Shopify-first but keep the core platform-agnostic.

---

## 1. Competitor teardown

### 1.1 Judge.me — the incumbent

| Attribute | Value |
|---|---|
| Launched | June 2015 |
| App Store rating | 5.0 ★ (98% five-star) |
| Review count | 43,357 |
| Active stores | 200,000+ |
| Status | Built for Shopify · 2025 Build Award winner |
| Integrations | 130+ (Klaviyo, Gorgias, LoyaltyLion, PageFly, AfterShip, Shopify Flow, PushOwl…) |
| Free plan | Unlimited reviews, unlimited requests, widget, carousel, Google rich snippets, importer, trust badge |
| Paid plan | **$15/mo flat** — AI features, 16 widgets, Q&A, coupons/referrals, Google Shopping, Meta & TikTok sync, custom CSS, branding removal |
| Pricing model | **Flat. Does not meter orders.** ← this is their real moat |
| Platform support | Shopify only (as of 2025; non-Shopify offboarding completed Jan 2026) |

**Why they win:** the free tier is genuinely usable, the paid tier is a rounding error at $15, and the flat price means a merchant never gets a surprise bill as they scale. Combined with the highest install base and a perfect rating, they own the default choice for every store under ~$1M GMV.

**Their actual moat, ranked:**
1. **Price architecture** (free → $15 flat) — makes them un-undercuttable on money alone.
2. **App Store ASO** — 43k reviews is a ~10-year compounding asset. We cannot out-review them; we must out-*rank* them on long-tail search terms.
3. **Install base network effects** — review syndication, the judge.me review site, Meta/Google feeds.
4. **Integration surface** — 130+ partners is real switching friction for a mature store.

Note that #1 and #2 are the strong ones. #3 and #4 are catchable in 12–18 months.

### 1.2 The rest of the field

| App | Entry price | Model | Where it wins | Where it's exposed |
|---|---|---|---|---|
| **Loox** | $9.99 → $34.99 @300 orders → $49.99 Convert → caps $999.99 @6k orders | **Order-metered** | Photo/video capture rate, gallery aesthetics | Bill balloons with growth; merchants churn at the $35 and $50 cliffs |
| **Okendo** | $19 Essential → $119 Growth → $499 | **Order-metered** | Klaviyo attribute sync, loyalty stack depth | 6× price jump for 7.5× capacity; AI summaries + Google Shopping gated at $119 |
| **Yotpo** | ~$79+ | Suite/enterprise | AEO ("Discover"), reviews+loyalty+SMS bundle | Priced out of the 95% of stores that are under $1M GMV |
| **Stamped** | ~$199 (reviews+loyalty ~$100–300) | Mid-market | Cheapest reviews+loyalty bundle | Dated UX, no low end |
| **Fera** | $9 / $29 / $99 | **Order-metered** | Cheap entry | Order caps (100/1,000/10,000 reviews per month) |
| **Shopify native** | — | — | — | **Discontinued May 2024.** Shopify now ships only the standardized review *Metaobject definition*, not a product. |

**Read the table again:** Loox, Okendo, and Fera all meter by order volume. Judge.me does not. That is the single clearest reason Judge.me wins the low end. **Any pricing model we ship must be flat.** If we meter orders we are competing with Loox for second place, not with Judge.me for first.

---

## 2. Where Judge.me is actually weak

Sourced from their own 1–3★ App Store reviews and merchant reports — these are evidence, not speculation.

| # | Weakness | Evidence | How exploitable |
|---|---|---|---|
| W1 | **Widget breaks themes** | "Edit widget colour → my buy buttons are gone"; duplicate widgets rendering; JS errors on collection pages | **High** — direct product attack |
| W2 | **Email request editor is clunky** | Called out even in *positive* reviews: "some parts are clunky and hard to optimize (email requests)" | **High** — the most-touched surface in the app |
| W3 | **Import is fragile** | "You need to save after 50 or your work won't import"; SKU mismatch failures; confusing button labels | **Very high** — import is the *first* thing a switcher does. Fail here and you never get the customer. Nail it and you steal theirs. |
| W4 | **Accidental mass sends** | One merchant reported 3,620 review-request emails sent on a default template without approval | **High** — trust/safety differentiator |
| W5 | **GDPR / always-on pixel** | Tracking pixel cannot be disabled without uninstalling; contradictory docs re: Clarity/Hotjar; DPO left technical questions unanswered | **High for EU/UK merchants** — an underserved, high-ARPU segment |
| W6 | **Shop app review sync failures** | Random subsets syncing; support acknowledged the issue with no ETA | Medium |
| W7 | **Support inconsistency at scale** | False "resolved in 2 hours" promises; different answers from different agents | Medium — hard to beat durably, but easy to beat *early* |
| W8 | **Docs are text-only** | "Guides could be clearer, maybe tutorials rather than text" | Low individually, compounds with W1–W3 |
| W9 | **Shopify-only since 2025** | WooCommerce/BigCommerce offboarding completed Jan 2026 | **GTM gift** — a dated, stranded install base |

**Category-level gaps nobody in the $0–$50 tier fills:**
- **G1 — AEO / AI shopping visibility.** Shoppers now ask ChatGPT/Gemini/Perplexity/Claude for product recommendations. Yotpo sells SKU-level AI-surface tracking ("Discover") at enterprise price. Nothing at $15–$30 does this.
- **G2 — Reviews as conversion machinery.** Everyone collects and displays. Almost nobody turns the corpus into objection-handling PDP content, per-persona summaries, or "ask this product a question."
- **G3 — Reviews as merchandising/CX intelligence.** The corpus contains sizing complaints, defect signals, and feature demand. It's sitting unmined.
- **G4 — Crawlability.** JS-injected review text is unreliable for crawlers and AI ingestion. Rich snippets ≠ the review body being in the HTML.

---

## 3. Positioning — the Swiggy play

> Swiggy didn't beat Zomato at listing restaurants. It won on a different primitive — delivery logistics — then converged on listings later.

**Do not launch as "a better Judge.me."** Launch as a different category that happens to include reviews.

**Positioning statement:**
> *Most reviews apps collect social proof and put it on your product page. We do that for free — then we make your review corpus work everywhere else: in Google, in ChatGPT and AI shopping assistants, in your ads, and in your merchandising decisions.*

**Category name we're trying to own:** *Review Intelligence* (not "product reviews app").

**Three-layer product:**

| Layer | Contents | Price | Purpose |
|---|---|---|---|
| **Layer 1 — Collection & Display** | Unlimited reviews, requests, photo/video, widgets, rich snippets, Q&A, imports, **no branding** | **Free forever** | Neutralize Judge.me's free tier. This is a cost of entry, not a product. |
| **Layer 2 — Conversion** | AI review summaries, objection-handling PDP blocks, "Ask this product", UGC→ad creative export, A/B testing on widgets | **$19/mo flat** | The mainstream paid tier |
| **Layer 3 — Intelligence & AEO** | AI-surface visibility tracking, agent-readable feeds, review-mined product/CX insights, competitor benchmarking, attribute analytics | **$49/mo flat** | The wedge. Yotpo capability at 1/4 the price. |

**Non-negotiable pricing rules:**
- Flat pricing at every tier. Never meter orders. Never meter review count. Never meter emails.
- Free tier has **no branding badge**. Judge.me charges $15 to remove theirs — we give it away and take the switchers.
- No feature is silently locked. Every gated feature shows exactly what it does and what it costs *before* setup (fixes W-pricing-opacity).

---

## 4. Product specification

### 4.1 Phase 1 — Parity (must-have to be considered at all)

Checklist derived from Judge.me's feature surface. If any of these is missing, we don't get evaluated.

**Collection**
- [ ] Automated post-fulfillment review request email (delay configurable per product type)
- [ ] Request email scheduling, throttling, and **a hard send-safety gate** (see W4 — no campaign over N recipients sends without explicit confirmation)
- [ ] Multi-product requests in one email
- [ ] Photo + video upload (with client-side compression)
- [ ] Review reminders, one follow-up max by default
- [ ] SMS requests (Phase 1.5)
- [ ] Manual request, CSV upload, unique review links, QR codes
- [ ] Coupon-for-review incentives, with fraud guards
- [ ] Q&A on PDP
- [ ] Web form / standalone review page

**Display**
- [ ] PDP review widget (server-rendered, see §5.2)
- [ ] Star rating badge for PDP + collection cards
- [ ] All-reviews page
- [ ] Carousel / homepage testimonials
- [ ] Media gallery / grid
- [ ] Review filtering + sorting + search
- [ ] Product grouping (share reviews across variants/parent products)
- [ ] Featured / pinned reviews
- [ ] Merchant replies

**Trust & SEO**
- [ ] JSON-LD `Product` + `AggregateRating` + `Review` — validated, never emitting invalid schema
- [ ] Google Shopping / Merchant Center reviews feed
- [ ] Verified-buyer badges (order-matched)
- [ ] Google Customer Reviews integration

**Migration (this is the beachhead — see W3)**
- [ ] One-click import from Judge.me, Loox, Yotpo, Okendo, Stamped, Fera, Amazon, Etsy, AliExpress
- [ ] Import via API where the source offers one; CSV otherwise
- [ ] **Import must preserve: verified status, dates, photos/videos, replies, product mapping**
- [ ] Fuzzy product matching (SKU → handle → title → manual mapping UI) with a preview-before-commit screen
- [ ] Import must be resumable, chunked, and never lose work at 50 rows
- [ ] Post-import diff report: "4,812 imported, 13 unmatched — review here"

**Platform**
- [ ] Theme App Extension app blocks (no ScriptTag, ever)
- [ ] Multi-language (start: EN, ES, FR, DE, IT, PT)
- [ ] Klaviyo, Gorgias, Shopify Flow integrations
- [ ] Shop app review sync (and make it *reliable* — W6)
- [ ] Full GDPR mode: pixel toggleable, DPA published, data map documented (W5)

### 4.2 Phase 2 — Conversion layer (the paid differentiator)

- **AI Review Summaries** — per product, regenerated on new-review thresholds. Not a paragraph blob: *pros/cons, attribute breakdown (fit, quality, shipping), sentiment by theme.*
- **Objection Handler blocks** — mine the corpus for recurring hesitations ("runs small", "shipping slow") and auto-generate a PDP module that addresses each with real quoted reviews. No competitor does this.
- **Ask This Product** — a PDP Q&A box answered from real review text + existing Q&A, with citations to specific reviews. Refuses to answer when the corpus doesn't cover it (no hallucinated claims about a merchant's product — this is a liability boundary and must be enforced hard).
- **Persona-matched reviews** — surface the reviews most relevant to the visitor (matched on variant selected, referral source, or stated attributes) instead of newest-first.
- **UGC → ad creative** — export best-performing photo/video reviews as Meta/TikTok-ready creative with the review text as overlay copy.
- **Widget A/B testing** — layout, position, and default sort tested against add-to-cart rate, with real statistics.

### 4.3 Phase 3 — Intelligence & AEO (the moat)

- **AI Visibility Tracker** — run a scheduled prompt battery ("best {category} for {use case}") against major AI assistants; track whether the merchant's products are mentioned, in what position, with what sentiment, and against which competitors. Report at SKU and category level.
- **Agent-readable review feed** — a stable, documented, machine-consumable endpoint per store (structured review data + aggregate attributes), plus `llms.txt`-style discovery, plus impeccable JSON-LD. Bet: agentic shopping needs machine-readable trust signals, and being early to a clean format matters.
- **Review mining → merchandising insights** — defect clustering ("17 reviews mention zipper failure on SKU-882 since March"), sizing signals, feature demand, and churn-risk detection. Push to Slack/email as weekly digests.
- **Competitive review benchmarking** — public review corpus analysis for a merchant's named competitors: what customers praise/criticize about them, where the merchant wins.
- **Attribute analytics** — structured reviewer attributes (fit, skin type, use case) with cohort analysis, and push to Klaviyo profile properties (this is Okendo's $119 feature).

### 4.4 Explicitly out of scope for v1
Loyalty programs, SMS marketing suite, referrals-as-a-product, subscriptions, NPS surveys. All of these are how Yotpo/Stamped got bloated. Ship reviews intelligence, stay sharp.

---

## 5. Tech stack & architecture

### 5.1 Stack — reuse what already works in `searchgap`

You already run a production Shopify stack. Reuse it; don't relearn a framework for a harder product.

| Layer | Choice | Why |
|---|---|---|
| App framework | **Next.js 14 App Router + TypeScript** | Already proven in `searchgap`. (Shopify's official template is now React Router 7 — worth knowing, not worth switching for. Your OAuth/session/webhook plumbing is already written.) |
| Admin UI | **Polaris + App Bridge React v4** | Required for Built for Shopify |
| API layer | **tRPC v11** for admin; **REST/edge handlers** for webhooks + public widget API | Same as searchgap |
| DB | **Postgres 16** + Prisma | Add **pgvector** for semantic review search/clustering (you already have the pattern) |
| Cache/queue | **Redis + BullMQ** | Email scheduling, imports, syndication, AI jobs |
| Search | Postgres FTS + pgvector; Meilisearch only if FTS stalls | Avoid a 4th datastore early |
| Object storage | **Cloudflare R2** | **Zero egress fees.** Review photos/video served millions of times — S3 egress would be the single largest cost line. This is the most important infra decision in the doc. |
| Media pipeline | Sharp (images) + Cloudflare Stream *or* ffmpeg workers (video) | Transcode to WebP/AVIF + HLS; never serve originals |
| CDN / widget edge | **Cloudflare Workers + KV** | Widget JSON served from edge KV, <50ms globally, origin untouched |
| Email | **AWS SES** (~$0.10/1,000) with a Postmark fallback for transactional | Resend/Postmark do not survive review-request volume economically. Dedicated IPs + per-store subdomain auth. |
| AI | Claude (Anthropic API) — Haiku for high-volume classification/summarization, Opus/Sonnet for insight generation | Cost-tier by job; cache aggressively; batch |
| Observability | Sentry + Prometheus + pino | Same as searchgap |
| Hosting | App on Fly.io/Railway (multi-region); Postgres on Neon/RDS; workers separate | Widget traffic must never share a process with admin |

### 5.2 The core technical bet: server-rendered reviews

**Every competitor ships a JavaScript widget.** That means: layout shift, a render-blocking or late-loading request, Core Web Vitals damage, and — critically — **review text that crawlers and AI ingestion pipelines may never see.**

**Our approach — hybrid, SSR-first:**

```
Review created  →  our Postgres (source of truth)
                →  write/sync top-N reviews per product into the shop's
                   Shopify Metaobjects (standard review definition)
                →  Theme App Extension app block (Liquid) renders those
                   reviews server-side, inside Shopify's own HTML response
                →  zero JS, zero CLS, zero external request, fully crawlable
                →  progressive enhancement: JS lazy-loads pagination,
                   filtering, sorting, and media from our edge KV
```

Payoff: fastest widget in the category, best Core Web Vitals, review *body text* in the raw HTML for Google and AI crawlers, and it degrades gracefully with JS off. This directly powers the AEO wedge — it isn't a separate feature, it's the same architecture.

### 5.2.1 SPIKE RESULT — resolved 2026-08-13 ✅ viable, but gated

Verified against Shopify's `standard-review-metaobject` docs. **The architecture works. There is a gate.**

**Green lights:**
- Type handle: **`product_review`**, 19 fields.
- **1,000,000 entries per definition**, and **standard metaobject entries do not count against the shop's quota.** No scaling ceiling — the original concern is dead.
- Shopify **requires** approved review apps to syndicate *all* valid reviews to `product_review` metaobjects, plus `reviews.rating` and `reviews.rating_count` metafields on Product. **Our differentiator is literally the thing Shopify mandates.** It's also what powers Shop-app review surfacing — i.e. Judge.me's W6 failure mode.

**🔴 The gate — `product_review` is a RESTRICTED definition, available only to Shopify-approved product review apps.**

Approval path (has multi-week lead time):
1. Request test access: Partner Dashboard → Partners Internal → API Access
2. Implement + test syndication in a dev store
3. Submit app for review (optionally with production app ID)
4. Sign updated agreement
5. Dev app promoted to live / production app is granted scopes

**Consequence for the roadmap: file the API access request in Week 1, before feature code.** It is the longest-lead-time item in the entire project and it gates the core architecture, Shop-app sync, and the AEO wedge. Everything else can be parallelized around it.

**Required scopes:** `write_product_reviews`, `read_metaobjects`, `read_customers`, `read_orders`, `read_products`

**Required schema (fields we must populate):**
- Required: `rating` (JSON `{scale_min, scale_max, value}`), `submitted_at`, `source`, `product` (reference), `app_verification_status` (`verified_buyer` | `verified_reviewer` | `unverified`)
- Optional: `title`, `body`, `author`, `order`, `product_variant`, `merchant_reply`, `language` (ISO 639-1), `media_urls`, publication timestamps

**Operational limits — these directly constrain the importer design (§5.4.4):**
- Bulk JSONL: **20MB max**, batch at **10,000 reviews**
- Bulk delete: **250 review IDs per request**
- Reference fields must point to existing store resources → product matching must resolve *before* write
- We may not modify or recreate the "Verified by Shop" badge

**Still open (verify in dev store, Week 2):** exact Liquid read path on the storefront. Community sources indicate `product.metafields.reviews.product_reviews`, but this must be confirmed against a real theme, along with render performance at 10k+ reviews on one product. Fallback if it degrades: SSR the top 10–20 reviews + aggregate (which is all that matters for SEO/AEO anyway) and lazy-load the remainder from edge KV.

**Architectural fallback if approval is refused:** we render from our own metafields + edge-cached JSON instead of the standard metaobject. We keep SSR and crawlability; we lose Shop-app sync and native interop. Degraded, not fatal — but plan for approval.

### 5.3 Data model (initial sketch)

```
Store            id, shop_domain, access_token(AES-256-GCM), plan, settings, locale, gdpr_mode
Product          id, store_id, shopify_gid, handle, title, group_id
ReviewGroup      id, store_id, name                       -- share reviews across products
Review           id, store_id, product_id, order_id, rating, title, body,
                 author_name, author_email(hashed+encrypted), verified,
                 status(pending|published|hidden|spam), source(native|import|syndicated),
                 locale, created_at, published_at, ip_hash, fraud_score
ReviewMedia      id, review_id, type(image|video), r2_key, width, height,
                 poster_key, duration, moderation_status
ReviewReply      id, review_id, body, author, created_at
ReviewVote       id, review_id, voter_hash, helpful(bool)
ReviewAttribute  id, review_id, key, value                -- fit=true_to_size, skin=dry
Question         id, product_id, body, status, asker
Answer           id, question_id, body, source(merchant|ai|review), citations[]
RequestCampaign  id, store_id, trigger, delay_hours, template_id, throttle, status
RequestSend      id, campaign_id, order_id, email_hash, sent_at, opened, clicked, converted
ImportJob        id, store_id, source, status, total, processed, failed,
                 mapping_json, report_json, resumable_cursor
Summary          id, product_id, model, content_json, generated_at, review_count_at_gen
Embedding        review_id, vector(pgvector)              -- clustering, semantic search, insights
AeoProbe         id, store_id, prompt, engine, ran_at, mentioned, position, sentiment, competitors[]
Insight          id, store_id, type(defect|sizing|demand|praise), cluster_json,
                 severity, review_ids[], detected_at
WebhookEvent     id, store_id, topic, shopify_id, processed_at   -- idempotency
```

### 5.4 The hard engineering problems (what actually kills reviews apps)

Ranked by how likely each is to sink the project:

1. **Email deliverability at scale.** Review requests are bulk email from thousands of unrelated senders. One bad merchant poisons a shared IP. → Per-store reputation scoring, dedicated IP pools segmented by reputation, per-store SPF/DKIM subdomain auth, automatic throttling on bounce/complaint spikes, hard suppression lists, and a **send-safety gate** (any campaign over N recipients requires explicit confirmation — this is W4 turned into a feature).
2. **Media storage + bandwidth cost.** Video reviews at scale are the #1 cost line. → R2 (zero egress), aggressive transcoding, thumbnail-first loading, lifecycle policies on originals.
3. **Widget performance & theme compatibility.** Theme conflicts are Judge.me's most visible complaint (W1). → SSR-first architecture (§5.2), CSS custom properties with strict scoping and no global selectors, shadow DOM for JS-enhanced parts, and an automated compatibility test matrix across the top 20 Shopify themes on every release.
4. **Import fidelity.** The switcher's first experience (W3). → Chunked, resumable, idempotent jobs; preview-before-commit; fuzzy product matching with manual override UI; a diff report at the end. Budget real engineering time here — this is the beachhead, not a chore.
5. **Rich snippet validity.** Invalid schema = Google penalty = merchant churn + a 1★ review. → Schema validated on generation, never emit `AggregateRating` with zero reviews, automated Rich Results testing in CI.
6. **Review spam & fraud.** Incentivized reviews attract abuse. → IP/device fingerprint, velocity limits, order matching for verified status, AI content classification, disposable-email detection, manual moderation queue.
7. **Webhook reliability & idempotency.** Shopify redelivers. → `WebhookEvent` dedup table, queue-backed processing, dead-letter queue.
8. **Multi-tenant data isolation.** Every query scoped by `store_id`, enforced at the Prisma middleware layer, not by developer discipline.
9. **GDPR/CCPA.** Mandatory webhooks, documented data map, right-to-erasure that actually purges R2 objects, and a **fully disableable analytics pixel** (W5 — this is a marketing asset for EU merchants, not just compliance).

---

## 6. Go-to-market

**Cold reality:** you cannot out-review 43,357 reviews. The App Store's top slot is not winnable in year one. Win channels Judge.me isn't defending.

### 6.1 Channel priority

| Priority | Channel | Play |
|---|---|---|
| 1 | **The stranded non-Shopify merchants** | Judge.me offboarded WooCommerce/BigCommerce merchants in Jan 2026. Build a platform-agnostic core + JS widget from day one, and run direct outreach + content to that cohort. They have no incumbent. |
| 2 | **Migration campaign** | "Switch in 10 minutes, keep your verified badges." Free white-glove migration for any store over 500 reviews — you personally run the first 50. Every migration is a case study and a review. |
| 3 | **ASO long-tail** | Don't fight "product reviews". Own "AI shopping visibility", "review SEO", "ChatGPT product reviews", "review analytics", "photo reviews for [niche]". Build the listing around Layer 3 language. |
| 4 | **Agency/partner channel** | Shopify agencies install apps across dozens of clients. Offer a partner dashboard, revenue share, and free dev-store usage. One agency = 20–50 installs. |
| 5 | **Content/AEO flywheel** | You're selling AEO — so rank in AI answers yourself. Publish the definitive data-backed content on reviews-and-AI-shopping. Practice the product on the product. |
| 6 | **Judge.me complaint mining** | Monitor their 1–3★ reviews and r/shopify. Every complaint is a named, qualified lead with a stated pain. |

### 6.2 App Store listing strategy
- Lead with the wedge, not parity. Hero: *"Your reviews, working in Google and AI shopping — not just on your product page."*
- Screenshots must show Layer 3 (AI visibility dashboard, insights) — that's what makes someone install a 30-review app over a 43,000-review one.
- Free plan visible and genuinely generous, **branding-free**, stated explicitly on the listing (direct contrast with Judge.me's $15 branding removal).
- Pursue **Built for Shopify** status from day one — it's a ranking multiplier. Requirements: performance budget, App Bridge, Polaris, no ScriptTags, embedded, fast install. Design to it, don't retrofit.

### 6.3 Review velocity flywheel
Target 100 App Store reviews in the first 6 months. In-app prompt after a merchant's first *value moment* (first 10 reviews collected, or first AI-visibility report), never on install.

---

## 7. Roadmap

Assumes 1–2 engineers. Adjust proportionally.

### Phase 0 — Validation (Week 1–2)
- [x] ~~Metaobject SSR spike~~ — **DONE, see §5.2.1. Viable, but gated on Shopify approval.**
- [ ] 🔴 **FILE THE `product_review` API ACCESS REQUEST — DAY 1.** Longest lead time in the project; gates the core architecture. Partner Dashboard → Partners Internal → API Access.
- [ ] Confirm the storefront Liquid read path + render perf in a dev store (§5.2.1 open item)
- [ ] Interview 15 merchants: 5 on Judge.me, 5 on Loox/Okendo, 5 stranded WooCommerce refugees
- [ ] Validate the AEO wedge: will a $500k GMV merchant pay $49/mo for AI-visibility tracking? If no, Layer 3 becomes Layer 2 features and the pricing collapses to $19.
- [ ] Scaffold app, OAuth, webhooks, Prisma schema, CI (mostly a port from `searchgap`)

### Phase 1 — Core reviews MVP (Week 3–8)
- Week 3–4: review CRUD + moderation + verified-buyer order matching + media upload to R2
- Week 5: SSR widget via theme app extension + JS progressive enhancement + JSON-LD
- Week 6: request email engine (SES, templates, scheduling, throttle, send-safety gate)
- Week 7: **importers** — Judge.me + Loox + CSV, with product matching UI and diff report
- Week 8: onboarding flow, settings, plan/billing (Shopify Billing API), theme compatibility matrix

### Phase 2 — Launch-ready (Week 9–12)
- Q&A, carousel/gallery/all-reviews blocks, filtering, product grouping
- Google Shopping feed, Shop app sync, Klaviyo + Flow integrations
- Multi-language, GDPR mode, DPA + data map published
- Built for Shopify checklist pass, performance budget verified
- **Submit to App Store ~Week 12**

### Phase 3 — Conversion layer (Month 4–5)
AI summaries, objection-handler blocks, Ask This Product, UGC→ad export, widget A/B testing. Introduce the $19 tier.

### Phase 4 — Intelligence & AEO (Month 6–8)
AI visibility tracker, agent-readable feed, review mining/insight digests, competitive benchmarking, attribute analytics + Klaviyo push. Introduce the $49 tier. **This is where the company either differentiates or becomes app #47.**

### Phase 5 — Platform expansion (Month 9–12)
Standalone JS widget + public API → WooCommerce, BigCommerce, custom/headless. Capture the merchants Judge.me abandoned.

---

## 8. Metrics & unit economics

**North star:** *reviews collected per store per month* (proves the collection engine works, and it's the input to every downstream feature).

| Metric | 6-month target | 12-month target |
|---|---|---|
| Installs | 500 | 5,000 |
| Install → activated (first review displayed) | 40% | 55% |
| Free → paid conversion | 5% | 8% |
| App Store reviews | 100 | 400 |
| MRR | $1.5k | $20k |
| Monthly churn | <6% | <4% |

**Cost per store per month (rough, at 1,000 orders/mo store):**
- Email: ~1,000 requests + 400 reminders @ SES ≈ **$0.15**
- Storage/bandwidth: ~200 photos + 20 videos on R2 ≈ **$0.30**
- AI: summaries + classification, Haiku-tier, cached ≈ **$0.40**
- Compute/DB amortized ≈ **$0.50**
- **Total ≈ $1.35/store/mo** → healthy at $19, very healthy at $49, survivable at $0 provided free-tier AI is capped.

**Free-tier cost control is a launch requirement, not a later optimization:** no AI features on free, media quota with a soft cap, email throttling. A viral free tier with uncapped AI is how this dies.

---

## 9. Risks & kill criteria

| Risk | Severity | Mitigation |
|---|---|---|
| Judge.me ships AEO at $15 | **High** | They're a mature, feature-complete incumbent — slow to reposition. Our edge is speed and being AEO-native in architecture, not AEO-as-a-tab. Also: they must protect $15 flat; deep AI features carry real marginal cost, which is precisely what flat pricing punishes. |
| AEO turns out to be a fad | **High** | Layer 2 (conversion) must stand on its own commercially. Validate in Phase 0. Don't bet the company on Layer 3 before a paying customer confirms it. |
| Shopify ships native reviews again | Medium | They killed it in 2024 and now ship only the metaobject *definition* — a signal they want apps to own this. Low probability, but building on their standard metaobject means we'd interoperate rather than be replaced. |
| Can't get App Store distribution | **High** | Assume organic ASO fails in year one. Agencies + migration + off-Shopify are the plan, not the backup. |
| Email deliverability failure | High | Phase 0 infra decision, dedicated IP pools, reputation scoring. Do not launch email on a shared pool. |
| Solo-founder scope creep | High | The out-of-scope list in §4.4 is binding. |

**Kill criteria — be honest about these up front:**
- Phase 0 interviews find zero willingness to pay for AEO **and** zero pain with existing apps → the wedge is imaginary; stop or re-pick.
- 6 months post-launch with <200 installs and <2% paid conversion → distribution is unsolvable at this price point; pivot to off-Shopify or agency-white-label.

---

## 10. What to do this week

1. **Run the Metaobject SSR spike.** Everything architectural depends on the answer. (2 days)
2. **Book 15 merchant interviews.** Post in r/shopify, Shopify Community, and 3 agency Slacks. (parallel, ongoing)
3. **Scaffold the app** by porting `searchgap`'s OAuth, session, webhook, encryption, and CI layers. Do not rebuild them. (2 days)
4. **Write the Prisma schema** from §5.3 and get migrations running. (1 day)
5. **Decide the name and grab the domain** — the name should signal intelligence/visibility, not "reviews."

Answer these two before writing feature code:
- Does the SSR-via-metaobjects approach hold at scale?
- Will a real merchant pay $49/mo for AI-shopping visibility?

If both are yes, the plan is sound and the sequencing above is correct. If the second is no, keep everything in Phases 0–3 and drop the price ladder to Free/$19.
