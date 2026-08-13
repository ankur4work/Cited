import * as Sentry from '@sentry/nextjs';
import { env } from './env';

let initialized = false;

/**
 * Idempotent Sentry initialization — safe to call from multiple entry points.
 * PII scrubbing: strip `accessToken`, `access_token`, `authorization`, cookies,
 * and any header starting with `x-shopify-` from the breadcrumb/event payload.
 */
export function initSentry(): void {
  if (initialized || !env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend(event) {
      scrubEvent(event);
      return event;
    },
  });
  initialized = true;
}

function scrubEvent(event: Sentry.Event): void {
  if (event.request?.headers) {
    for (const k of Object.keys(event.request.headers)) {
      const lower = k.toLowerCase();
      if (
        lower === 'authorization' ||
        lower === 'cookie' ||
        lower.startsWith('x-shopify-') ||
        lower.startsWith('x-real-ip')
      ) {
        event.request.headers[k] = '[redacted]';
      }
    }
  }
  // Deep-scrub any `accessToken`-ish fields from extras/contexts.
  scrubDeep(event as unknown as Record<string, unknown>);
}

function scrubDeep(obj: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    if (/token|secret|password|authorization/i.test(k)) {
      obj[k] = '[redacted]';
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      scrubDeep(v as Record<string, unknown>);
    }
  }
}

export { Sentry };
