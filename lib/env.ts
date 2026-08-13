import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ── Shopify ────────────────────────────────────────────────
  SHOPIFY_API_KEY: z.string().min(1, 'SHOPIFY_API_KEY is required'),
  SHOPIFY_API_SECRET: z.string().min(1, 'SHOPIFY_API_SECRET is required'),
  SHOPIFY_APP_URL: z.string().url('SHOPIFY_APP_URL must be a valid URL'),
  SHOPIFY_SCOPES: z.string().min(1, 'SHOPIFY_SCOPES is required'),

  // The `product_review` standard metaobject is a RESTRICTED definition.
  // `write_product_reviews` is granted only after Shopify approves the app
  // as a product review app. Until then we render from our own data and
  // mark the metaobject projection SKIPPED. See PLAN.md §5.2.1.
  SHOPIFY_SCOPES_RESTRICTED: z.string().default('write_product_reviews'),

  SHOPIFY_APP_HANDLE: z.string().min(1).default('cited'),
  SHOPIFY_FREE_PLAN_NAME: z.string().min(1).default('Free'),

  // ── Datastores ─────────────────────────────────────────────
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection string'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid connection string'),

  // 32 bytes hex. Also the AES-256-GCM key for access tokens at rest
  // (lib/crypto.ts) — rotating it invalidates every stored token.
  SESSION_SECRET: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SESSION_SECRET must be 64 hex characters (32 bytes)'),

  // ── Media: Cloudflare R2 ───────────────────────────────────
  // R2 over S3 for zero egress. Review media is served millions of times;
  // egress would be the single largest cost line. See PLAN.md §5.4.2.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('cited-media'),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  FREE_PLAN_MEDIA_QUOTA_BYTES: z.coerce.number().int().positive().default(2_147_483_648),

  // ── Email ──────────────────────────────────────────────────
  // SES for bulk review requests (~$0.10/1k). Resend/SMTP transactional only.
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().default('cited-reviews'),
  RESEND_API_KEY: z.string().optional(),

  FROM_EMAIL: z.string().email().default('no-reply@cited.reviews'),
  SUPPORT_EMAIL: z.string().email().default('support@cited.reviews'),
  COMPANY_ADDRESS: z.string().default('Cited'),

  // Campaigns above this recipient count require explicit merchant
  // confirmation before dispatch. See PLAN.md §2 (W4).
  SEND_SAFETY_GATE_THRESHOLD: z.coerce.number().int().positive().default(250),
  EMAIL_RATE_PER_STORE_PER_HOUR: z.coerce.number().int().positive().default(500),

  // ── AI ─────────────────────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL_BULK: z.string().default('claude-haiku-4-5-20251001'),
  AI_MODEL_REASONING: z.string().default('claude-sonnet-5'),
  // Hard monthly ceiling per store. Free tier gets 0 — an uncapped free
  // tier with AI features is how this product dies (PLAN.md §8).
  AI_BUDGET_CENTS_PER_STORE: z.coerce.number().int().nonnegative().default(500),

  // ── Observability ──────────────────────────────────────────
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // ── Ops ────────────────────────────────────────────────────
  ADMIN_EMAILS: z.string().default(''),
  ADMIN_BEARER: z.string().default(''),
  CRON_SECRET: z.string().default(''),
  PRIVACY_CONTACT_EMAIL: z.string().email().default('privacy@cited.reviews'),
  DPA_URL: z.string().url().optional(),

  // ── Rate limits ────────────────────────────────────────────
  RATE_LIMIT_MERCHANT_PER_MIN: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_PUBLIC_PER_MIN: z.coerce.number().int().positive().default(30),

  // ── GDPR ───────────────────────────────────────────────────
  ANALYTICS_PIXEL_DEFAULT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Static stub used ONLY during `next build` (phase-production-build).
 * Next.js evaluates route modules at build time for metadata generation
 * and those modules import this env. We don't want CI/Coolify to need
 * real secrets at build time, so we return a typed stub. At runtime
 * (container start) real env vars are present and validation runs
 * normally — if they're missing THEN we fail fast.
 */
const BUILD_STUB: Env = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  SHOPIFY_API_KEY: 'build-time-stub',
  SHOPIFY_API_SECRET: 'build-time-stub',
  SHOPIFY_APP_URL: 'https://build-stub.invalid',
  SHOPIFY_SCOPES: 'read_products',
  SHOPIFY_SCOPES_RESTRICTED: 'write_product_reviews',
  SHOPIFY_APP_HANDLE: 'cited',
  SHOPIFY_FREE_PLAN_NAME: 'Free',
  DATABASE_URL: 'postgresql://stub:stub@localhost:5432/stub',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: '0'.repeat(64),
  R2_BUCKET: 'cited-media',
  FREE_PLAN_MEDIA_QUOTA_BYTES: 2_147_483_648,
  AWS_REGION: 'us-east-1',
  SES_CONFIGURATION_SET: 'cited-reviews',
  FROM_EMAIL: 'no-reply@build.invalid',
  SUPPORT_EMAIL: 'support@build.invalid',
  COMPANY_ADDRESS: 'build stub',
  SEND_SAFETY_GATE_THRESHOLD: 250,
  EMAIL_RATE_PER_STORE_PER_HOUR: 500,
  AI_MODEL_BULK: 'claude-haiku-4-5-20251001',
  AI_MODEL_REASONING: 'claude-sonnet-5',
  AI_BUDGET_CENTS_PER_STORE: 500,
  SENTRY_TRACES_SAMPLE_RATE: 0.1,
  ADMIN_EMAILS: '',
  ADMIN_BEARER: '',
  CRON_SECRET: '',
  PRIVACY_CONTACT_EMAIL: 'privacy@build.invalid',
  RATE_LIMIT_MERCHANT_PER_MIN: 100,
  RATE_LIMIT_PUBLIC_PER_MIN: 30,
  ANALYTICS_PIXEL_DEFAULT_ENABLED: true,
};

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return BUILD_STUB;
    }
    const formatted = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

/** Full scope string to request once Shopify grants review-app access. */
export function fullScopes(): string {
  return [env.SHOPIFY_SCOPES, env.SHOPIFY_SCOPES_RESTRICTED].filter(Boolean).join(',');
}
