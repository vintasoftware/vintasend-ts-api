import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Holds every app a test builds to the statuses openapi.yaml declares.
    setupFiles: ['./test/helpers/declared-statuses.ts'],
  },
});
