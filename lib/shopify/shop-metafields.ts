import { ShopifyClient } from './client';
import { MetaobjectError } from './metaobjects';
import { logger } from '../logger';

/**
 * Shop-level feature flags the storefront needs to know about.
 *
 * The theme block renders from Liquid and has no way to ask what plan a store
 * is on — there is no request to our server in the storefront path, which is
 * the whole point of a server-rendered block. So anything the block must gate
 * on has to reach it as data Shopify already holds.
 *
 * This is the write side of that: one app-owned shop metafield, refreshed when
 * the plan changes. The block reads `shop.metafields.app.features` and hides
 * what the store is not entitled to.
 *
 * NOT a security boundary. It decides what the form OFFERS; the proxy route
 * decides what it ACCEPTS, and that check is the one that matters. A merchant
 * who edits their theme to restore the input gets a rejected upload, not a free
 * feature.
 */

const SHOP_QUERY = /* GraphQL */ `
  query CitedShopId {
    shop { id }
  }
`;

const METAFIELDS_SET = /* GraphQL */ `
  mutation CitedShopFeatures($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }
`;

export interface StorefrontFeatures {
  /** Whether the review form should offer a video input. */
  video: boolean;
}

export async function setStorefrontFeatures(
  client: ShopifyClient,
  features: StorefrontFeatures,
): Promise<void> {
  const shop = await client.graphql<{ shop: { id: string } }>(SHOP_QUERY);
  const shopId = shop.data?.shop?.id;
  if (!shopId) throw new MetaobjectError('shop features: could not resolve shop id');

  const resp = await client.graphql<{
    metafieldsSet: {
      userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
    } | null;
  }>(METAFIELDS_SET, {
    metafields: [
      {
        ownerId: shopId,
        namespace: '$app',
        key: 'features',
        type: 'json',
        value: JSON.stringify(features),
      },
    ],
  });

  const errors = resp.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    throw new MetaobjectError(`shop features: ${errors.map((e) => e.message).join('; ')}`);
  }
}

/**
 * Publish the widget appearance a merchant chose in the app.
 *
 * The blocks read this instead of their own theme-editor settings, so the
 * customiser in the admin is the single place these values exist. A second set
 * of controls in the theme editor would be a copy that silently disagrees with
 * what the storefront renders.
 */
export async function setWidgetSettings(
  client: ShopifyClient,
  settings: Record<string, string | number>,
): Promise<void> {
  const shop = await client.graphql<{ shop: { id: string } }>(SHOP_QUERY);
  const shopId = shop.data?.shop?.id;
  if (!shopId) throw new MetaobjectError('widget settings: could not resolve shop id');

  const resp = await client.graphql<{
    metafieldsSet: {
      userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
    } | null;
  }>(METAFIELDS_SET, {
    metafields: [
      {
        ownerId: shopId,
        namespace: '$app',
        key: 'widget_settings',
        type: 'json',
        value: JSON.stringify(settings),
      },
    ],
  });

  if (!resp.data?.metafieldsSet) {
    const message =
      resp.errors?.map((e) => e.message).join('; ') ?? 'metafieldsSet returned no data';
    throw new MetaobjectError(`widget settings: ${message}`);
  }

  const errors = resp.data.metafieldsSet.userErrors ?? [];
  if (errors.length > 0) {
    throw new MetaobjectError(`widget settings: ${errors.map((e) => e.message).join('; ')}`);
  }
}

const WIDGET_SETTINGS_QUERY = /* GraphQL */ `
  query CitedWidgetSettings {
    shop {
      metafield(namespace: "$app", key: "widget_settings") {
        jsonValue
      }
    }
  }
`;

/** Read back what was published. Returns null when the merchant never saved. */
export async function getWidgetSettings(client: ShopifyClient): Promise<unknown | null> {
  const resp = await client.graphql<{
    shop: { metafield: { jsonValue: unknown } | null };
  }>(WIDGET_SETTINGS_QUERY);

  return resp.data?.shop?.metafield?.jsonValue ?? null;
}

/**
 * Refresh the storefront flags for a store, never fatally.
 *
 * Called from the plan-change webhook, where the plan write has already
 * committed. A failure here means the form offers video for a little longer
 * than it should — the proxy route still refuses the upload — and that is not
 * worth failing a billing webhook over and having Shopify retry the whole
 * thing.
 */
export async function syncStorefrontFeatures(
  store: { id: string; shopDomain: string; accessToken: string | null },
  plan: string,
): Promise<void> {
  try {
    await setStorefrontFeatures(new ShopifyClient(store), { video: plan !== 'FREE' });
  } catch (err) {
    logger.warn(
      { storeId: store.id, plan, err: (err as Error).message },
      'Could not refresh storefront feature flags',
    );
  }
}
