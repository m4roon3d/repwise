import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';

// Some suites run in the node environment (see `@vitest-environment` docblocks) where there is no DOM.
const hasDom = typeof window !== 'undefined';
const { cleanup } = hasDom ? await import('@testing-library/react') : {};

afterEach(() => {
  if (!hasDom) return;
  cleanup();
  localStorage.clear();
});

// Most suites test the full profile form, so start as an already-onboarded user.
// Onboarding tests remove this flag to see the guided setup.
beforeEach(() => {
  if (hasDom) localStorage.setItem('mf_onboarded_v1', '1');
});
