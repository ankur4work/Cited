import { resolveEmbeddedSession } from '@/lib/shopify/embedded-session';
import { getProducts } from '@/lib/dashboard';
import { SessionBootstrap } from '../_components/session-bootstrap';
import { ProductsView } from '../_components/products-view';
import { SessionRecovery } from '../_components/session-recovery';

export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { shop?: string; id_token?: string };
}) {
  const session = await resolveEmbeddedSession({
    shop: searchParams.shop,
    idToken: searchParams.id_token,
  });

  if (session.state === 'no-shop') return <SessionRecovery title="Products" />;
  if (session.state === 'needs-token') return <SessionBootstrap shop={session.shop} />;

  const products = await getProducts(session.store.id);

  return <ProductsView products={products} />;
}
