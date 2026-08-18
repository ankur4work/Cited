import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const stores = await prisma.store.findMany({
    select: {
      id: true,
      shopDomain: true,
      scope: true,
      reviewScopeGranted: true,
      installedAt: true,
      uninstalledAt: true,
      accessToken: true,
    },
    orderBy: { installedAt: 'desc' },
  });

  console.log(`STORE ROWS: ${stores.length}`);
  for (const s of stores) {
    console.log(
      [
        `  shop=${s.shopDomain}`,
        `id=${s.id}`,
        `token=${s.accessToken ? 'present(' + String(s.accessToken).length + ' chars)' : 'MISSING'}`,
        `reviewScopeGranted=${s.reviewScopeGranted}`,
        `installedAt=${s.installedAt?.toISOString?.() ?? s.installedAt}`,
        `uninstalledAt=${s.uninstalledAt ?? 'null'}`,
      ].join(' '),
    );
    console.log(`    scope=${s.scope}`);
  }

  const counts = {
    products: await prisma.product.count(),
    orders: await prisma.order.count().catch(() => 'n/a'),
    reviews: await prisma.review.count().catch(() => 'n/a'),
  };
  console.log('COUNTS:', JSON.stringify(counts));
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
