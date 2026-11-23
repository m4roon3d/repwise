// @vitest-environment node
/**
 * Security headers and service worker behaviour (node env: imports vite.config.js).
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { CSP } from '../../vite.config.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/* ---------------------------------------------------------------- CSP */
describe('Content-Security-Policy', () => {
  const headers = read('public/_headers');
  const headerCsp = headers.match(/Content-Security-Policy:\s*(.+)/)[1].trim();
  const directives = (csp) => Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

  it('is present in public/_headers and identical to the <meta> policy injected at build time', () => {
    expect(directives(headerCsp)).toEqual(directives(`${CSP}; frame-ancestors 'none'`));
  });

  it('only allows scripts from self and API calls to Gemini', () => {
    const d = directives(headerCsp);
    expect(d['script-src']).toEqual(["'self'"]);
    expect(d['connect-src']).toEqual(["'self'", 'https://generativelanguage.googleapis.com']);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(headerCsp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|\*/);
  });

  it('index.html has no inline scripts that the policy would block', () => {
    const html = read('index.html');
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) && body.trim());
    expect(inline).toEqual([]);
  });

  it('hashed assets are cached immutably but the service worker is never cached', () => {
    expect(headers).toMatch(/\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
    expect(headers).toMatch(/\/sw\.js\s+Cache-Control: no-cache/);
  });
});

/* ------------------------------------------------------ service worker */
function loadSw({ online = true, cacheEntries = {} } = {}) {
  const listeners = {};
  const stores = new Map( // cacheName -> Map(url -> Response)
    Object.entries(cacheEntries).map(([name, entries]) => [name, new Map(Object.entries(entries).map(([u, r]) => [new URL(u, 'https://app.test/').href, r]))])
  );
  const store = (name) => stores.get(name) || stores.set(name, new Map()).get(name);
  const keyOf = (r, opts) => {
    const u = new URL(typeof r === 'string' ? new URL(r, 'https://app.test/').href : r.url);
    if (opts?.ignoreSearch) u.search = '';
    return u.href;
  };
  const absolute = (r) => keyOf(r);
  const caches = {
    open: async (name) => ({
      addAll: async (urls) => urls.forEach((u) => store(name).set(absolute(u), new Response('shell'))),
      put: async (req, res) => void store(name).set(absolute(req), res),
    }),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (req, opts) => {
      const want = keyOf(req, opts);
      for (const m of stores.values()) {
        for (const [k, v] of m) if (keyOf(k, opts) === want) return v.clone();
      }
      return undefined;
    },
  };
  const fetchMock = vi.fn(async (req) => {
    if (!online) throw new TypeError('offline');
    return new Response(`net:${req.url}`, { status: 200 });
  });
  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (t, fn) => (listeners[t] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}) },
  };
  const src = read('public/sw.js').replaceAll('__BUILD_ID__', 'test');
  vm.runInNewContext(src, { self, caches, fetch: fetchMock, Response, URL, Promise, console });
  const dispatch = async (type, extra = {}) => {
    let p;
    const waits = [];
    listeners[type]({ ...extra, respondWith: (x) => (p = x), waitUntil: (x) => waits.push(x) });
    const res = await p;
    await Promise.all(waits);
    return res;
  };
  return { stores, fetchMock, self, listeners, dispatch, caches };
}
const req = (url, o = {}) => ({ url: `https://app.test${url}`, method: 'GET', mode: 'no-cors', ...o });

describe('service worker', () => {
  it('precaches the shell on install and evicts old caches on activate', async () => {
    const sw = loadSw({ cacheEntries: { 'momentumfit-v1': { '/old.js': new Response('x') } } });
    const waits = [];
    sw.listeners.install({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
    const shell = read('public/sw.js').match(/APP_SHELL = \[([^\]]+)\]/)[1].match(/'[^']+'/g);
    expect(sw.stores.get('repwise-test').size).toBe(shell.length);
    sw.stores.set('momentumfit-v1', new Map());
    const aw = [];
    sw.listeners.activate({ waitUntil: (p) => aw.push(p) });
    await Promise.all(aw);
    expect([...sw.stores.keys()]).toEqual(['repwise-test']);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it('does not intercept cross-origin (Gemini) or non-GET requests', () => {
    const sw = loadSw();
    for (const r of [{ url: 'https://generativelanguage.googleapis.com/v1/x', method: 'POST' }, req('/api', { method: 'POST' }), { url: 'https://other.test/a.js', method: 'GET' }]) {
      const respondWith = vi.fn();
      sw.listeners.fetch({ request: r, respondWith, waitUntil: () => {} });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });

  it('navigations: network first, so a new deploy is picked up immediately', async () => {
    const sw = loadSw({ cacheEntries: { 'repwise-test': { '/index.html': new Response('OLD') } } });
    const res = await sw.dispatch('fetch', { request: req('/index.html', { mode: 'navigate' }) });
    expect(await res.text()).toContain('net:');
  });

  it('navigations offline: falls back to the cached shell, even with a query string', async () => {
    const sw = loadSw({ online: false, cacheEntries: { 'repwise-test': { '/index.html': new Response('SHELL'), '/': new Response('SHELL') } } });
    const res = await sw.dispatch('fetch', { request: req('/?utm_source=x', { mode: 'navigate' }) });
    expect(await res.text()).toBe('SHELL');
  });

  it('never resolves respondWith with undefined when offline and nothing is cached', async () => {
    const sw = loadSw({ online: false });
    const res = await sw.dispatch('fetch', { request: req('/assets/new.js') });
    expect(res).toBeInstanceOf(Response);
    const nav = await sw.dispatch('fetch', { request: req('/anything', { mode: 'navigate' }) });
    expect(nav).toBeInstanceOf(Response);
  });

  it('assets: served from cache instantly and refreshed in the background', async () => {
    const sw = loadSw({ cacheEntries: { 'repwise-test': { '/assets/app.js': new Response('CACHED') } } });
    const res = await sw.dispatch('fetch', { request: req('/assets/app.js') });
    expect(await res.text()).toBe('CACHED');
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
    expect(await (await sw.caches.match(req('/assets/app.js'))).text()).toContain('net:');
  });
});


/* ------------------------------------------------------------- PWA icons */
describe('PWA icons', () => {
  const manifest = JSON.parse(read('public/manifest.json'));
  const pngSize = (file) => {
    const b = readFileSync(new URL(`../../public/${file}`, import.meta.url));
    expect(b.subarray(1, 4).toString()).toBe('PNG');
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  const fileOf = (src) => src.replace(/^\.\//, '');

  it('manifest has real 192 and 512 PNGs plus a separate maskable icon (installable on Android)', () => {
    const png = manifest.icons.filter((i) => i.type === 'image/png');
    expect(png.some((i) => i.sizes === '192x192' && i.purpose === 'any')).toBe(true);
    expect(png.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
    expect(png.some((i) => i.purpose === 'maskable')).toBe(true);
    // maskable and "any" must not be combined in one entry
    expect(manifest.icons.some((i) => /any\s+maskable|maskable\s+any/.test(i.purpose || ''))).toBe(false);
  });

  it('every declared PNG exists and has exactly the declared dimensions', () => {
    for (const i of manifest.icons.filter((i) => i.type === 'image/png')) {
      const [w, h] = i.sizes.split('x').map(Number);
      expect(pngSize(fileOf(i.src)), i.src).toEqual([w, h]);
    }
  });

  it('iOS gets a 180x180 PNG apple-touch-icon (iOS ignores SVG)', () => {
    const href = read('index.html').match(/rel="apple-touch-icon" href="([^"]+)"/)[1];
    expect(href.endsWith('.png')).toBe(true);
    expect(pngSize(fileOf(href))).toEqual([180, 180]);
  });

  it('every file in the service worker app shell exists', () => {
    const list = read('public/sw.js').match(/APP_SHELL = \[([^\]]+)\]/)[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
    for (const f of list.filter((f) => f !== './' && f !== './index.html')) expect(() => readFileSync(new URL(`../../public/${fileOf(f)}`, import.meta.url)), f).not.toThrow();
  });
});
