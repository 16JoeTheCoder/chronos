// Vitest: node environment. Tests cover the pure core and the main-process
// store/controller, which are written without Electron imports.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
