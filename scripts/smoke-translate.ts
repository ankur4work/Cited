/**
 * Live smoke check for review translation.
 *
 * Verifies the model call works and, more importantly, that it behaves like a
 * translator rather than an editor: voice preserved, hedging preserved, nothing
 * added, no title invented where the source had none.
 *
 * Needs OPENAI_API_KEY. No database, no Redis, no Shopify.
 *
 *   npx tsx --env-file=.env scripts/smoke-translate.ts
 */
import { translateReview } from '../lib/ai/translate';

const CASES = [
  {
    label: 'casual + hedged',
    title: 'Pretty good',
    body: "bit tight on the shoulders tbh, but i think it might just be me. fabric's lovely though.",
    target: 'fr',
  },
  {
    label: 'no title',
    title: null,
    body: 'Arrived in two days. Exactly as described.',
    target: 'de',
  },
];

async function main(): Promise<void> {
  for (const c of CASES) {
    const result = await translateReview({
      title: c.title,
      body: c.body,
      sourceLocale: 'en',
      targetLocale: c.target,
    });

    console.log(`\n── ${c.label} → ${c.target} ──`);
    console.log(`title: ${JSON.stringify(result.content.title)}`);
    console.log(`body:  ${result.content.body}`);
    console.log(`cost:  ${result.costCents}c  (${result.inputTokens} in / ${result.outputTokens} out)`);

    // A title invented where the source had none would be our words presented
    // as the shopper's, in a language they do not speak.
    if (c.title === null && result.content.title !== '') {
      console.log('  ⚠ FAIL: invented a title where the source had none');
    }
    // A translation twice as long has had content added rather than converted.
    const ratio = result.content.body.length / c.body.length;
    if (ratio > 2 || ratio < 0.4) {
      console.log(`  ⚠ FAIL: length ratio ${ratio.toFixed(2)} — content added or dropped`);
    }
    if (result.content.body.trim().length === 0) {
      console.log('  ⚠ FAIL: empty body');
    }
  }
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
