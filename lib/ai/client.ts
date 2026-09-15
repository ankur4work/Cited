import OpenAI from 'openai';
import { env } from '@/lib/env';

/**
 * Shared OpenAI client and cost accounting.
 *
 * Extracted so summarisation and translation debit the same budget with the
 * same arithmetic. Two copies of the pricing constants is how one of them ends
 * up wrong after a model change, and the monthly cap is computed from them.
 */

/** Raised when an AI call cannot proceed. Never surfaced to a shopper. */
export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}

let cached: OpenAI | null = null;

export function openai(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new AiConfigError('OPENAI_API_KEY is not configured');
  }
  cached ??= new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return cached;
}

// gpt-5.4-mini list price: $0.75 / MTok input, $4.50 / MTok output.
// Here rather than in env because it is a fact about the model, not a
// deployment knob — if these drift the fix is a code change with a commit
// message, not a silently wrong number in someone's .env. Pointing
// AI_MODEL_BULK at a model on different rates makes the AI budget cap wrong.
const INPUT_CENTS_PER_MTOK = 75;
const OUTPUT_CENTS_PER_MTOK = 450;

/**
 * Cost of one call, in cents, rounded UP.
 *
 * A single call costs a small fraction of a cent, and both `Summary.costCents`
 * and `Store.aiCentsUsedMtd` are integer cents — so honest rounding would
 * record 0 and the monthly budget would never advance, leaving the cap
 * decorative. Ceiling instead: the counter can only ever over-state spend,
 * which is the safe direction for a rail rather than a meter.
 */
export function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const micro =
    (inputTokens * INPUT_CENTS_PER_MTOK) / 1_000_000 +
    (outputTokens * OUTPUT_CENTS_PER_MTOK) / 1_000_000;
  return Math.max(1, Math.ceil(micro));
}
