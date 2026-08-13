import IORedis from 'ioredis';
import { env } from './env';

// Shared Redis connection pool. BullMQ and ad-hoc consumers (rate limits,
// caches, OAuth state, embedding cache) share a single client to avoid
// exhausting Coolify's managed-Redis connection ceiling.
// `lazyConnect: true` — don't open a TCP connection on module import.
// Without this, Next.js build-time route analysis triggers real Redis
// connect attempts (Redis isn't running during build), which errors out.
export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: true,
});
