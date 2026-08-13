const CSP_DIRECTIVES = [
  // Default to self; we explicitly allowlist below.
  "default-src 'self'",
  // Shopify admin embeds us. These hosts are REQUIRED by the Built-for-Shopify
  // review — don't tighten without updating the listing.
  "frame-ancestors https://*.myshopify.com https://admin.shopify.com",
  "frame-src 'self' https://*.shopify.com",
  // App Bridge is CDN-hosted. Next.js inline scripts need 'unsafe-inline' in
  // dev; in prod it uses nonces but we skip nonces here for simplicity.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com",
  // Polaris ships inline CSS for its styles and Next needs inline for runtime.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://cdn.shopify.com https://*.myshopify.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.myshopify.com https://monorail-edge.shopifysvc.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.myshopify.com https://admin.shopify.com",
  "upgrade-insecure-requests",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // ESLint runs as a separate step in CI (`pnpm lint`). Disabling here
  // so trivial lint issues (unused imports, unescaped quotes) don't block
  // production image builds.
  eslint: { ignoreDuringBuilds: true },
  // TypeScript type check runs as a separate CI step (`pnpm typecheck`).
  // Next's inline tsc pass was OOM-killing the build container on our
  // memory-constrained Coolify host. Skipping here keeps prod builds
  // fast + stable; real type safety is enforced in CI + local dev.
  typescript: { ignoreBuildErrors: true },
  // `output: 'standalone'` was previously enabled for smaller Docker images,
  // but the worker entrypoint (jobs/worker.ts) imports from lib/ + server/
  // which aren't in the standalone trace. We run both web and worker from
  // the same image, so we keep the full source in the runner stage instead.
  //
  // Trace collection (`Collecting build traces ...`) was OOM-killing the
  // build container on our 15GB Coolify host — it loads every module into
  // a single Node process after compilation. We only need traces for
  // standalone output (which we don't use), so disable it entirely.
  outputFileTracing: false,
  experimental: {
    serverComponentsExternalPackages: [
      '@shopify/shopify-api',
      'pino',
      'pino-pretty',
      '@xenova/transformers',
      'prom-client',
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: CSP_DIRECTIVES },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Intentionally NO X-Frame-Options — it would override frame-ancestors
          // on legacy UAs and break the embed. CSP is the correct control here.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
