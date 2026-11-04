/** @file Изоляция component tests: DOM и browser state очищаются после каждого случая, без fallback к живому API. */
import { afterEach, vi } from 'vitest';
import { cleanup } from '@solidjs/testing-library';
// jsdom не реализует viewport scroll; в component tests это только DOM navigation, real scroll проверяет Chromium.
Object.defineProperty(window, 'scrollTo', { configurable: true, value: () => {} });
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
