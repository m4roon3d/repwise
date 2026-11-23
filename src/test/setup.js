import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Some suites run in the node environment (see `@vitest-environment` docblocks) where there is no DOM.
const hasDom = typeof window !== 'undefined';
const { cleanup } = hasDom ? await import('@testing-library/react') : {};

afterEach(() => {
  if (!hasDom) return;
  cleanup();
  localStorage.clear();
});
