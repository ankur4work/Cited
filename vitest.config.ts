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
    // Leading `**/` matters: these patterns are matched against the whole
    // path, so a bare `node_modules/**` only catches the one at the root.
    // Git worktrees live at `.claude/worktrees/<branch>/`, INSIDE the repo,
    // each with its own installed dependencies — and several published
    // packages ship their `*.test.ts` sources. Without the recursive form
    // `vitest run` collects those, and dozens of vendored files fail on
    // `describe is not defined` because they expect their own runner.
    exclude: ['**/node_modules/**', '**/.next/**', 'scripts/**', '.claude/**'],

    /**
     * Synthetic values so `lib/env.ts` validates.
     *
     * Anything importing the logger — which is most of the codebase — pulls in
     * env, and env fails fast on a missing key by design. Without these, a
     * unit test of pure logic dies on configuration it never uses.
     *
     * These are deliberately obvious fakes pointing at unroutable hosts, so a
     * test that accidentally opens a real connection fails loudly rather than
     * reaching something real. NODE_ENV stays `test`, which also keeps the
     * production TLS check out of the way.
     */
    env: {
      NODE_ENV: 'test',
      SHOPIFY_API_KEY: 'test-key',
      SHOPIFY_API_SECRET: 'test-secret',
      SHOPIFY_APP_URL: 'https://test.invalid',
      SHOPIFY_SCOPES: 'read_products',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
      REDIS_URL: 'redis://127.0.0.1:1',
      SESSION_SECRET: '0'.repeat(64),
    },
  },
});
