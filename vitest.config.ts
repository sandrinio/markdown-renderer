/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

/**
 * vitest.config.ts — test harness configuration (STORY-001-02)
 *
 * Choice: side-by-side vitest.config.ts (NOT inline test: block in vite.config.ts).
 * All subsequent stories (003, 004, 005) inherit this config automatically.
 *
 * environment: 'jsdom' — required for localStorage shim in storage.test.ts.
 * globals: false — explicit imports from vitest (vi, describe, it, expect).
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
