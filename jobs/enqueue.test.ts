import { describe, it, expect, vi, beforeEach } from 'vitest';

const add = vi.fn();
/** Every add() on every queue, so one assertion can cover all of them. */
const anyAdd = vi.fn();

const queue = () => ({
  add: (...a: unknown[]) => anyAdd(...a),
  getJob: async () => undefined,
});

vi.mock('./queue', () => ({
  QUEUES: { INGESTION: 'ingestion' },
  ingestionQueue: {
    add: (...a: unknown[]) => {
      anyAdd(...a);
      return add(...a);
    },
    getJob: async () => undefined,
  },
  syndicationQueue: queue(),
  maintenanceQueue: queue(),
  importQueue: queue(),
  emailQueue: queue(),
  aiQueue: queue(),
  aeoQueue: queue(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  enqueueInstallBackfill,
  enqueueOrderSync,
  enqueueProductSync,
  enqueueReviewSyndication,
  enqueueAggregateSync,
  enqueueSyndicationBackfill,
  enqueueMetaobjectReconcile,
  enqueueReviewRequest,
  enqueueCompliancePurge,
  enqueueMediaBackfill,
  enqueueReviewTranslation,
  enqueueProductSummary,
  jobKey,
} = await import('./enqueue');

/**
 * Job IDs decide whether an install syncs anything at all, and both ways of
 * getting them wrong fail SILENTLY — the call sites log and swallow, so a
 * broken id means no products and no error anywhere a merchant can see.
 *
 * Both failures below happened on 2026-08-19.
 */
describe('enqueueInstallBackfill job ids', () => {
  beforeEach(() => add.mockReset().mockResolvedValue(undefined));

  function idsFrom(): string[] {
    return add.mock.calls.map((c) => (c[2] as { jobId: string }).jobId);
  }

  it('varies the id per install, so a REINSTALL is not deduped', async () => {
    await enqueueInstallBackfill({ storeId: 's1', shopDomain: 'x.myshopify.com', installKey: new Date(1000) });
    await enqueueInstallBackfill({ storeId: 's1', shopDomain: 'x.myshopify.com', installKey: new Date(2000) });

    const ids = idsFrom();
    // Completed jobs live for 7 days; identical ids here mean the second
    // install's backfill is dropped as a duplicate and nothing ever syncs.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never produces an id BullMQ will reject', async () => {
    await enqueueInstallBackfill({ storeId: 's1', shopDomain: 'x.myshopify.com', installKey: new Date(1000) });

    for (const id of idsFrom()) {
      // BullMQ: a custom id containing ':' must split into exactly 3 parts.
      if (id.includes(':')) expect(id.split(':')).toHaveLength(3);
      expect(Number.isNaN(Number(id))).toBe(true); // and it cannot be an integer
    }
  });

  it('queues products and orders, products first', async () => {
    await enqueueInstallBackfill({ storeId: 's1', shopDomain: 'x.myshopify.com', installKey: new Date(1000) });

    expect(add.mock.calls[0]![0]).toBe('ingest:products');
    expect(add.mock.calls[1]![0]).toBe('ingest:orders');
    expect((add.mock.calls[1]![2] as { delay: number }).delay).toBeGreaterThan(0);
  });

  it('still works without an install key', async () => {
    await enqueueInstallBackfill({ storeId: 's1', shopDomain: 'x.myshopify.com' });
    expect(idsFrom()[0]).toContain('s1');
  });
});

/**
 * Every enqueue helper, against BullMQ's actual rule.
 *
 * The rule is a trap: an id containing ':' is allowed ONLY when it splits into
 * exactly three parts, so `syndicate:review:abc` passed while `compliance:abc`
 * and `email:camp:order:0` threw. Since every call site logs and swallows, the
 * result was silent — review-request emails never reached the queue and GDPR
 * compliance jobs never ran, with nothing failing anywhere visible.
 *
 * Covering one helper is what let that through the first time. This covers all
 * of them.
 */
describe('every job id BullMQ will accept', () => {
  beforeEach(() => {
    anyAdd.mockReset().mockResolvedValue(undefined);
    add.mockReset().mockResolvedValue(undefined);
  });

  const store = 's1';
  const shopDomain = 'x.myshopify.com';

  const cases: Array<[string, () => Promise<void>]> = [
    ['install', () => enqueueInstallBackfill({ storeId: store, shopDomain })],
    ['order sync', () => enqueueOrderSync({ storeId: store, shopDomain })],
    ['product sync', () => enqueueProductSync({ storeId: store, shopDomain })],
    ['review syndication', () => enqueueReviewSyndication({ storeId: store, reviewId: 'r1' })],
    [
      'review syndication repair',
      () => enqueueReviewSyndication({ storeId: store, reviewId: 'r1', repairKey: 'k1' }),
    ],
    ['aggregate', () => enqueueAggregateSync({ storeId: store, productId: 'p1' })],
    ['backfill', () => enqueueSyndicationBackfill({ storeId: store })],
    ['backfill with cursor', () => enqueueSyndicationBackfill({ storeId: store, cursor: 'c1' })],
    [
      'reconcile',
      () =>
        enqueueMetaobjectReconcile({
          storeId: store,
          webhookId: 'w1',
          webhookEventId: 'we1',
          topic: 'metaobjects/update',
          metaobjectGid: 'gid://shopify/Metaobject/1',
        }),
    ],
    [
      'review request',
      () =>
        enqueueReviewRequest({
          storeId: store,
          campaignId: 'c1',
          // A Shopify GID carries colons of its own — the id must survive one.
          orderShopifyGid: 'gid://shopify/Order/123',
        }),
    ],
    [
      'compliance',
      () =>
        enqueueCompliancePurge({
          complianceRequestId: 'cr1',
          storeId: store,
          shopDomain,
          type: 'customers/redact',
          customerEmail: null,
          orderGids: [],
        } as never),
    ],
    ['media backfill', () => enqueueMediaBackfill({ storeId: store, reviewId: 'r1' })],
    ['translation', () => enqueueReviewTranslation({ storeId: store, reviewId: 'r1' } as never)],
    ['summary', () => enqueueProductSummary({ storeId: store, productId: 'p1' } as never)],
  ];

  it.each(cases)('%s', async (_label, run) => {
    await run();

    const ids = anyAdd.mock.calls
      .map((c) => (c[2] as { jobId?: string } | undefined)?.jobId)
      .filter((id): id is string => typeof id === 'string');

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      // The exact condition from bullmq/classes/job.js.
      expect(id.includes(':') && id.split(':').length !== 3).toBe(false);
      expect(`${parseInt(id, 10)}` === id).toBe(false);
    }
  });
});

describe('jobKey', () => {
  it('strips the colons a Shopify GID brings with it', () => {
    expect(jobKey('email', 'c1', 'gid://shopify/Order/9', 0)).not.toContain(':');
  });

  it('keeps distinct inputs distinct', () => {
    expect(jobKey('a', 'b')).not.toBe(jobKey('a', 'c'));
  });
});
