# Repwise BYOK PWA — Deployment Handover (for Claude / GitHub / Cloudflare)

## Project Summary
- **Stack:** Vite 6 + React 19 static Progressive Web App (zero backend, zero database server).
- **AI Engine:** Direct client-side `@google/genai` SDK (BYOK — user pastes their own Google AI Studio key in the in-app Settings modal; stored only in browser `localStorage`, never committed to Git).
- **Base Path:** `vite.config.js` sets `base: './'`, so the exact same `dist/` build works on both **Cloudflare Pages** (root domain) and **GitHub Pages** (repo subpath `/<repo-name>/`) with zero config edits.

## Local Build Verification
```bash
npm install
npm test
npm run build
npm run preview
```
Output directory: `dist/`

---

## Option A: Deploy to Cloudflare Pages (Recommended for Private/Fast Hosting)
1. Push this directory to a **private** GitHub repository (`main` branch).
2. In **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**, select the repo.
3. Configure build settings:
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Environment variables:** None required (BYOK key is entered inside the app on the user's device).
4. `public/_headers` is already included to enforce security headers and prevent stale service-worker caching.
5. *(Direct CLI alternative via Wrangler)*:
   ```bash
   npm run build
   npx wrangler pages deploy dist --project-name=repwise
   ```

## Option B: Deploy to GitHub Pages (Automated via Included Workflow)
1. Push this directory to a GitHub repository (`main` branch). Note: GitHub Pages on private repos requires GitHub Pro/Team; otherwise Cloudflare Pages is free for private repos.
2. In GitHub **Repository Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**.
3. The included `.github/workflows/deploy-pages.yml` automatically runs `npm install && npm run build` and deploys `./dist` on every push to `main` (works cleanly even on the first push before a `package-lock.json` exists).

---

## Post-Deploy Checklist
1. Open the deployed URL on your phone (Chrome on Android → Menu → **Add to Home screen**; Safari on iOS → Share → **Add to Home Screen**).
2. Tap **Add Gemini Key** in the top-right header, paste your Google AI Studio key, and click **Test Connection**.
3. *(Optional Key Hardening)* In Google Cloud Console → APIs & Services → Credentials, restrict the API key by **HTTP referrer** to your deployed `*.pages.dev` or `*.github.io` URL.
