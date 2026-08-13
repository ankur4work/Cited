import pino from 'pino';
import { env } from './env';
import { getRequestContext } from './request-context';

const isDev = env.NODE_ENV !== 'production';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'gapfinder', env: env.NODE_ENV },
  // Attach request_id + shop_domain to every log line if we're inside a
  // request-scoped AsyncLocalStorage frame. Pino mixin runs per-record so no
  // child-logger plumbing is required at call sites.
  mixin() {
    const ctx = getRequestContext();
    if (!ctx) return {};
    return {
      request_id: ctx.requestId,
      shop_domain: ctx.shopDomain,
      store_id: ctx.storeId,
      route: ctx.route,
    };
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'accessToken',
      'access_token',
      'password',
      'secret',
      'SHOPIFY_API_SECRET',
      'SESSION_SECRET',
      '*.accessToken',
      '*.access_token',
    ],
    remove: true,
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, singleLine: false, translateTime: 'SYS:standard' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
