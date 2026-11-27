// @vitest-environment node
/** Every exercise has a real start/finish photo pair shipped with the app, and the background scenes exist. */
import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import exercises from '../data/exercises.json';

const pub = (p) => `${process.cwd()}/public/${p}`;

describe('exercise photos', () => {
  it('every exercise links to two photos that exist and are a sensible size', () => {
    for (const e of exercises) {
      expect(e.photo, e.id).toMatch(/^[A-Za-z0-9_\-]+$/);
      for (const f of [0, 1]) {
        const file = pub(`photos/${e.photo}/${f}.jpg`);
        expect(existsSync(file), file).toBe(true);
        const kb = statSync(file).size / 1024;
        expect(kb, file).toBeGreaterThan(5);
        expect(kb, file).toBeLessThan(150);
      }
    }
  });
});

describe('page photos', () => {
  it('each tab has its photo', () => {
    for (const t of ['assess', 'routine', 'ask', 'health', 'progress', 'library']) expect(existsSync(pub(`bg/${t}.jpg`))).toBe(true);
  });
});
