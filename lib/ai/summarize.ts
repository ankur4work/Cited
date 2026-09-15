import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { openai, estimateCostCents, AiConfigError } from './client';

// Re-exported so callers and tests keep one import site for cost accounting.
export { estimateCostCents };

/**
 * AI review summaries — the first capability that is actually paid-only.
 *
 * Not a paragraph blob (PLAN.md §4.2). A shopper looking at 214 reviews and a
 * 4.6 average learns nothing; what they want is what people liked, what they
 * complained about, and how confident either claim is. So the output is
 * structured: pros and cons with mention counts, plus sentiment by theme.
 *
 * The mention counts are the load-bearing part. "Runs small" with 19 mentions
 * behind it is evidence; the same phrase with nothing behind it is the model's
 * impression of the corpus, which is exactly the thing we must not ship as a
 * claim about a merchant's product.
 *
 * Rendering happens server-side in Liquid, so the summary text lands in the
 * product page's raw HTML alongside the reviews themselves. That is what makes
 * this simultaneously a conversion feature and an AEO feature — same code,
 * same architecture, no separate crawler path (PLAN.md §5.3).
 */

// Numeric/length constraints are deliberately absent: the structured-outputs
// schema compiler rejects `minimum`/`maxLength` and friends. Bounds that matter
// (how many bullets we render, what counts as a usable summary) are enforced
// after parsing, in code that can actually explain itself.
const MentionSchema = z.object({
  /** Shopper-facing phrase, e.g. "Fit true to size". Not a sentence. */
  label: z.string(),
  /** How many reviews in the sample raised it. */
  mentions: z.number().int(),
});

const ThemeSchema = z.object({
  /** Attribute being scored, e.g. "Sizing", "Quality", "Shipping". */
  name: z.string(),
  sentiment: z.enum(['very_positive', 'positive', 'mixed', 'negative', 'very_negative']),
  mentions: z.number().int(),
});

/**
 * A quotable line lifted verbatim from one review.
 *
 * `review` is the 1-based index of the review in the corpus we sent, which is
 * what lets the caller map a highlight back to a real row — and therefore
 * verify the quote actually occurs in it. A highlight that cannot be traced to
 * a specific review is discarded rather than displayed.
 */
const HighlightSchema = z.object({
  /** Verbatim span from the review body. Not a paraphrase. */
  quote: z.string(),
  /** 1-based index into the reviews supplied, as labelled in the prompt. */
  review: z.number().int(),
});

export const ProductSummarySchema = z.object({
  pros: z.array(MentionSchema),
  cons: z.array(MentionSchema),
  themes: z.array(ThemeSchema),
  highlights: z.array(HighlightSchema),
});

/** Raw model output. Not what gets stored — see StoredSummary. */
export type ProductSummary = z.infer<typeof ProductSummarySchema>;

/**
 * A highlight after verification, carrying who said it.
 *
 * The model returns a corpus index; storage keeps the attribution instead, so
 * the storefront never has to resolve anything and a later change to the review
 * set cannot silently re-point a quote at a different person.
 */
export interface StoredHighlight {
  quote: string;
  author: string | null;
  rating: number;
}

/** The shape written to Summary.contentJson and read by the theme block. */
export interface StoredSummary {
  pros: ProductSummary['pros'];
  cons: ProductSummary['cons'];
  themes: ProductSummary['themes'];
  highlights: StoredHighlight[];
}

/** What the caller persists. Cost is reported so the budget gate can debit it. */
export interface SummaryResult {
  content: StoredSummary;
  /**
   * Corpus indexes of the reviews that were quoted, for the relevance boost.
   * Indexes into the array passed in, so callers can map back to their own ids.
   */
  highlightedIndexes: number[];
  model: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ReviewForSummary {
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string | null;
}

/** Raised when summarisation cannot proceed. Never surfaced to a shopper. */
export class SummarizeError extends Error {
  constructor(
    message: string,
    /** False for conditions a retry cannot fix (no API key, empty corpus). */
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'SummarizeError';
  }
}

const SYSTEM_PROMPT = `You summarise product reviews for an online store.

You will be given the reviews for ONE product. Produce a structured summary that
helps a shopper decide, using only what reviewers actually wrote.

Hard rules:
- Every pro, con and theme must be grounded in the supplied reviews. Never state
  a property of the product that no reviewer mentioned. You are summarising
  opinions, not describing merchandise.
- "mentions" is a count of how many supplied reviews raise that point. Count
  them. Do not estimate, round, or invent a number to make a point look stronger.
- Omit anything raised by only one reviewer. One person is an anecdote.
- Labels are short shopper-facing phrases ("Runs small", "Fast delivery"), not
  sentences and not quotes.
- Never mention a reviewer by name, and never reproduce contact details.
- Do not make medical, safety, legal or regulatory claims, and do not repeat a
  reviewer's, even if several make it.
- If the reviews do not support a category, return an empty array for it. An
  empty array is a correct answer; a padded one is not.

Themes are the attributes reviewers keep returning to — sizing, quality,
shipping, value, comfort, accuracy of the listing. Pick the ones this corpus
actually discusses rather than working from a fixed list.

Highlights are up to four short spans copied WORD FOR WORD out of review bodies
— the sentences that would most help someone deciding. Rules:
- Copy the text exactly as written, including its wording and punctuation. Do
  not paraphrase, clean up, summarise, join two sentences, or fix typos. The
  quote is checked against the original and silently dropped if it does not
  occur there verbatim.
- "review" is the bracketed number of the review you took it from.
- Prefer spans that give a concrete reason over ones that give a verdict.
- Do not quote anything containing a name, an email address or an order number.`;

function buildCorpus(reviews: ReviewForSummary[]): string {
  return reviews
    .map((r, i) => {
      const title = r.title?.trim();
      const body = r.body?.trim();
      const text = [title, body].filter(Boolean).join(' — ');
      return `[${i + 1}] ${r.rating}/5 ${text}`;
    })
    .join('\n');
}

/**
 * Summarise one product's reviews.
 *
 * Callers are responsible for the entitlement and budget checks — this function
 * spends money and does not ask whether it should.
 */
export async function summarizeProductReviews(input: {
  productTitle: string;
  reviews: ReviewForSummary[];
}): Promise<SummaryResult> {
  const { productTitle, reviews } = input;

  if (reviews.length === 0) {
    throw new SummarizeError('No reviews to summarise', false);
  }

  const model = env.AI_MODEL_BULK;
  const corpus = buildCorpus(reviews);

  // A missing key is terminal, not transient: surfaced as a SummarizeError so
  // the processor logs and returns instead of handing it to retry backoff.
  let client;
  try {
    client = openai();
  } catch (err) {
    if (err instanceof AiConfigError) throw new SummarizeError(err.message, false);
    throw err;
  }

  const completion = await client.chat.completions.parse({
    model,
    // `max_completion_tokens`, not `max_tokens`: the gpt-5 family reasons
    // before answering and rejects the older parameter. The ceiling is
    // generous relative to the real output (a few hundred tokens) because a
    // truncated response costs the whole call, while unused headroom costs
    // nothing — output is billed per token produced, not per token allowed.
    max_completion_tokens: 4096,
    response_format: zodResponseFormat(ProductSummarySchema, 'product_summary'),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Product: ${productTitle}\nReviews (${reviews.length}):\n\n${corpus}`,
      },
    ],
  });

  const choice = completion.choices[0];

  // A refusal is a successful HTTP response with no usable content. Treated as
  // terminal: the same corpus will be refused again, so retrying only burns
  // budget on a verdict that will not change.
  if (choice?.message.refusal) {
    throw new SummarizeError(`Model declined to summarise: ${choice.message.refusal}`, false);
  }

  const parsed = choice?.message.parsed;
  if (!parsed) {
    throw new SummarizeError(
      `Model returned no parseable summary (${choice?.finish_reason ?? 'no choice'})`,
    );
  }

  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;

  const supported = dropUnsupported(parsed);
  const verified = verifyHighlights(parsed.highlights, reviews);

  logger.debug(
    {
      model,
      reviews: reviews.length,
      inputTokens,
      outputTokens,
      highlightsReturned: parsed.highlights.length,
      highlightsVerified: verified.length,
    },
    'Product summary generated',
  );

  return {
    content: {
      pros: supported.pros,
      cons: supported.cons,
      themes: supported.themes,
      highlights: verified.map((h) => ({
        quote: h.quote,
        author: reviews[h.index]!.authorName,
        rating: reviews[h.index]!.rating,
      })),
    },
    highlightedIndexes: verified.map((h) => h.index),
    model,
    costCents: estimateCostCents(inputTokens, outputTokens),
    inputTokens,
    outputTokens,
  };
}

/**
 * Last line of defence on the grounding rule.
 *
 * The prompt tells the model to omit single-mention points, but a prompt is a
 * request and this is a claim about a merchant's product rendered on their
 * storefront. Anything that cannot point at two or more reviewers is dropped
 * here, where it is a filter rather than an instruction.
 */
export function dropUnsupported(summary: ProductSummary): ProductSummary {
  const supported = <T extends { mentions: number }>(items: T[]): T[] =>
    items.filter((i) => i.mentions >= 2);

  return {
    pros: supported(summary.pros),
    cons: supported(summary.cons),
    themes: supported(summary.themes),
    highlights: summary.highlights,
  };
}

/** Collapse whitespace and case so a quote survives cosmetic differences. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
}

/**
 * Keep only highlights that really are quotes.
 *
 * The prompt says copy verbatim; this checks. A highlight is displayed in
 * quotation marks and attributed to a named shopper, so a paraphrase is not a
 * cosmetic defect — it is words put in a real person's mouth on a merchant's
 * storefront. Anything that does not occur in the review it claims to come
 * from is dropped, along with anything pointing at a review index that does
 * not exist.
 *
 * Matching is whitespace- and quote-normalised, because a model reflowing a
 * line break or straightening an apostrophe is not the failure this guards.
 */
export function verifyHighlights(
  highlights: ProductSummary['highlights'],
  reviews: ReviewForSummary[],
): Array<{ quote: string; index: number }> {
  const haystacks = reviews.map((r) => normalise([r.title ?? '', r.body ?? ''].join(' ')));

  return highlights.flatMap((h) => {
    const i = h.review - 1;
    if (i < 0 || i >= haystacks.length) return [];

    const quote = h.quote.trim();
    // A two-word "quote" is not evidence of anything and will match almost any
    // review by accident.
    if (quote.length < 15) return [];
    if (!haystacks[i]!.includes(normalise(quote))) return [];

    return [{ quote, index: i }];
  });
}

/** True when a summary has enough substance to be worth rendering. */
export function isRenderable(summary: StoredSummary): boolean {
  return (
    summary.pros.length + summary.cons.length + summary.themes.length + summary.highlights.length >
    0
  );
}
