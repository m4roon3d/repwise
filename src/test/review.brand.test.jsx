/** Branding: the product is called Repwise everywhere users can see it, and the logo ships in every size. */
import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

const root = `${process.cwd()}/`;
const read = (f) => readFileSync(join(root, f), 'utf8');
const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (['node_modules', 'dist', '.git'].includes(f)) continue;
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};

describe('Repwise branding', () => {
  it('header shows the name and the logo mark', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Repwise' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Repwise logo/i })).toBeInTheDocument();
  });

  it('manifest, page title and install name all say Repwise', () => {
    const m = JSON.parse(read('public/manifest.json'));
    expect(m.short_name).toBe('Repwise');
    expect(m.name).toMatch(/^Repwise/);
    const html = read('index.html');
    expect(html).toMatch(/<title>Repwise/);
    expect(html).toMatch(/apple-mobile-web-app-title" content="Repwise"/);
  });

  it('no user-facing file still says MomentumFit (legacy cache names in the SW test are the only allowed mention)', () => {
    const offenders = walk(root)
      .filter((f) => /\.(jsx?|html|md|json|css|ya?ml|sh)$/.test(f) && !/package-lock/.test(f))
      .filter((f) => /momentumfit/i.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(root, ''))
      .filter((f) => !/review\.hardening\.test\.js$|review\.brand\.test\.jsx$/.test(f));
    expect(offenders).toEqual([]);
  });

  it('keeps the old localStorage keys so existing data survives the rename', () => {
    const storage = read('src/services/storage.js');
    for (const k of ['mf_profile_v1', 'mf_active_plan_v1', 'mf_workout_logs_v1', 'mf_byok_gemini_api_key']) expect(storage).toContain(k);
  });

  it('logo source has a scalable mark group and every PNG size is generated from it', () => {
    expect(read('public/icon.svg')).toContain('<g id="mark">');
    const png = (f) => {
      const b = readFileSync(join(root, 'public', f));
      expect(b.subarray(1, 4).toString()).toBe('PNG');
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    expect(png('icon-192.png')).toEqual([192, 192]);
    expect(png('icon-512.png')).toEqual([512, 512]);
    expect(png('icon-maskable-512.png')).toEqual([512, 512]);
    expect(png('apple-touch-icon.png')).toEqual([180, 180]);
  });
});
