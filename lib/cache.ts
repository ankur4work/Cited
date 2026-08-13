import { redis } from './redis';
import { logger } from './logger';

// Thin read-through cache. JSON-serialized. Best-effort: a Redis outage falls
// back to the producer without failing the request.

export async function getOrCompute<T>(
  key: string,
  ttlSec: number,
  producer: () => Promise<T>,
): Promise<T> {
  if (ttlSec <= 0) return producer();
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as T;
  } catch (err) {
    logger.warn({ key, err: (err as Error).message }, 'cache read failed — bypassing');
  }
  const fresh = await producer();
  try {
    await redis.set(key, JSON.stringify(fresh), 'EX', ttlSec);
  } catch (err) {
    logger.warn({ key, err: (err as Error).message }, 'cache write failed — silent');
  }
  return fresh;
}

export async function invalidate(keyOrPattern: string): Promise<void> {
  if (keyOrPattern.endsWith('*')) {
    const keys = await redis.keys(keyOrPattern);
    if (keys.length > 0) await redis.del(...keys);
  } else {
    await redis.del(keyOrPattern);
  }
}

/**
 * Dashboard summary cache key. Versioned (`v2`) because the summary is now
 * windowed and takes the window length as a parameter — a `v1` entry holds
 * all-time totals under a key that no longer means the same thing.
 *
 * The window is part of the key: the same store viewed at 7 and 90 days are
 * different answers, and collapsing them into one entry is how the cards came
 * to disagree with the chart above them.
 */
export function summaryCacheKey(storeId: string, days: number): string {
  return `dash:summary:v2:${storeId}:${days}`;
}

/**
 * Drop every cached window for a store. Call this after ANY write that moves
 * the dashboard numbers — a search event, a classification run, an ingest.
 * Invalidating a single key would leave the other windows stale, which is
 * indistinguishable from the app failing to sync.
 */
export async function invalidateSummary(storeId: string): Promise<void> {
  await invalidate(`dash:summary:v2:${storeId}:*`);
}
