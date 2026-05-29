import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Runs the test suite inside the real workerd runtime with Durable Object +
// SQLite support, so the frozen contract is exercised end-to-end (not mocked).
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
  },
});
