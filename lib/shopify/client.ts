import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LogSeverity } from '@shopify/shopify-api';
import { randomUUID } from 'node:crypto';
import type { Store } from '@prisma/client';
import { env } from '../env';
import { logger } from '../logger';
import { decrypt } from '../crypto';

export const ADMIN_API_VERSION = '2025-07';

const scopes = env.SHOPIFY_SCOPES.split(',').map((s) => s.trim()).filter(Boolean);
const appUrl = new URL(env.SHOPIFY_APP_URL);

export const shopify = shopifyApi({
  apiKey: env.SHOPIFY_API_KEY,
  apiSecretKey: env.SHOPIFY_API_SECRET,
  apiVersion: ADMIN_API_VERSION as never,
  scopes,
  hostName: appUrl.host,
  hostScheme: appUrl.protocol.replace(':', '') as 'http' | 'https',
  isEmbeddedApp: true,
  future: {
    lineItemBilling: true,
    customerAddressDefaultFix: true,
    unstable_managedPricingSupport: true,
  } as never,
  logger: {
    log: async (severity, message) => {
      const map: Record<LogSeverity, 'error' | 'warn' | 'info' | 'debug'> = {
        [LogSeverity.Error]: 'error',
        [LogSeverity.Warning]: 'warn',
        [LogSeverity.Info]: 'info',
        [LogSeverity.Debug]: 'debug',
      };
      logger[map[severity]]({ shopify: true }, message);
    },
  },
});

export const MANDATORY_WEBHOOKS = [
  { topic: 'app/uninstalled', path: '/api/webhooks/app-uninstalled' },
  { topic: 'customers/data_request', path: '/api/webhooks/customers-data-request' },
  { topic: 'customers/redact', path: '/api/webhooks/customers-redact' },
  { topic: 'shop/redact', path: '/api/webhooks/shop-redact' },
] as const;

export interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export interface GraphQLCost {
  requestedQueryCost: number;
  actualQueryCost: number | null;
  throttleStatus: ThrottleStatus;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: { cost?: GraphQLCost };
}

export class ShopifyAPIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly shop: string,
    public readonly requestId: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ShopifyAPIError';
  }
}

/**
 * Thrown when Shopify returns 401 or 403 — almost always means the stored
 * access token is stale (non-expiring token rejected in 2025+). Workers that
 * catch this should re-queue with a delay so the next embedded-app open can
 * trigger token exchange before retrying.
 */
export class ShopifyAuthError extends ShopifyAPIError {
  constructor(shop: string, requestId: string, body?: unknown) {
    super(`Shopify auth error — token likely stale`, 403, shop, requestId, body);
    this.name = 'ShopifyAuthError';
  }
}

const AVAILABLE_POINTS_FLOOR = 100;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(base: number): number {
  return base + Math.floor(Math.random() * base);
}

export interface ShopifyClientOptions {
  /** Override the decrypted token (useful for tests). */
  accessTokenOverride?: string;
  fetchImpl?: typeof fetch;
}

export class ShopifyClient {
  public readonly shopDomain: string;
  private readonly accessToken: string;
  /**
   * Readable so callers that must fetch a Shopify-issued URL *outside* the
   * GraphQL endpoint — the bulk-operation JSONL download — go through the same
   * fetch implementation. Using the global `fetch` there bypassed every
   * injected mock and made the download hit the real network from tests.
   */
  public readonly fetchImpl: typeof fetch;

  constructor(store: Pick<Store, 'shopDomain' | 'accessToken'>, opts: ShopifyClientOptions = {}) {
    this.shopDomain = store.shopDomain;
    this.accessToken = opts.accessTokenOverride ?? decrypt(store.accessToken);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private endpoint(): string {
    return `https://${this.shopDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
  }

  async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<GraphQLResponse<T>> {
    let attempt = 0;
    while (true) {
      const requestId = randomUUID();
      const start = Date.now();
      const res = await this.fetchImpl(this.endpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.accessToken,
          'X-Request-ID': requestId,
          Accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        signal,
      });
      const duration = Date.now() - start;

      if (res.status === 429) {
        const wait = jitter(BASE_BACKOFF_MS * 2 ** attempt);
        logger.warn(
          { shop: this.shopDomain, requestId, status: 429, wait, attempt },
          'Shopify 429 — backing off',
        );
        if (attempt >= MAX_RETRIES) {
          throw new ShopifyAPIError('Rate limited (429) after retries', 429, this.shopDomain, requestId);
        }
        await sleep(wait);
        attempt += 1;
        continue;
      }

      if (res.status >= 500 && res.status <= 599) {
        if (attempt >= MAX_RETRIES) {
          throw new ShopifyAPIError(
            `Shopify ${res.status} after ${MAX_RETRIES} retries`,
            res.status,
            this.shopDomain,
            requestId,
          );
        }
        const wait = jitter(BASE_BACKOFF_MS * 2 ** attempt);
        logger.warn(
          { shop: this.shopDomain, requestId, status: res.status, wait, attempt },
          'Shopify 5xx — retrying',
        );
        await sleep(wait);
        attempt += 1;
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        const text = await res.text().catch(() => '');
        logger.warn(
          { shop: this.shopDomain, requestId, status: res.status, body: text.slice(0, 500) },
          'Shopify auth error — full response',
        );
        throw new ShopifyAuthError(this.shopDomain, requestId, text);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ShopifyAPIError(
          `Shopify ${res.status}: ${text.slice(0, 500)}`,
          res.status,
          this.shopDomain,
          requestId,
          text,
        );
      }

      const body = (await res.json()) as GraphQLResponse<T>;
      const cost = body.extensions?.cost;
      logger.debug(
        {
          shop: this.shopDomain,
          requestId,
          duration,
          cost: cost?.actualQueryCost ?? cost?.requestedQueryCost,
          available: cost?.throttleStatus.currentlyAvailable,
        },
        'shopify.graphql',
      );

      // Proactive throttle: pause before we run out of points.
      if (cost?.throttleStatus && cost.throttleStatus.currentlyAvailable < AVAILABLE_POINTS_FLOOR) {
        const missing = AVAILABLE_POINTS_FLOOR - cost.throttleStatus.currentlyAvailable;
        const restoreMs = Math.ceil((missing / Math.max(cost.throttleStatus.restoreRate, 1)) * 1000);
        logger.info(
          {
            shop: this.shopDomain,
            available: cost.throttleStatus.currentlyAvailable,
            restoreMs,
          },
          'Throttle low — pausing before next call',
        );
        await sleep(Math.min(restoreMs, 5_000));
      }

      if (body.errors && body.errors.length > 0) {
        const throttled = body.errors.some(
          (e) => e.extensions?.code === 'THROTTLED',
        );
        if (throttled && attempt < MAX_RETRIES) {
          const wait = jitter(BASE_BACKOFF_MS * 2 ** attempt);
          logger.warn(
            { shop: this.shopDomain, requestId, wait, attempt },
            'GraphQL THROTTLED — backing off',
          );
          await sleep(wait);
          attempt += 1;
          continue;
        }
      }

      return body;
    }
  }
}
