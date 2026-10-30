// Fork: unit tests for the fork's code (web/src/fork/**/*.test.ts), in a simulated
// browser (happy-dom). Upstream's `npm run test` drives a real browser instead.
//   npm run test:fork
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/fork/**/*.test.ts'],
    setupFiles: ['src/fork/test-setup.ts']
  }
})
