import { ShopifyClient } from './client';
import { MetaobjectError } from './metaobjects';

/**
 * Review translations, through Shopify's own translation layer.
 *
 * The obvious implementation — translate into our database and render the right
 * column — was rejected deliberately. A review translated that way is visible
 * to us and to nobody else: not to the Shop app, not to the merchant's
 * Translate & Adapt admin, not to any other app reading the metaobject, and not
 * to a storefront rendering in a locale our block does not control. Registering
 * with Shopify means the translated text IS the review in that locale, for
 * every surface at once, with no rendering code on our side at all.
 *
 * The cost is the `write_translations` scope and a re-authorization for
 * existing installs. That is the whole cost; it buys correctness everywhere.
 */

const SHOP_LOCALES = /* GraphQL */ `
  query CitedShopLocales {
    shopLocales {
      locale
      primary
      published
    }
  }
`;

const TRANSLATABLE_CONTENT = /* GraphQL */ `
  query CitedTranslatableContent($resourceId: ID!) {
    translatableResource(resourceId: $resourceId) {
      translatableContent {
        key
        value
        digest
        locale
      }
    }
  }
`;

const REGISTER_TRANSLATIONS = /* GraphQL */ `
  mutation CitedRegisterTranslations($resourceId: ID!, $translations: [TranslationInput!]!) {
    translationsRegister(resourceId: $resourceId, translations: $translations) {
      translations { locale key }
      userErrors { field message code }
    }
  }
`;

export interface ShopLocale {
  locale: string;
  primary: boolean;
  published: boolean;
}

/**
 * Locales the storefront actually serves.
 *
 * Unpublished locales are filtered out: a merchant can have a locale configured
 * and not live, and translating into it spends money producing text no shopper
 * can reach.
 */
export async function publishedLocales(client: ShopifyClient): Promise<ShopLocale[]> {
  const res = await client.graphql<{ shopLocales: ShopLocale[] }>(SHOP_LOCALES);
  return (res.data?.shopLocales ?? []).filter((l) => l.published);
}

/**
 * Current digest for each translatable field on a resource.
 *
 * The digest is a hash of the source value, and `translationsRegister` rejects
 * a translation carrying a stale one. That is the mechanism that stops a
 * translation silently outliving the text it was made from: if a merchant edits
 * a review, every digest changes and our next write is refused until we re-read
 * — which is exactly the behaviour we want, so it is never worked around.
 */
export async function translatableDigests(
  client: ShopifyClient,
  resourceId: string,
): Promise<Map<string, { value: string; digest: string }>> {
  const res = await client.graphql<{
    translatableResource: {
      translatableContent: Array<{ key: string; value: string | null; digest: string | null }>;
    } | null;
  }>(TRANSLATABLE_CONTENT, { resourceId });

  const out = new Map<string, { value: string; digest: string }>();
  for (const c of res.data?.translatableResource?.translatableContent ?? []) {
    if (c.value && c.digest) out.set(c.key, { value: c.value, digest: c.digest });
  }
  return out;
}

/**
 * Which published locales a review still needs.
 *
 * Extracted from the processor because this is where the subtle mistakes live:
 * the primary locale is where the review already is, and locale codes are
 * region-tagged while a review's `language` is a bare ISO 639-1 code. Comparing
 * them as plain strings would happily "translate" an English review into
 * `en-GB` — paying for, and registering, a translation of English into English.
 */
export function missingLocales(
  locales: ShopLocale[],
  sourceLanguage: string,
  alreadyTranslated: string[],
): string[] {
  const base = (tag: string) => tag.toLowerCase().split('-')[0];
  const source = base(sourceLanguage);
  const done = new Set(alreadyTranslated.map((l) => l.toLowerCase()));

  return locales
    .filter((l) => l.published && !l.primary)
    .map((l) => l.locale)
    .filter((l) => base(l) !== source)
    .filter((l) => !done.has(l.toLowerCase()));
}

export interface TranslationInput {
  key: string;
  locale: string;
  value: string;
  translatableContentDigest: string;
}

export async function registerTranslations(
  client: ShopifyClient,
  resourceId: string,
  translations: TranslationInput[],
): Promise<void> {
  if (translations.length === 0) return;

  const res = await client.graphql<{
    translationsRegister: {
      userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
    } | null;
  }>(REGISTER_TRANSLATIONS, { resourceId, translations });

  if (!res.data?.translationsRegister) {
    const message =
      res.errors?.map((e) => e.message).join('; ') ?? 'translationsRegister returned no data';
    const denied = /access denied|required access/i.test(message);
    throw new MetaobjectError(
      `translations: ${message}`,
      denied ? 'ACCESS_DENIED' : undefined,
      denied,
    );
  }

  const errors = res.data.translationsRegister.userErrors ?? [];
  if (errors.length > 0) {
    const first = errors[0]!;
    // A stale digest is terminal for THIS attempt and fine on the next one:
    // the source text moved under us, so the right response is to re-read and
    // re-translate rather than to retry the same rejected payload.
    const stale = errors.some((e) => /digest/i.test(e.message));
    throw new MetaobjectError(
      `translations: ${errors.map((e) => e.message).join('; ')}`,
      first.code,
      stale,
    );
  }
}
