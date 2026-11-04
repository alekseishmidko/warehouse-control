/** @file Vite: локальная SPA и same-origin proxy; Origin сохраняется для существующей CSRF policy API. */
import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
import tailwind from '@tailwindcss/vite';
/** Proxy target — server-only env без VITE_ prefix: DATABASE_URL не попадает в браузерный bundle. */
export default defineConfig({
  plugins: [solid(), tailwind()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.WEB_API_TARGET ?? 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        'src/api/client.ts': { lines: 95, statements: 90, branches: 90, functions: 90 },
        'src/commands/journal.ts': { lines: 95, statements: 95, branches: 95, functions: 100 },
      },
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/api/generated/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
    },
  },
});
