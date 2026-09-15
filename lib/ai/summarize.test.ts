import { describe, expect, it, vi } from 'vitest';
import type { ProductSummary } from './summarize';

vi.mock('../env', () => ({
  env: { OPENAI_API_KEY: 'sk-test', AI_MODEL_BULK: 'gpt-5.4-mini' },
}));
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { estimateCostCents, dropUnsupported, isRenderable } = await import('./summarize');

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

function summary(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return { pros: [], cons: [], themes: [], ...overrides };
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
    expect(isRenderable(summary())).toBe(false);
  });

  it('is true when any one section has content', () => {
    expect(isRenderable(summary({ cons: [{ label: 'Ships slowly', mentions: 4 }] }))).toBe(true);
  });
});
