import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { redis } from './redis';
import { env } from './env';
import { logger } from './logger';

// Token bucket on Redis. We refill `capacity` tokens every `windowSec` seconds
// using a single atomic Lua script: compute current tokens from last refill,
// subtract 1 if possible, persist. Deterministic, cluster-safe, cheap (one
// round-trip per check).
//
// Key shape: `rl:{bucket}:{subject}` where subject is a shop domain, IP, or
// synthetic "global-{op}" key.

const BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])   -- tokens per second
local now = tonumber(ARGV[3])           -- ms
local requested = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local delta_ms = math.max(0, now - ts)
local refill = (delta_ms / 1000) * refill_rate
tokens = math.min(capacity, tokens + refill)

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, 60000)

return { allowed, math.floor(tokens), capacity }
`;

interface BucketResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

async function consume(
  key: string,
  capacity: number,
  refillPerSec: number,
): Promise<BucketResult> {
  const res = (await redis.eval(
    BUCKET_SCRIPT,
    1,
    key,
    String(capacity),
    String(refillPerSec),
    String(Date.now()),
    '1',
  )) as [number, number, number];
  return { allowed: res[0] === 1, remaining: res[1], limit: res[2] };
}

function extractIp(req: NextRequest): string {
  // Coolify / reverse proxies set X-Forwarded-For; first entry is the client.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

function rateLimitResponse(result: BucketResult, retryAfterSec = 10): NextResponse {
  return NextResponse.json(
    { error: 'rate limited' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
      },
    },
  );
}

export interface RateLimitOK {
  ok: true;
  remaining: number;
  limit: number;
}
export interface RateLimitBlocked {
  ok: false;
  response: NextResponse;
}

/** Merchant-scoped limit: 100 req/min per shop by default. */
export async function merchantRateLimit(
  shop: string,
  op = 'default',
): Promise<RateLimitOK | RateLimitBlocked> {
  const capacity = env.RATE_LIMIT_MERCHANT_PER_MIN;
  const result = await consume(`rl:merchant:${op}:${shop}`, capacity, capacity / 60);
  if (!result.allowed) {
    logger.warn({ shop, op, limit: result.limit }, 'merchant rate limit hit');
    return { ok: false, response: rateLimitResponse(result) };
  }
  return { ok: true, remaining: result.remaining, limit: result.limit };
}

/** Public-endpoint limit: 30 req/min per IP by default. */
export async function publicRateLimit(
  req: NextRequest,
  op = 'default',
): Promise<RateLimitOK | RateLimitBlocked> {
  const capacity = env.RATE_LIMIT_PUBLIC_PER_MIN;
  const ip = extractIp(req);
  const result = await consume(`rl:public:${op}:${ip}`, capacity, capacity / 60);
  if (!result.allowed) {
    logger.warn({ ip, op, limit: result.limit }, 'public rate limit hit');
    return { ok: false, response: rateLimitResponse(result) };
  }
  return { ok: true, remaining: result.remaining, limit: result.limit };
}
