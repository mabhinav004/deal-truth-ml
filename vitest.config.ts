import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: process.env.RUN_MODEL_TESTS === '1' ? [] : ['test/live/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
