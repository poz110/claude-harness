/**
 * vitest.config.js — v14.4
 *
 * Vitest configuration for workflow system unit tests
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Test file patterns
    include: ['tests/**/*.test.js'],

    // Global setup
    setupFiles: ['tests/setup.js'],

    // Environment
    environment: {
    NODE_ENV: 'test',
    WORKFLOW_TIMEOUT_DEFAULT: '1000',
    WORKFLOW_TIMEOUT_AGENT: '2000',
  },

    // Coverage configuration
    coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html'],
    reportsDirectory: './coverage',
      include: ['scripts/lib/**/*.js'],
      exclude: [
        'scripts/lib/config.js', // Configuration file, mostly data
      ],
    },

    // Timeout for slow tests
    testTimeout: 30000,

    // Retry flaky tests
    retry: 2,

    // Parallel execution
    poolOptions: {
      singleFork: true,
    },
  },
})
