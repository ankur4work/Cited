/**
 * Relevance scoring — what "Smart Sorting" actually sorts by.
 *
 * The storefront used to show reviews newest-first, which is the ordering that
 * serves the reviewer rather than the shopper: a one-word "Great!" posted this
 * morning outranks the detailed, photographed, verified review from March that
 * forty people found helpful.
 *
 * Every input below is something a merchant can see in their own admin, so
 * "why is that review at the top?" has an answer. The only model-decided input
 * is `highlighted` — whether the summariser quoted the review — and it is a
 * boost on top of the deterministic score, never a replacement for it. A pure
 * model ranking would be unexplainable and unauditable, and on a page that
 * drives purchase decisions that is not a trade worth making.
 *
 * Scores are comparable only within a product. Nothing normalises across
 * catalogues and nothing should read them that way.
 */

export interface ScorableReview {
  rating: number;
  body: string | null;
  helpfulCount: number;
  notHelpfulCount: number;
  verification: 'VERIFIED_BUYER' | 'VERIFIED_REVIEWER' | 'UNVERIFIED';
  mediaCount: number;
  submittedAt: Date;
  /** True when the product summary quoted this review as a highlight. */
  highlighted?: boolean;
}

/** Weights are here, named, and testable — not scattered through a query. */
const W = {
  /** Substance. A review with reasons beats a review with an adjective. */
  body: 3.0,
  /** Other shoppers' judgement — the strongest human signal available. */
  helpful: 2.5,
  /** Someone actually bought it. */
  verified: 2.0,
  /** Photos and video answer questions text cannot. */
  media: 1.5,
  /** Mild recency preference, as a tie-breaker rather than a sort key. */
  recency: 1.0,
  /** The summariser found it quotable. */
  highlighted: 2.0,
  /** Mid ratings carry more decision-useful detail than 5s and 1s. */
  nuance: 0.5,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Diminishing returns curve, mapping any non-negative count into [0, 1).
 *
 * Linear weighting would let one review with 400 helpful votes bury everything
 * written since. The 20th vote should matter far less than the 2nd, which is
 * what this gives — and it cannot be gamed into unboundedness.
 */
function saturate(value: number, midpoint: number): number {
  if (value <= 0) return 0;
  return value / (value + midpoint);
}

/**
 * Score one review. Higher sorts first.
 *
 * `now` is a parameter rather than `Date.now()` so the recency term is testable
 * and so a batch rescore produces one consistent set of scores instead of
 * drifting across however long the job takes.
 */
export function relevanceScore(review: ScorableReview, now: Date): number {
  const bodyLength = review.body?.trim().length ?? 0;
  // ~280 characters is roughly where a review stops being a reaction and
  // starts being a reason. Past that, more words add little.
  const substance = saturate(bodyLength, 280);

  // Net votes only. A review with 10 helpful and 9 unhelpful is contested, not
  // valuable, and counting gross votes would promote whatever is divisive.
  const net = review.helpfulCount - review.notHelpfulCount;
  const helpful = saturate(net, 4);

  const verified = review.verification === 'VERIFIED_BUYER' ? 1 : 0;
  const media = saturate(review.mediaCount, 1);

  // Half-life of 60 days. The decay is steep — a year-old review keeps only a
  // few percent of THIS term — but the term is weighted 1.0 against a possible
  // 9.0 from everything above, so age can only ever break a near-tie. An old
  // review that says something still outranks a new one that does not; between
  // two equally thin reviews, the newer wins, which is the right call because
  // nothing else separates them.
  const ageDays = Math.max(0, (now.getTime() - review.submittedAt.getTime()) / DAY_MS);
  const recency = Math.pow(0.5, ageDays / 60);

  // 2–4 star reviews tend to explain trade-offs; 5s say "love it" and 1s are
  // often about shipping. A small nudge, not a thumb on the scale.
  const nuance = review.rating >= 2 && review.rating <= 4 ? 1 : 0;

  const highlighted = review.highlighted ? 1 : 0;

  return (
    W.body * substance +
    W.helpful * helpful +
    W.verified * verified +
    W.media * media +
    W.recency * recency +
    W.nuance * nuance +
    W.highlighted * highlighted
  );
}

/** Score a product's reviews against one clock, highest first. */
export function rankReviews<T extends ScorableReview & { id: string }>(
  reviews: T[],
  now: Date,
): Array<{ id: string; score: number }> {
  return reviews
    .map((r) => ({ id: r.id, score: relevanceScore(r, now) }))
    .sort((a, b) => b.score - a.score);
}
