import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { openai, estimateCostCents, AiConfigError } from './client';

/**
 * Review translation.
 *
 * A review is somebody's actual words about something they bought, so the job
 * here is narrower than "translate": preserve the voice, the register and the
 * hedging. A shopper writing "bit tight on the shoulders tbh" is telling you
 * something a tidied-up "The garment is slightly narrow in the shoulder area"
 * does not. Reviews translated into corporate prose read as fabricated, which
 * defeats the reason anyone reads reviews at all.
 */

const TranslationSchema = z.object({
  /** Empty string when the source was empty — never invented. */
  title: z.string(),
  body: z.string(),
});

export type TranslatedReview = z.infer<typeof TranslationSchema>;

export interface TranslationResult {
  content: TranslatedReview;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
}

export class TranslateError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'TranslateError';
  }
}

function systemPrompt(targetLocale: string): string {
  return `You translate customer product reviews into ${targetLocale}.

You are translating one real shopper's words. Rules:
- Preserve voice and register. Casual stays casual, terse stays terse, annoyed
  stays annoyed. Do not smooth, formalise, or improve the writing.
- Preserve hedging and uncertainty exactly. "I think it might run small" must
  not become "it runs small".
- Translate only. Do not add, remove, explain, summarise or answer.
- Keep the same rough length. A translation twice as long has had content added.
- Leave brand names, model numbers, sizes and measurements exactly as written.
- If a field is empty, return an empty string for it. Never invent a title.
- Do not translate into anything other than ${targetLocale}.

Return the translated title and body, nothing else.`;
}

/** Translate one review's text into one locale. */
export async function translateReview(input: {
  title: string | null;
  body: string | null;
  sourceLocale: string;
  targetLocale: string;
}): Promise<TranslationResult> {
  const { title, body, sourceLocale, targetLocale } = input;

  if (!title?.trim() && !body?.trim()) {
    throw new TranslateError('Nothing to translate', false);
  }

  // A missing key is terminal, not transient — see the same guard in
  // summarize.ts. Retry backoff cannot conjure a credential.
  let client;
  try {
    client = openai();
  } catch (err) {
    if (err instanceof AiConfigError) throw new TranslateError(err.message, false);
    throw err;
  }

  const completion = await client.chat.completions.parse({
    model: env.AI_MODEL_BULK,
    max_completion_tokens: 4096,
    response_format: zodResponseFormat(TranslationSchema, 'translated_review'),
    messages: [
      { role: 'system', content: systemPrompt(targetLocale) },
      {
        role: 'user',
        content: `Source language: ${sourceLocale}\nTitle: ${title ?? ''}\nBody: ${body ?? ''}`,
      },
    ],
  });

  const choice = completion.choices[0];
  if (choice?.message.refusal) {
    throw new TranslateError(`Model declined to translate: ${choice.message.refusal}`, false);
  }

  const parsed = choice?.message.parsed;
  if (!parsed) {
    throw new TranslateError(
      `Model returned no parseable translation (${choice?.finish_reason ?? 'no choice'})`,
    );
  }

  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;

  logger.debug({ targetLocale, inputTokens, outputTokens }, 'Review translated');

  return {
    // A title invented where the source had none would be our words presented
    // as the shopper's, in a language they do not speak.
    content: {
      title: title?.trim() ? parsed.title : '',
      body: parsed.body,
    },
    costCents: estimateCostCents(inputTokens, outputTokens),
    inputTokens,
    outputTokens,
  };
}
