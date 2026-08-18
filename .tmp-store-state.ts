import { prisma } from "@/lib/prisma";
async function main() {
  const s = await prisma.store.findFirst({ where: { uninstalledAt: null } });
  if (!s) { console.log("NO STORE"); return; }
  console.log("shop            :", s.shopDomain);
  console.log("installedAt     :", s.installedAt?.toISOString());
  console.log("accessToken     :", s.accessToken ? "present" : "MISSING");
  console.log("accessExpiresAt :", s.accessTokenExpiresAt?.toISOString() ?? "NULL  <- legacy/dead");
  console.log("refreshToken    :", s.refreshToken ? "present" : "MISSING <- cannot refresh");
  console.log("refreshExpiresAt:", s.refreshTokenExpiresAt?.toISOString() ?? "null");
  console.log("scope           :", s.scope);
  console.log("counts          :", JSON.stringify({
    products: await prisma.product.count(), orders: await prisma.order.count(), reviews: await prisma.review.count(),
  }));
}
main().catch(e => console.error("ERR", e.message)).finally(() => prisma.$disconnect());
