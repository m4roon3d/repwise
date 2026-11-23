import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import ExerciseAnimator from '../components/ExerciseAnimator';

let observers;
let rafCalls;

beforeEach(() => {
  observers = [];
  rafCalls = 0;
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    rafCalls += 1;
    return setTimeout(() => cb(performance.now()), 0);
  });
  vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
});
afterEach(() => {
  cleanup(); // unmount (and cancel frames) BEFORE the rAF stubs are removed
  delete globalThis.IntersectionObserver;
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

const tick = (ms = 20) => act(() => new Promise((r) => setTimeout(r, ms)));
const setVisible = (isIntersecting) => act(() => observers.forEach((o) => o.cb([{ isIntersecting }])));

describe('ExerciseAnimator — battery & accessibility', () => {
  it('animates while on screen, stops requesting frames when scrolled away, resumes when back', async () => {
    render(<ExerciseAnimator animationKey="squat" />);
    await tick();
    expect(rafCalls).toBeGreaterThan(1);

    await setVisible(false);
    await tick();
    const frozen = rafCalls;
    await tick(40);
    expect(rafCalls).toBe(frozen); // no more frames while off-screen

    await setVisible(true);
    await tick(40);
    expect(rafCalls).toBeGreaterThan(frozen);
  });

  it('pauses when the browser tab is hidden and resumes when it returns', async () => {
    render(<ExerciseAnimator animationKey="squat" />);
    await tick();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    await tick();
    const frozen = rafCalls;
    await tick(40);
    expect(rafCalls).toBe(frozen);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    await tick(40);
    expect(rafCalls).toBeGreaterThan(frozen);
  });

  it('starts paused when the OS asks for reduced motion (and Play still works)', async () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    render(<ExerciseAnimator animationKey="squat" />);
    expect(screen.getByRole('button', { name: 'Play animation' })).toBeInTheDocument();
    await tick(40);
    expect(rafCalls).toBe(0);
    await act(async () => screen.getByRole('button', { name: 'Play animation' }).click());
    await tick(40);
    expect(rafCalls).toBeGreaterThan(0);
  });

  it('plays by default when no reduced-motion preference is set', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    render(<ExerciseAnimator animationKey="squat" />);
    expect(screen.getByRole('button', { name: 'Pause animation' })).toBeInTheDocument();
  });

  it('cleans up its observer and listeners on unmount', () => {
    const { unmount } = render(<ExerciseAnimator animationKey="squat" />);
    unmount();
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });
});
