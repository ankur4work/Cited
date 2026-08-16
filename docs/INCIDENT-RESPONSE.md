# Security Incident Response Policy — Cited

**Owner:** {{INCIDENT_OWNER}} · **Last reviewed:** {{DATE}} · **Review
cadence:** every 6 months

This is an operational runbook, not a statement of intent. It is written for a
very small team, because that is what Cited is — every step below is one
person can actually perform at 3am. Do not adopt a process here you would not
follow.

---

## 1. What counts as an incident

| Severity | Definition | Examples | Response starts |
|---|---|---|---|
| **SEV1** | Personal data confirmed or likely exposed to an unauthorised party | Database reachable without credentials; access token leaked; data sent to the wrong merchant | Immediately, drop everything |
| **SEV2** | A control protecting personal data has failed, no exposure confirmed | TLS disabled on a datastore; audit logging silently broken; webhook HMAC check bypassed | Within 4 hours |
| **SEV3** | Security-relevant defect with no personal data at risk | Dependency CVE with no reachable path; rate limiter misconfigured | Next working day |
| **SEV4** | Hardening opportunity | Missing header; overly broad permission | Backlog |

If you cannot decide between two severities, take the higher one. Downgrading
later is cheap; discovering you under-called a SEV1 is not.

## 2. Roles

At current size one person holds all of these. Write down who, per incident,
even if the answer is the same name three times.

- **Incident lead** — decides severity, owns the timeline, makes the call on
  notification. The only role that cannot be skipped.
- **Communications** — merchant and Shopify contact.
- **Scribe** — keeps the timeline. In practice: a running note with timestamps.

## 3. Response

### 3.1 Detect and declare

Triggers: an alert (`dlq=true`, `auditWriteFailed=true`, `alert=true` in
structured logs), a merchant report, a Shopify notice, or your own discovery.

Declare by starting a timeline document. Record wall-clock time in UTC for
everything from here on. The timeline is what you will need for the 72-hour
notification and it cannot be reconstructed afterwards.

### 3.2 Contain

Priority is stopping ongoing exposure, **not** diagnosing the cause.

- Credentials leaked → rotate `SESSION_SECRET`, `SHOPIFY_API_SECRET`, database
  and Redis credentials. Note that rotating `SESSION_SECRET` invalidates every
  stored access token; merchants will re-authorise. Take that cost.
- Datastore exposed → close it at the network before anything else.
- Bad deploy → roll back first, investigate the rollback later.
- Runaway job leaking data → pause the queue, do not delete jobs; they are
  evidence.

### 3.3 Assess

Answer four questions, in writing:

1. **What data?** Which fields, which tables, encrypted or not.
2. **Whose?** How many data subjects, how many merchants, which regions.
3. **How long?** First exposure to containment.
4. **Accessed?** Query the audit log and access logs. "We have no evidence of
   access" and "we cannot tell" are different findings — say which one is true.

### 3.4 Notify

**Shopify:** any incident involving protected customer data, promptly. Cited
holds a restricted scope; late disclosure risks it.

**Merchants (controllers):** within **72 hours** of becoming aware, per the
DPA. Include the nature of the breach, categories and approximate number of
data subjects, likely consequences, and measures taken. Send this even when
the assessment is incomplete — say what you know, say what you do not, and
commit to a follow-up.

**Regulators / data subjects:** the merchant is the controller and makes that
call. Give them what they need to make it, quickly.

Never delay notification to finish the fix. They are independent tracks.

### 3.5 Recover

Restore service, verify the control that failed is now working, and confirm no
secondary exposure was introduced by the fix.

### 3.6 Review

Within **5 working days**, blameless, written:

- Timeline, detection method, time to detect and contain
- Root cause — the control that was missing, not the person who missed it
- What made it worse, and what made it better
- Concrete actions, each with an owner and a date

Actions with no owner are not actions. If a review produces none, it was not a
real review.

## 4. Contacts

| Role | Contact |
|---|---|
| Incident lead | {{NAME_AND_PHONE}} |
| Hosting provider support | {{PROVIDER_SUPPORT}} |
| Shopify Partner support | {{SHOPIFY_CONTACT}} |
| Legal adviser | {{LEGAL_CONTACT}} |
| Cyber insurer | {{INSURER_AND_POLICY}} |

## 5. Preparation

Verify quarterly — an untested control is an assumption:

- [ ] Restore a backup into a scratch environment and confirm it opens
- [ ] Confirm alert log lines still reach a human
- [ ] Rotate one credential end to end
- [ ] Re-read this document and correct whatever has drifted
