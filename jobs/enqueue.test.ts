import { describe, it, expect, vi, beforeEach } from 'vitest';

const add = vi.fn();

vi.mock('./queue', () => ({
  QUEUES: { INGESTION: 'ingestion' },
  ingestionQueue: { add: (...a: unknown[]) => add(...a) },
  syndicationQueue: { add: vi.fn() },
  maintenanceQueue: { add: vi.fn() },
  importQueue: { add: vi.fn() },
  emailQueue: { add: vi.fn() },
  aiQueue: { add: vi.fn() },
  aeoQueue: { add: vi.fn() },
}));

const { enqueueInstallBackfill } = await import('./enqueue');

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
