/**
 * Live smoke check for AI review summaries.
 *
 * Exercises the one thing unit tests cannot: that the configured model exists,
 * accepts the parameters we send, and returns output matching the schema. A
 * wrong model ID or a renamed parameter is a 400 at runtime and invisible
 * until a real merchant's summary silently fails.
 *
 * Needs OPENAI_API_KEY. No database, no Redis, no Shopify.
 *
 *   npx tsx --env-file=.env scripts/smoke-summary.ts
 */
import { summarizeProductReviews, estimateCostCents } from '../lib/ai/summarize';

// Deliberately shaped so the grounding rules are observable in the output:
// "runs small" is raised by three reviewers and must survive; the zip complaint
// is raised once and must be dropped by the two-mention floor.
const REVIEWS = [
  { rating: 5, title: 'Perfect', body: 'Fabric quality is excellent and it arrived in two days.', authorName: 'Priya' },
  { rating: 4, title: 'Runs small', body: 'Lovely jacket but order a size up, it runs small.', authorName: 'Tom' },
  { rating: 5, title: null, body: 'Great quality fabric, very warm. Shipping was quick too.', authorName: 'Amara' },
  { rating: 3, title: 'Sizing is off', body: 'Runs small across the shoulders. Quality is good though.', authorName: 'Jonas' },
  { rating: 2, title: 'Zip broke', body: 'The zip failed after a week. Disappointing.', authorName: 'Lee' },
  { rating: 4, title: null, body: 'Warm and well made. Had to size up — runs small.', authorName: 'Sofia' },
  { rating: 5, title: 'Fast delivery', body: 'Came next day, quality is lovely.', authorName: null },
];

async function main(): Promise<void> {
  const started = Date.now();
  const result = await summarizeProductReviews({
    productTitle: 'Merino Wool Overshirt',
    reviews: REVIEWS,
  });

  console.log(`model:    ${result.model}`);
  console.log(`tokens:   ${result.inputTokens} in / ${result.outputTokens} out`);
  console.log(`cost:     ${result.costCents}c (exact ${(
    (result.inputTokens * 75) / 1e6 +
    (result.outputTokens * 450) / 1e6
  ).toFixed(4)}c)`);
  console.log(`latency:  ${Date.now() - started}ms`);
  console.log(JSON.stringify(result.content, null, 2));

  const labels = [...result.content.pros, ...result.content.cons].map((p) => p.label.toLowerCase());
  const keptSizing = labels.some((l) => l.includes('small') || l.includes('siz'));
  const droppedZip = !labels.some((l) => l.includes('zip'));

  // Every highlight must occur verbatim in some review, or verifyHighlights
  // has stopped doing its job.
  const corpus = REVIEWS.map((r) => `${r.title ?? ''} ${r.body}`.toLowerCase().replace(/\s+/g, ' '));
  const allGrounded = result.content.highlights.every((h) =>
    corpus.some((c) => c.includes(h.quote.toLowerCase().replace(/\s+/g, ' ').trim())),
  );

  console.log(`\nsizing kept (3 mentions):  ${keptSizing ? 'yes' : 'NO — grounding may be off'}`);
  console.log(`zip dropped (1 mention):   ${droppedZip ? 'yes' : 'NO — floor not applied'}`);
  console.log(`highlights verbatim:       ${allGrounded ? 'yes' : 'NO — paraphrase leaked through'} (${result.content.highlights.length})`);
  console.log(`sanity cost check:         ${estimateCostCents(1_000_000, 1_000_000) === 525 ? 'ok' : 'RATES CHANGED'}`);
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
