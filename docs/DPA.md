# Data Processing Agreement — Cited

**Status: DRAFT — needs review by a qualified adviser before you offer it to
merchants.** A DPA is a contract. The clauses below are drafted to match what
the app actually does, which is the part an engineer can get right; whether
they are enforceable in your jurisdiction is not.

Between **{{LEGAL_ENTITY_NAME}}** ("Processor") and the merchant who installs
Cited ("Controller"). Accepted by the Controller on installation.

---

## 1. Subject matter

The Processor provides product review collection, display and analysis to the
Controller's Shopify store. In doing so it processes personal data relating to
the Controller's customers.

## 2. Roles

The Controller determines the purposes and means of processing customer
personal data. The Processor acts **only on the Controller's documented
instructions**, which comprise this agreement, the app's configuration as set
by the Controller, and the Shopify App Store terms.

## 3. Categories of data subject

Customers and prospective customers of the Controller's store who place an
order or submit a review, question or vote.

## 4. Categories of personal data

- Email address (order and review author)
- First and last name
- Review content voluntarily submitted, including any media
- Keyed hashes of IP address and user agent, for abuse prevention

The Processor does **not** process phone numbers or postal addresses.

## 5. Duration

For the term of the Controller's installation, plus the retention periods in
§9, plus 48 hours after uninstall to allow reinstatement.

## 6. Processor obligations

The Processor shall:

1. Process personal data only on documented instructions, including for
   transfers, unless required otherwise by law — in which case it will inform
   the Controller first unless the law forbids it.
2. Ensure persons authorised to process personal data are bound by
   confidentiality.
3. Implement the technical and organisational measures in §7.
4. Not engage a sub-processor without prior notice and the opportunity to
   object (§10).
5. Assist the Controller in responding to data subject requests, by the
   mechanisms in §8.
6. Assist the Controller with security, breach notification and impact
   assessments, taking into account the nature of processing.
7. Delete or return personal data at the end of the service, per §9.
8. Make available the information needed to demonstrate compliance and allow
   for audits (§11).

## 7. Technical and organisational measures

| Measure | Implementation |
|---|---|
| Encryption at rest | AES-256-GCM for access tokens and customer email addresses |
| Pseudonymisation | Keyed HMAC for email lookup, IP and user agent — matching never requires decryption |
| Encryption in transit | TLS required for all datastore connections; the application refuses to start in production without it |
| Access logging | Append-only audit log of decryption, bulk export, erasure and retention sweeps |
| Access control | Least privilege; individual named accounts with multi-factor authentication |
| Tenant isolation | Every tenant-owned record is scoped by store and indexed on it |
| Log hygiene | Personal data is never written to application logs |
| Resilience | {{BACKUP_SCHEDULE_AND_ENCRYPTION}}; restore procedure tested {{FREQUENCY}} |

## 8. Data subject requests

The Processor supports the Controller through Shopify's mandatory compliance
webhooks:

| Request | Topic | Processor action | Deadline |
|---|---|---|---|
| Access | `customers/data_request` | Compile all data held on that customer and provide it to the Controller | 30 days |
| Erasure | `customers/redact` | Erase that customer's personal data | 30 days |
| Store closure | `shop/redact` | Erase the entire store's data | On receipt |

Every request is recorded in a ledger with what was erased and when. See the
privacy policy for what erasure retains and why.

## 9. Retention and deletion

Retention periods are enforced by a scheduled sweep, not by policy alone. The
schedule is published in the privacy policy and defined in
`lib/compliance/retention.ts`.

On uninstall, data is retained for 48 hours to permit reinstatement, then
erased when Shopify sends `shop/redact`.

## 10. Sub-processors

The Controller gives general authorisation for the sub-processors listed in
the privacy policy. The Processor will give **{{NOTICE_PERIOD}} days'** notice
before adding or replacing one, during which the Controller may object; if the
objection cannot be resolved, the Controller may terminate.

## 11. Audit

The Processor will respond to reasonable written information requests within
{{RESPONSE_DAYS}} days. On-site audits require reasonable notice, occur no more
than once a year absent a breach, and are at the Controller's cost.

## 12. Breach notification

The Processor will notify the Controller **without undue delay and within 72
hours** of becoming aware of a personal data breach, with the nature of the
breach, categories and approximate numbers affected, likely consequences, and
measures taken. See `docs/INCIDENT-RESPONSE.md`.

## 13. International transfers

{{TRANSFER_MECHANISM}}

## 14. Liability

{{LIABILITY_CLAUSE — align with your main terms of service.}}

---

**Signature:** accepted electronically by the Controller on installation.
Record of acceptance: {{WHERE_ACCEPTANCE_IS_RECORDED}}.
