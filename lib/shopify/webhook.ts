import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { verifyWebhookHmac } from './hmac';
import { isValidShopDomain } from './validators';

/**
 * Shared entry path for every Shopify webhook route.
 *
 * Exists so HMAC verification and replay handling are written once. A webhook
 * endpoint that skips either is an unauthenticated, unbounded write path into
 * a merchant's data, and "the next route copies the last one" is exactly how
 * one ends up skipping it.
 */

export interface VerifiedWebhook {
  topic: string;
  shopDomain: string;
  /** `X-Shopify-Webhook-Id` — stable across Shopify's redeliveries. */
  webhookId: string;
  subTopic: string | null;
  apiVersion: string | null;
  payload: Record<string, unknown>;
}

export type WebhookVerification =
  | { ok: true; webhook: VerifiedWebhook }
  | { ok: false; status: 400 | 401; reason: string };

/**
 * Verify a webhook request and parse its body.
 *
 * The HMAC is computed over the RAW body bytes, so the body is read exactly
 * once as text and parsed afterwards. Reading it as JSON first and
 * re-serialising would change whitespace and key order and fail every check.
 */
export async function verifyWebhookRequest(req: NextRequest): Promise<WebhookVerification> {
  const rawBody = await req.text();

  if (!verifyWebhookHmac(rawBody, req.headers.get('x-shopify-hmac-sha256'))) {
    return { ok: false, status: 401, reason: 'hmac_mismatch' };
  }

  // Everything below this line is authenticated. Header validation still
  // happens — a valid signature proves the request came from Shopify, not
  // that the headers are shaped the way we expect.
  const topic = req.headers.get('x-shopify-topic');
  const shopDomain = req.headers.get('x-shopify-shop-domain');
  const webhookId = req.headers.get('x-shopify-webhook-id');

  if (!topic || !webhookId) {
    return { ok: false, status: 400, reason: 'missing_headers' };
  }
  if (!isValidShopDomain(shopDomain)) {
    return { ok: false, status: 400, reason: 'invalid_shop_domain' };
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, status: 400, reason: 'payload_not_an_object' };
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, reason: 'invalid_json' };
  }

  return {
    ok: true,
    webhook: {
      topic,
      shopDomain: shopDomain.trim().toLowerCase(),
      webhookId,
      subTopic: req.headers.get('x-shopify-sub-topic'),
      apiVersion: req.headers.get('x-shopify-api-version'),
      payload,
    },
  };
}

export interface WebhookClaim {
  /** True when this delivery was already recorded — a Shopify redelivery. */
  duplicate: boolean;
  /** WebhookEvent row id. Null only when duplicate. */
  eventId: string | null;
}

/**
 * Record a delivery, or report it as a replay.
 *
 * Relies on the `@@unique([topic, shopifyId])` constraint rather than a
 * read-then-write, because Shopify retries aggressively and two deliveries of
 * the same webhook can land concurrently on two instances. A findFirst guard
 * would let both through; the unique index cannot.
 *
 * `payload` is stored as a trimmed envelope by callers, not the full body:
 * review metaobjects carry customer-authored text and author names, and this
 * table has no reason to become a second copy of it.
 */
export async function claimWebhookEvent(input: {
  topic: string;
  webhookId: string;
  storeId: string | null;
  payload?: Prisma.InputJsonValue;
}): Promise<WebhookClaim> {
  try {
    const event = await prisma.webhookEvent.create({
      data: {
        topic: input.topic,
        shopifyId: input.webhookId,
        storeId: input.storeId,
        payload: input.payload,
      },
      select: { id: true },
    });
    return { duplicate: false, eventId: event.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { duplicate: true, eventId: null };
    }
    throw err;
  }
}

/**
 * Undo a claim when the work could not be queued.
 *
 * Without this, a failed enqueue would leave the dedupe row behind and every
 * Shopify retry of that delivery would be discarded as a duplicate — the
 * webhook would be lost permanently, which for the metaobject feed means
 * silently serving stale reviews.
 */
export async function releaseWebhookEvent(eventId: string): Promise<void> {
  await prisma.webhookEvent
    .delete({ where: { id: eventId } })
    .catch((err: unknown) =>
      logger.error(
        { eventId, err: (err as Error).message },
        'Failed to release webhook event — Shopify retries of this delivery will be dropped',
      ),
    );
}
