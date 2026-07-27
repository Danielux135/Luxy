import { defineConfig } from 'vitest/config';

// los tests nunca hacen red real: todo se mockea
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    globals: false,
    testTimeout: 20000,
  },
});
