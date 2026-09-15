import { describe, expect, it } from 'vitest';
import { relevanceScore, rankReviews, type ScorableReview } from './relevance';

const NOW = new Date('2026-09-15T12:00:00Z');

function review(overrides: Partial<ScorableReview> = {}): ScorableReview {
  return {
    rating: 5,
    body: 'Good.',
    helpfulCount: 0,
    notHelpfulCount: 0,
    verification: 'UNVERIFIED',
    mediaCount: 0,
    submittedAt: NOW,
    ...overrides,
  };
}

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('relevanceScore', () => {
  it('ranks a substantive review above a one-word one', () => {
    // The whole point of replacing newest-first: "Great!" should not outrank
    // a review that explains why.
    const detailed = review({ body: 'x'.repeat(400) });
    const terse = review({ body: 'Great!' });
    expect(relevanceScore(detailed, NOW)).toBeGreaterThan(relevanceScore(terse, NOW));
  });

  it('rewards helpful votes with diminishing returns', () => {
    const some = relevanceScore(review({ helpfulCount: 4 }), NOW);
    const none = relevanceScore(review({ helpfulCount: 0 }), NOW);
    const many = relevanceScore(review({ helpfulCount: 400 }), NOW);

    expect(some).toBeGreaterThan(none);
    // The 400-vote review must not be able to bury everything written since:
    // the gain from 4 → 400 is smaller than the gain from 0 → 4.
    expect(many - some).toBeLessThan(some - none);
  });

  it('treats contested reviews as less valuable, not more', () => {
    // 10 helpful / 9 unhelpful is divisive, not useful. Counting gross votes
    // would promote exactly the reviews shoppers disagree about.
    const contested = review({ helpfulCount: 10, notHelpfulCount: 9 });
    const quietlyUseful = review({ helpfulCount: 3, notHelpfulCount: 0 });
    expect(relevanceScore(quietlyUseful, NOW)).toBeGreaterThan(relevanceScore(contested, NOW));
  });

  it('never lets downvotes push a review below an unvoted one by more than the helpful weight', () => {
    // saturate() returns 0 for negative input rather than going negative, so a
    // brigaded review is neutral on this axis, not penalised into oblivion.
    const brigaded = review({ helpfulCount: 0, notHelpfulCount: 50 });
    const untouched = review();
    expect(relevanceScore(brigaded, NOW)).toBe(relevanceScore(untouched, NOW));
  });

  it('rewards verified purchases and media', () => {
    expect(relevanceScore(review({ verification: 'VERIFIED_BUYER' }), NOW)).toBeGreaterThan(
      relevanceScore(review(), NOW),
    );
    expect(relevanceScore(review({ mediaCount: 1 }), NOW)).toBeGreaterThan(
      relevanceScore(review(), NOW),
    );
  });

  it('decays with age', () => {
    const fresh = relevanceScore(review(), NOW);
    const old = relevanceScore(review({ submittedAt: daysAgo(365) }), NOW);
    expect(old).toBeLessThan(fresh);
  });

  it('keeps recency a tie-breaker rather than a sort key', () => {
    // The property that actually matters for a mature product: a year-old
    // review that says something still beats a brand-new one that does not.
    // Recency is capped at weight 1.0 while substance, votes, verification and
    // media total 9.0, so age can only ever break a near-tie.
    //
    // Between two EQUALLY thin reviews age does dominate — correctly, since
    // there is nothing else to separate them.
    const oldButGood = review({
      body: 'x'.repeat(400),
      helpfulCount: 12,
      verification: 'VERIFIED_BUYER',
      mediaCount: 1,
      submittedAt: daysAgo(365),
    });
    const newButThin = review({ body: 'Great!' });

    expect(relevanceScore(oldButGood, NOW)).toBeGreaterThan(relevanceScore(newButThin, NOW));
  });

  it('gives the AI highlight a boost without letting it dominate', () => {
    const highlighted = relevanceScore(review({ highlighted: true }), NOW);
    const plain = relevanceScore(review(), NOW);
    expect(highlighted).toBeGreaterThan(plain);

    // A highlighted one-liner must still lose to a long, verified, helpful,
    // photographed review. The model nudges the ordering; it does not set it.
    const strong = review({
      body: 'x'.repeat(400),
      helpfulCount: 20,
      verification: 'VERIFIED_BUYER',
      mediaCount: 2,
    });
    expect(relevanceScore(strong, NOW)).toBeGreaterThan(highlighted);
  });

  it('is deterministic for the same input and clock', () => {
    const r = review({ body: 'consistent', helpfulCount: 3 });
    expect(relevanceScore(r, NOW)).toBe(relevanceScore(r, NOW));
  });
});

describe('rankReviews', () => {
  it('returns ids ordered best first', () => {
    const ranked = rankReviews(
      [
        { id: 'terse', ...review({ body: 'ok' }) },
        { id: 'rich', ...review({ body: 'x'.repeat(400), helpfulCount: 10, mediaCount: 1 }) },
      ],
      NOW,
    );
    expect(ranked.map((r) => r.id)).toEqual(['rich', 'terse']);
  });
});
