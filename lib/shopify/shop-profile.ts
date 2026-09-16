import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ShopifyClient } from './client';

/**
 * Pull the merchant's own details from Shopify.
 *
 * `Store.name`, `email`, `currency`, `timezone` and `countryCode` have been on
 * the model since the beginning and nothing ever wrote to them. That was
 * invisible until review requests shipped: the sender display name comes from
 * `store.name`, so with it null every email would have arrived in a customer's
 * inbox showing a bare `no-reply@…` address instead of the shop they bought
 * from — which is both worse for the merchant and markedly more likely to be
 * reported as spam.
 *
 * `contactEmail`, not `email`: the former is the address a shop already
 * publishes for customers to reach them, which is exactly the right target for
 * a reply to a review request. The account owner's login address is not.
 */

const SHOP_PROFILE = /* GraphQL */ `
  query CitedShopProfile {
    shop {
      name
      contactEmail
      currencyCode
      ianaTimezone
      billingAddress { countryCodeV2 }
    }
  }
`;

interface ShopProfile {
  name: string | null;
  contactEmail: string | null;
  currencyCode: string | null;
  ianaTimezone: string | null;
  billingAddress: { countryCodeV2: string | null } | null;
}

/**
 * Refresh a store's profile. Never fatal.
 *
 * Called on authorize, where the surrounding work is installing the app. A
 * merchant whose shop name could not be read still gets a working install —
 * the consequence is a less pretty From line until the next authorize, not a
 * failed installation.
 */
export async function syncShopProfile(store: {
  id: string;
  shopDomain: string;
  accessToken: string | null;
}): Promise<void> {
  try {
    const res = await new ShopifyClient(store).graphql<{ shop: ShopProfile | null }>(SHOP_PROFILE);
    const shop = res.data?.shop;
    if (!shop) return;

    await prisma.store.update({
      where: { id: store.id },
      data: {
        // Each field is only written when Shopify actually returned one, so a
        // partial response cannot blank a value we already hold.
        ...(shop.name ? { name: shop.name } : {}),
        ...(shop.contactEmail ? { email: shop.contactEmail } : {}),
        ...(shop.currencyCode ? { currency: shop.currencyCode } : {}),
        ...(shop.ianaTimezone ? { timezone: shop.ianaTimezone } : {}),
        ...(shop.billingAddress?.countryCodeV2
          ? { countryCode: shop.billingAddress.countryCodeV2 }
          : {}),
      },
    });

    logger.debug({ storeId: store.id, name: shop.name }, 'Shop profile synced');
  } catch (err) {
    logger.warn(
      { storeId: store.id, shopDomain: store.shopDomain, err: (err as Error).message },
      'Could not sync shop profile',
    );
  }
}
