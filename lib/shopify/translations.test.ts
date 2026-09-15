import { describe, expect, it, vi } from 'vitest';
import type { ShopLocale } from './translations';

vi.mock('../env', () => ({ env: {} }));
vi.mock('./client', () => ({ ShopifyClient: class {} }));
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { missingLocales, publishedLocales, translatableDigests, registerTranslations } =
  await import('./translations');

function locale(code: string, over: Partial<ShopLocale> = {}): ShopLocale {
  return { locale: code, primary: false, published: true, ...over };
}

/** Minimal stand-in — these functions only ever call `graphql`. */
function clientReturning(data: unknown, errors?: Array<{ message: string }>) {
  return { graphql: vi.fn().mockResolvedValue({ data, errors }) } as never;
}

describe('missingLocales', () => {
  const locales = [
    locale('en', { primary: true }),
    locale('fr'),
    locale('de'),
    locale('es', { published: false }),
  ];

  it('returns the published, non-primary locales', () => {
    expect(missingLocales(locales, 'en', [])).toEqual(['fr', 'de']);
  });

  it('never translates a review into its own language', () => {
    // A French review on an English-primary store should not be "translated"
    // into French.
    expect(missingLocales(locales, 'fr', [])).toEqual(['de']);
  });

  it('compares on base language, ignoring region', () => {
    // The bug this guards: `language` is a bare ISO 639-1 code while a shop
    // locale is region-tagged, so a plain string compare would pay to
    // translate English into en-GB and register the result.
    const regional = [locale('en-US', { primary: true }), locale('en-GB'), locale('fr-CA')];
    expect(missingLocales(regional, 'en', [])).toEqual(['fr-CA']);
  });

  it('skips locales already registered', () => {
    expect(missingLocales(locales, 'en', ['fr'])).toEqual(['de']);
  });

  it('matches already-registered locales case-insensitively', () => {
    expect(missingLocales(locales, 'en', ['FR'])).toEqual(['de']);
  });

  it('excludes unpublished locales', () => {
    // Translating into a configured-but-unpublished locale spends money on
    // text no shopper can reach.
    expect(missingLocales(locales, 'en', [])).not.toContain('es');
  });

  it('returns nothing for a single-locale shop', () => {
    expect(missingLocales([locale('en', { primary: true })], 'en', [])).toEqual([]);
  });
});

describe('publishedLocales', () => {
  it('drops unpublished locales', async () => {
    const result = await publishedLocales(
      clientReturning({
        shopLocales: [
          { locale: 'en', primary: true, published: true },
          { locale: 'de', primary: false, published: false },
        ],
      }),
    );
    expect(result.map((l) => l.locale)).toEqual(['en']);
  });
});

describe('translatableDigests', () => {
  it('maps key to value and digest', async () => {
    const map = await translatableDigests(
      clientReturning({
        translatableResource: {
          translatableContent: [
            { key: 'title', value: 'Great', digest: 'd1' },
            { key: 'body', value: 'Really great', digest: 'd2' },
          ],
        },
      }),
      'gid://shopify/Metaobject/1',
    );
    expect(map.get('title')).toEqual({ value: 'Great', digest: 'd1' });
    expect(map.size).toBe(2);
  });

  it('skips fields with no value or no digest', async () => {
    // Registering against a null digest is rejected by Shopify anyway; better
    // to never build the input than to send one we know is invalid.
    const map = await translatableDigests(
      clientReturning({
        translatableResource: {
          translatableContent: [
            { key: 'title', value: null, digest: 'd1' },
            { key: 'body', value: 'text', digest: null },
          ],
        },
      }),
      'gid://shopify/Metaobject/1',
    );
    expect(map.size).toBe(0);
  });
});

describe('registerTranslations', () => {
  const input = [
    { key: 'body', locale: 'fr', value: 'Excellent', translatableContentDigest: 'd1' },
  ];

  it('does nothing when there is nothing to register', async () => {
    const client = clientReturning(null);
    await registerTranslations(client, 'gid://shopify/Metaobject/1', []);
    expect((client as unknown as { graphql: ReturnType<typeof vi.fn> }).graphql).not.toHaveBeenCalled();
  });

  it('succeeds when Shopify reports no user errors', async () => {
    await expect(
      registerTranslations(
        clientReturning({ translationsRegister: { userErrors: [] } }),
        'gid://shopify/Metaobject/1',
        input,
      ),
    ).resolves.toBeUndefined();
  });

  it('marks a missing-scope failure terminal so it is not retried', async () => {
    // Until the merchant re-authorizes for write_translations this is a
    // permanent state. Retrying would walk it into the dead-letter queue and
    // make a consent gap look like an outage.
    await expect(
      registerTranslations(
        clientReturning(null, [{ message: 'Access denied for translationsRegister' }]),
        'gid://shopify/Metaobject/1',
        input,
      ),
    ).rejects.toMatchObject({ terminal: true, code: 'ACCESS_DENIED' });
  });

  it('marks a stale digest terminal so the job re-reads instead of retrying', async () => {
    // The source text moved while we were translating. Retrying the same
    // payload can only fail again — the right response is a fresh read.
    await expect(
      registerTranslations(
        clientReturning({
          translationsRegister: {
            userErrors: [{ field: null, message: 'Translatable content digest is invalid' }],
          },
        }),
        'gid://shopify/Metaobject/1',
        input,
      ),
    ).rejects.toMatchObject({ terminal: true });
  });
});
