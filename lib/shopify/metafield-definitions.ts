import type { ShopifyClient } from './client';
import { logger } from '../logger';
import { PRODUCT_REVIEW_TYPE } from './metaobject-payload';

/**
 * Create the one metafield definition that cannot be declared in TOML.
 *
 * `metafieldsSet` refuses to write into an app-reserved namespace that has no
 * definition behind it:
 *
 *   "Value requires that you have a metafield definition with the key: reviews"
 *
 * The syndication job classifies that as permanent, logs it and moves on — so
 * the product-to-reviews link was never written, the block rendered an
 * aggregate above a permanently empty list, and nothing anywhere reported a
 * failure. Every other app-owned metafield is declared in shopify.app.toml and
 * installs with the app.
 *
 * This one cannot be. It is a `list.metaobject_reference` pointing at
 * `product_review`, a Shopify STANDARD definition, and the CLI rejects that:
 * "Validations must be a valid metaobject definition declared by your app."
 * The standard definition's id is per-shop besides, which a static file has no
 * way to carry.
 *
 * So it is created per shop, at runtime, and made idempotent by treating an
 * already-taken key as success.
 */

const DEFINITION_BY_TYPE = /* GraphQL */ `
  query CitedMetaobjectDefinition($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
    }
  }
`;

const DEFINITION_CREATE = /* GraphQL */ `
  mutation CitedMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const REVIEW_LIST_KEY = 'reviews';

/**
 * Ensure `$app.reviews` exists on this shop. Safe to call repeatedly.
 *
 * Returns true when the definition exists afterwards — whether this call
 * created it or found it already there.
 */
export async function ensureReviewListDefinition(client: ShopifyClient): Promise<boolean> {
  // The standard definition's id differs per shop, so it has to be looked up
  // rather than hardcoded.
  const lookup = await client.graphql<{
    metaobjectDefinitionByType: { id: string } | null;
  }>(DEFINITION_BY_TYPE, { type: PRODUCT_REVIEW_TYPE });

  const metaobjectDefinitionId = lookup.data?.metaobjectDefinitionByType?.id;
  if (!metaobjectDefinitionId) {
    // Before approval the restricted `product_review` definition is not
    // visible, which is a permission state rather than a fault — the caller
    // already skips syndication for that reason.
    logger.warn(
      { type: PRODUCT_REVIEW_TYPE },
      'No product_review metaobject definition on this shop — cannot define the review list',
    );
    return false;
  }

  const resp = await client.graphql<{
    metafieldDefinitionCreate: {
      createdDefinition: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
    } | null;
  }>(DEFINITION_CREATE, {
    definition: {
      ownerType: 'PRODUCT',
      namespace: '$app',
      key: REVIEW_LIST_KEY,
      name: 'Cited review list',
      description: 'Product reviews collected by Cited, newest first.',
      type: 'list.metaobject_reference',
      validations: [{ name: 'metaobject_definition_id', value: metaobjectDefinitionId }],
      access: {
        // The theme app extension reads this in Liquid on the storefront.
        storefront: 'PUBLIC_READ',
      },
    },
  });

  const errors = resp.data?.metafieldDefinitionCreate?.userErrors ?? [];

  // TAKEN means a previous run already created it. That is the steady state
  // for every call after the first, and is emphatically not an error.
  const taken = errors.some(
    (e) => e.code === 'TAKEN' || /already (exists|been taken)|taken/i.test(e.message),
  );
  if (taken) return true;

  if (errors.length > 0) {
    logger.error(
      { errors: errors.map((e) => `${e.code ?? ''} ${e.message}`) },
      'Could not create the review list metafield definition',
    );
    return false;
  }

  if (resp.data?.metafieldDefinitionCreate?.createdDefinition) {
    logger.info('Created the $app.reviews metafield definition');
    return true;
  }

  const message = resp.errors?.map((e) => e.message).join('; ') ?? 'no data returned';
  logger.error({ message }, 'Could not create the review list metafield definition');
  return false;
}
