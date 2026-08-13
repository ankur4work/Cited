import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * graphql-codegen config for Shopify Admin API 2025-04.
 *
 * Run with: `pnpm codegen`
 *
 * The schema is fetched from `https://shopify.dev/admin-graphql-direct-proxy/2025-04`
 * which proxies the public introspection. A valid `SHOPIFY_API_KEY` is not
 * required for this endpoint but a recent network is.
 *
 * Generated output lives in `lib/shopify/generated/admin.ts` and is committed
 * — we don't regenerate on every build (avoids network dependency in CI).
 */
const config: CodegenConfig = {
  overwrite: true,
  schema: [
    {
      'https://shopify.dev/admin-graphql-direct-proxy/2025-04': {
        headers: { 'User-Agent': 'gapfinder-codegen' },
      },
    },
  ],
  documents: ['lib/**/*.ts', 'lib/**/*.graphql', 'jobs/**/*.ts', 'server/**/*.ts'],
  generates: {
    'lib/shopify/generated/admin.ts': {
      plugins: ['typescript', 'typescript-operations'],
      config: {
        skipTypename: false,
        useTypeImports: true,
        enumsAsTypes: true,
        inlineFragmentTypes: 'combine',
      },
    },
  },
  ignoreNoDocuments: true,
};

export default config;
