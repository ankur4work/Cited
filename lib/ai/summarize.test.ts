import { describe, expect, it, vi } from 'vitest';
import type { ProductSummary, StoredSummary, ReviewForSummary } from './summarize';

vi.mock('../env', () => ({
  env: { OPENAI_API_KEY: 'sk-test', AI_MODEL_BULK: 'gpt-5.4-mini' },
}));
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { estimateCostCents, dropUnsupported, isRenderable, verifyHighlights } = await import(
  './summarize'
);

describe('estimateCostCents', () => {
  it('prices input and output at their separate rates', () => {
    // gpt-5.4-mini: 1M in ($0.75) + 1M out ($4.50) = 525 cents.
    expect(estimateCostCents(1_000_000, 1_000_000)).toBe(525);
  });

  it('never records a real call as free', () => {
    // A single summary costs a fraction of a cent, and both the Summary row
    // and the store counter are integer cents. Rounding honestly would store
    // 0, the monthly budget would never advance, and the cap enforcing it
    // would be decorative. Ceiling keeps the rail real.
    expect(estimateCostCents(3_000, 400)).toBe(1);
    expect(estimateCostCents(1, 1)).toBe(1);
  });

  it('only over-states, never under-states', () => {
    const inputTokens = 40_000;
    const outputTokens = 600;
    const exact = (inputTokens * 75) / 1e6 + (outputTokens * 450) / 1e6;
    expect(estimateCostCents(inputTokens, outputTokens)).toBeGreaterThanOrEqual(exact);
  });
});

/** Raw model output, as it arrives from the structured-output call. */
function summary(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return { pros: [], cons: [], themes: [], highlights: [], ...overrides };
}

/** The verified shape that is persisted and rendered. */
function stored(overrides: Partial<StoredSummary> = {}): StoredSummary {
  return { pros: [], cons: [], themes: [], highlights: [], ...overrides };
}

describe('dropUnsupported', () => {
  it('keeps points two or more reviewers raised', () => {
    const result = dropUnsupported(
      summary({ pros: [{ label: 'Fit true to size', mentions: 61 }] }),
    );
    expect(result.pros).toHaveLength(1);
  });

  it('drops a point only one reviewer raised', () => {
    // The prompt asks the model to omit these, but a prompt is a request and
    // this renders on a merchant's storefront as a claim about their product.
    // One person is an anecdote, so the filter is code, not an instruction.
    const result = dropUnsupported(summary({ cons: [{ label: 'Runs warm', mentions: 1 }] }));
    expect(result.cons).toEqual([]);
  });

  it('drops a fabricated zero-mention point', () => {
    // The failure that matters: a model inventing a plausible-sounding
    // property with no reviewer behind it at all.
    const result = dropUnsupported(
      summary({ pros: [{ label: 'Great for sensitive skin', mentions: 0 }] }),
    );
    expect(result.pros).toEqual([]);
  });

  it('applies the same floor to themes', () => {
    const result = dropUnsupported(
      summary({
        themes: [
          { name: 'Sizing', sentiment: 'positive', mentions: 12 },
          { name: 'Packaging', sentiment: 'mixed', mentions: 1 },
        ],
      }),
    );
    expect(result.themes.map((t) => t.name)).toEqual(['Sizing']);
  });
});

describe('isRenderable', () => {
  it('is false when nothing survived the mention floor', () => {
    // A corpus with no consensus is a legitimate outcome. Rendering the empty
    // shell would imply we found nothing worth saying about a liked product.
    expect(isRenderable(stored())).toBe(false);
  });

  it('is true when any one section has content', () => {
    expect(isRenderable(stored({ cons: [{ label: 'Ships slowly', mentions: 4 }] }))).toBe(true);
  });

  it('is true when only highlights survived', () => {
    // Quotes alone are worth rendering: a corpus can be too varied to produce
    // a two-mention consensus and still contain a sentence worth reading.
    expect(
      isRenderable(stored({ highlights: [{ quote: 'Runs small', author: 'Tom', rating: 4 }] })),
    ).toBe(true);
  });
});

function review(body: string, title: string | null = null): ReviewForSummary {
  return { rating: 4, title, body, authorName: 'Tester' };
}

describe('verifyHighlights', () => {
  const reviews = [
    review('The fabric is genuinely lovely and it arrived in two days.'),
    review('Runs small across the shoulders, order a size up.', 'Sizing is off'),
  ];

  it('keeps a quote that occurs verbatim in the review it cites', () => {
    const kept = verifyHighlights([{ quote: 'arrived in two days', review: 1 }], reviews);
    expect(kept).toEqual([{ quote: 'arrived in two days', index: 0 }]);
  });

  it('matches across whitespace and curly-quote differences', () => {
    // A model reflowing a line break or straightening an apostrophe is not the
    // failure this guards against — rejecting those would drop good quotes.
    const kept = verifyHighlights(
      [{ quote: 'Runs  small\nacross the shoulders', review: 2 }],
      reviews,
    );
    expect(kept).toHaveLength(1);
  });

  it('drops a paraphrase', () => {
    // The failure that matters. A highlight renders in quotation marks and is
    // attributed to a named shopper, so a paraphrase puts words in a real
    // person's mouth on the merchant's storefront.
    const kept = verifyHighlights(
      [{ quote: 'The material feels really nice', review: 1 }],
      reviews,
    );
    expect(kept).toEqual([]);
  });

  it('drops a quote attributed to the wrong review', () => {
    // Text that exists in the corpus but not in the review cited. Rendering it
    // would attribute one shopper's words to another.
    const kept = verifyHighlights([{ quote: 'arrived in two days', review: 2 }], reviews);
    expect(kept).toEqual([]);
  });

  it('drops an out-of-range review index', () => {
    expect(verifyHighlights([{ quote: 'arrived in two days', review: 99 }], reviews)).toEqual([]);
    expect(verifyHighlights([{ quote: 'arrived in two days', review: 0 }], reviews)).toEqual([]);
  });

  it('drops a fragment too short to be evidence', () => {
    // Two words match almost any review by accident and prove nothing.
    expect(verifyHighlights([{ quote: 'lovely', review: 1 }], reviews)).toEqual([]);
  });
});
