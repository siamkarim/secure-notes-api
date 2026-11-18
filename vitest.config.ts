import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    hookTimeout: 180_000, // first run downloads a MongoDB binary
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://unused-in-tests',
      JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0001',
      JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret-0002',
    },
  },
});
