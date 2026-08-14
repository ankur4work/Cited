import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Vite discovers postcss.config.js and tries to load its plugins even for
  // pure Node tests that import no CSS. Declaring an empty plugin list stops
  // the lookup, so the test run doesn't depend on the styling toolchain.
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Only unit tests. scripts/ holds smoke checks that expect a live
    // Postgres, Redis and Shopify token; picking those up here would make
    // `pnpm test` fail on any machine that hasn't provisioned them.
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'scripts/**'],
  },
});
