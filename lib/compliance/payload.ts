/**
 * Parsers for Shopify's three mandatory compliance webhook bodies.
 *
 * Separated from the route so the shapes can be tested without standing up a
 * request, and because these bodies are the one place where getting a field
 * wrong means quietly failing to erase someone's data.
 *
 * Shopify sends order references as **numeric IDs**, not GIDs:
 *
 *   { "shop_id": 954889,
 *     "shop_domain": "example.myshopify.com",
 *     "customer": { "id": 191167, "email": "j@example.com", "phone": "..." },
 *     "orders_to_redact": [299938, 280263] }
 *
 * Everything we store is keyed by GID, so the conversion happens here, once.
 */

export const COMPLIANCE_TOPICS = {
  DATA_REQUEST: 'customers/data_request',
  CUSTOMER_REDACT: 'customers/redact',
  SHOP_REDACT: 'shop/redact',
} as const;

export type ComplianceTopic = (typeof COMPLIANCE_TOPICS)[keyof typeof COMPLIANCE_TOPICS];

export function isComplianceTopic(topic: string): topic is ComplianceTopic {
  return (Object.values(COMPLIANCE_TOPICS) as string[]).includes(topic);
}

export interface CompliancePayload {
  shopDomain: string | null;
  customerShopifyId: string | null;
  customerEmail: string | null;
  /** Always `gid://shopify/Order/<id>`, converted from the numeric form. */
  orderGids: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Coerce Shopify's numeric-or-string IDs to a string.
 *
 * IDs arrive as JSON numbers and can exceed 2^53 — reading one into a JS
 * number and formatting it back is lossy at the top of the range, so anything
 * already a string is left exactly as it is.
 */
function idToString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function toOrderGid(value: unknown): string | null {
  const id = idToString(value);
  if (!id) return null;
  // Tolerate a GID if Shopify ever sends one — idempotent either way.
  return id.startsWith('gid://') ? id : `gid://shopify/Order/${id}`;
}

export function parseCompliancePayload(payload: Record<string, unknown>): CompliancePayload {
  const customer = asRecord(payload.customer);

  const rawOrders =
    (Array.isArray(payload.orders_to_redact) && payload.orders_to_redact) ||
    (Array.isArray(payload.orders_requested) && payload.orders_requested) ||
    [];

  const email = customer ? idToString(customer.email) : null;

  return {
    shopDomain:
      typeof payload.shop_domain === 'string' ? payload.shop_domain.trim().toLowerCase() : null,
    customerShopifyId: customer ? idToString(customer.id) : null,
    customerEmail: email ? email.trim().toLowerCase() : null,
    orderGids: rawOrders.map(toOrderGid).filter((gid): gid is string => gid !== null),
  };
}
