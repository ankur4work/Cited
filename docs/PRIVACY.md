# Cited — Privacy Policy

**Status: DRAFT — needs review by a qualified adviser before publication.**
Every `{{PLACEHOLDER}}` below is a fact only you can supply. Publishing this
with placeholders intact would be worse than publishing nothing.

- **Last updated:** {{DATE}}
- **Controller / processor:** {{LEGAL_ENTITY_NAME}}, {{REGISTERED_ADDRESS}}
- **Contact:** {{PRIVACY_CONTACT_EMAIL}}

---

## 1. Who this covers

Cited is a Shopify app installed by a **merchant** onto their store. Two
different relationships follow from that, and they carry different duties:

| Relationship | Who | Our role |
|---|---|---|
| Merchant data | The store owner and their staff | **Controller** — we decide what to collect to run the service |
| Shopper data | Customers of the merchant's store | **Processor** — we act on the merchant's instructions |

For shopper data the merchant is the controller. We do not decide what to do
with it beyond what the app requires, and we do not use it for our own
purposes.

## 2. What we process, and why

### From the merchant

Shop domain, shop name, contact email, country, currency, timezone, locale,
plan, and the encrypted Shopify access token. Used to operate the app,
authenticate to Shopify, and bill correctly.

### From the merchant's customers

We request exactly three protected fields from Shopify, and only these:

| Field | Source | Why we need it |
|---|---|---|
| Email address | Order | Match a reviewer to a real purchase (verified-buyer status), and send the review request the merchant configured |
| First name, last name | Order | Address the review-request email, and attribute a review the reviewer chose to sign |

We **do not** request phone numbers or postal addresses, and the app does not
read them.

We also store what a reviewer voluntarily submits: rating, title, body,
optional media, and any display name they enter. Anti-abuse keeps a keyed hash
of the submitting IP and user agent — never the values themselves.

### What we never do

- Sell or share personal data.
- Use shopper personal data to train AI models.
- Use shopper data for our own marketing.
- Contact a merchant's customers for any purpose the merchant has not
  configured.

## 3. AI processing

Review **content** is processed by AI models to produce summaries, cluster
themes, and classify spam. That content is the review text, not the reviewer's
identity — names and addresses are not sent to a model. Output is stored as
structured data attached to the product, never to a person.

## 4. Security

- Access tokens and customer email addresses are encrypted at rest with
  **AES-256-GCM**.
- Email addresses used for lookup are stored as a **keyed HMAC**, so an order
  can be matched to a reviewer without decrypting anything, and suppression
  works without holding the address in the clear.
- Connections to our datastores require TLS in production; the application
  refuses to start otherwise.
- Personal data is never written to application logs.
- Access to personal data is recorded in an append-only audit log
  (`audit_logs`) covering decryption, bulk export, erasure and retention
  sweeps.

## 5. Retention

Enforced in code by a daily sweep, not by policy alone
(`lib/compliance/retention.ts`):

| Data | Retained |
|---|---|
| Order email, name, locale | 24 months from order, then cleared |
| Review-request send records (address) | 12 months, then cleared |
| Webhook delivery log | 90 days |
| AI probe raw responses | 90 days |
| Audit log | 24 months |
| Reviews (rating, title, body) | Until the merchant deletes them or uninstalls |
| Compliance request ledger | Retained as the record of an erasure |

On uninstall we keep the shop's data for **48 hours** so a merchant who
reinstalls does not lose their reviews, then delete it when Shopify sends
`shop/redact`.

## 6. Your rights

Shoppers should contact the **merchant** whose store they bought from — they
are the controller, and Shopify routes those requests to us on their behalf.
We answer requests through Shopify's mandatory channels:

- `customers/data_request` — we compile everything we hold about that customer
  and provide it to the merchant, within 30 days.
- `customers/redact` — we erase that customer's personal data.
- `shop/redact` — we erase the entire shop's data.

### What erasure actually does

Removed: the order mirror's email, name and locale; the review author's name,
email and anti-abuse hashes; question asker details; send records; review
media.

**Retained, and why:**

- **The review's rating and text.** Once the author identifiers are stripped,
  the review is no longer linked to a person. We keep it because it is the
  merchant's product feedback and every public star rating is computed from
  it — deleting it would silently move a rating shoppers can see.
- **A suppression entry** (a keyed hash plus "do not email"). Deleting this
  would mean the next campaign emails someone who asked us to stop.

## 7. Sub-processors

| Sub-processor | Purpose | Location |
|---|---|---|
| {{HOSTING_PROVIDER}} | Application and database hosting | {{REGION}} |
| Anthropic | AI review summarisation and classification (content only) | {{REGION}} |
| {{EMAIL_PROVIDER}} | Review-request email delivery | {{REGION}} |
| Cloudflare R2 | Review media storage | {{REGION}} |

We will give notice before adding a sub-processor that processes personal
data.

## 8. International transfers

{{TRANSFER_MECHANISM — e.g. Standard Contractual Clauses. State the actual
mechanism; do not leave this generic.}}

## 9. Changes

Material changes will be notified to merchants in-app before taking effect.

## 10. Contact

{{PRIVACY_CONTACT_EMAIL}} — {{LEGAL_ENTITY_NAME}}, {{REGISTERED_ADDRESS}}
