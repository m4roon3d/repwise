import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same policy as public/_headers, injected as <meta> for hosts without custom headers (GitHub Pages).
// Production builds only: the dev server needs inline scripts for hot reload.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://generativelanguage.googleapis.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const buildId = Date.now().toString(36);
const buildDate = new Date().toISOString();

function productionHardening() {
  let outDir = 'dist';
  return {
    name: 'repwise-production-hardening',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`
      );
    },
    closeBundle() {
      const sw = `${outDir}/sw.js`;
      if (existsSync(sw)) writeFileSync(sw, readFileSync(sw, 'utf8').replaceAll('__BUILD_ID__', buildId));
    },
  };
}

export default defineConfig({
  plugins: [react(), productionHardening()],
  base: './',
  define: { __APP_BUILD__: JSON.stringify({ id: buildId, date: buildDate }) },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // CI runners are several times slower than a laptop; UI tests that render the animator need headroom.
    testTimeout: 15000,
  },
});
