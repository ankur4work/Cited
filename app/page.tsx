import { prisma } from '@/lib/prisma';
import { isValidShopDomain } from '@/lib/shopify/validators';

export const dynamic = 'force-dynamic';

/**
 * Embedded app entry point.
 *
 * Deliberately a server component with no client JS beyond App Bridge: at
 * this stage it reports real install state rather than rendering a mock
 * dashboard. Polaris UI lands once there is data worth showing.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: { shop?: string; host?: string };
}) {
  const shop = searchParams.shop;
  const valid = isValidShopDomain(shop);

  const store = valid
    ? await prisma.store.findUnique({
        where: { shopDomain: shop! },
        select: {
          shopDomain: true,
          plan: true,
          installedAt: true,
          uninstalledAt: true,
          scope: true,
          reviewScopeGranted: true,
          onboardingComplete: true,
          _count: { select: { products: true, reviews: true } },
        },
      })
    : null;

  return (
    <main
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        padding: '32px',
        maxWidth: '760px',
        margin: '0 auto',
        color: '#1a1a1a',
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: '1.5rem', margin: '0 0 4px' }}>Cited</h1>
      <p style={{ color: '#6b7280', margin: '0 0 28px' }}>
        Product Reviews &amp; AI Visibility
      </p>

      {!valid && (
        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            background: '#fafafa',
          }}
        >
          <h2 style={{ fontSize: '1rem', margin: '0 0 8px' }}>No shop context</h2>
          <p style={{ margin: 0, color: '#6b7280' }}>
            Open this app from your Shopify admin, or start an install at{' '}
            <code>/api/auth?shop=your-store.myshopify.com</code>.
          </p>
        </section>
      )}

      {valid && !store && (
        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            background: '#fafafa',
          }}
        >
          <h2 style={{ fontSize: '1rem', margin: '0 0 8px' }}>Not installed yet</h2>
          <p style={{ margin: '0 0 16px', color: '#6b7280' }}>
            {shop} has no Cited installation on record.
          </p>
          <a
            href={`/api/auth?shop=${encodeURIComponent(shop!)}`}
            style={{
              display: 'inline-block',
              padding: '8px 16px',
              background: '#1a1a1a',
              color: '#fff',
              borderRadius: 6,
              textDecoration: 'none',
            }}
          >
            Install Cited
          </a>
        </section>
      )}

      {store && (
        <section style={{ display: 'grid', gap: 12 }}>
          <Row label="Shop" value={store.shopDomain} />
          <Row label="Plan" value={store.plan} />
          <Row
            label="Status"
            value={store.uninstalledAt ? 'Uninstalled' : 'Installed'}
          />
          <Row label="Products synced" value={String(store._count.products)} />
          <Row label="Reviews" value={String(store._count.reviews)} />
          <Row
            label="Review metaobject access"
            value={
              store.reviewScopeGranted
                ? 'Granted — syndicating to Shopify'
                : 'Pending Shopify approval — rendering from Cited only'
            }
          />
          <Row label="Scopes" value={store.scope ?? '—'} />
        </section>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 0',
        borderBottom: '1px solid #e5e7eb',
      }}
    >
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
