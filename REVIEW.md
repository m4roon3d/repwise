# Repwise — code review & test notes

Test suite: `npm test` → 292 tests across 26 files.

Housekeeping (Nov 2026): removed the retired stick-figure animator (`ExerciseAnimator`, `animations.js`, `animation_key`), the old `Logo` component, unused icons, watermark figures and dead CSS. All Gemini calls now go through `getAI(key, feature)`, which records token usage and timing (`services/usage.js`) for the Diagnostics screen.
`it.fails(...)` = a **confirmed bug**; the assertion states the correct behaviour. When you fix a bug the test
turns red ("expected to fail") → just delete the `.fails`.

## Confirmed bugs (each has a test)
| # | Area | Bug |
|---|------|-----|
| 1 | App.jsx | ✅ FIXED — **Lost-update race**: swap/adapt build the new plan from the `plan` captured at click time, then `await` Gemini. Two swaps in flight → the second overwrites the first. Use `setPlan(prev => …)`. |
| 2 | storage.js / App.jsx | ✅ FIXED — `loadApiKey`/`loadModel` call `localStorage` unguarded inside `useState` initialisers → blank page if storage is blocked. All `setItem` calls unguarded → QuotaExceeded/private mode throws from handlers. |
| 3 | catalogFilter.js | ✅ FIXED — `Number(weeksAway) \|\| 4` treats **0 as 4** → readiness 80 (vs 84 for 1 week off) and wrong RPE advice. Same pattern for other `\|\| default` fallbacks. |
| 4 | geminiCoach.js (local intake) | ✅ FIXED — Substring matching: "getting **back** into the gym" flags lower-back (removes ~6 exercises); "10 days" → 2 d/wk (single-digit regex); "come **home** late" → home gym. |
| 5 | geminiCoach.js (Gemini path) | ✅ FIXED — Shape of model output not enforced: fewer `week_progressions` than requested silently shrinks the block; `base_days` count ≠ `daysPerWeek` is accepted; a day whose IDs were all hallucinated ships with **0 exercises**; inverted rep ranges (12–8) survive. |
| 6 | storage.js import | ✅ FIXED — Backup with unusable `activePlan` → `savePlan(null)` wipes current plan. Profile fields not type-checked (string age → NaN downstream). |
| 7 | Local `adaptSingleDay` | ✅ FIXED — Unparseable constraints ("upper body only" — the UI's own placeholder) are ignored but banner says "Adapted locally for…". |
| 8 | exercises.json | ✅ FIXED — 6 exercises have `regression_id === id`; 3 regressions need more equipment than the original; only **1 carry exercise per tier** (local engine asks for carry on days 2/4/5 → repeats). `regression_id` isn't used by the UI at all. |
| 9 | AssessmentForm | ✅ FIXED — 13 inputs/selects have no accessible name (labels lack `htmlFor`/`id`). |

## Improvements
- ✅ **Safety**: "Before you start" notice (acknowledged once, then a one-line reminder on the Coach and Workout tabs).
- ✅ **Security**: Content-Security-Policy in `public/_headers` and injected as `<meta>` at build time (GitHub Pages has no custom headers); `connect-src` limited to self + `generativelanguage.googleapis.com`. Verified in real Chrome: no violations. Also `Permissions-Policy` and immutable caching for `/assets/*`.
- ✅ **PWA service worker**: cache name stamped per build (old caches evicted), network-first navigations, offline fallback to the cached shell (also with query strings), never resolves `respondWith(undefined)`, ignores non-GET.
- ✅ **PWA icons**: 192/512 PNG, separate maskable icon and a 180 px apple-touch-icon (regenerate with `scripts/make-icons.sh`).
- ✅ **Perf**: `@google/genai` is now loaded with `import()` only on the first Gemini call → main bundle 616 kB → 337 kB (gzip 155 → 103).✅ Animations now pause when off-screen, when the tab is hidden, and under `prefers-reduced-motion`.
- ✅ **Reproducibility**: `package-lock.json` included; CI uses `npm ci`.
- ✅ **Product**: swaps have an "Apply to all weeks" option (on by default; each week keeps its own sets/reps/RPE progression, and weeks you already changed by hand are left alone). Gemini is retried once when a reply is empty, malformed or has no usable exercises (network/quota errors and token cut-offs are not retried).
- ⏳ Still open: regenerating a plan discards swaps.
- ✅ **Structure**: `geminiCoach.js` split into `coach/{schemas,validate,prompts,localEngine}.js` (public API unchanged).
- ✅ Concurrent swaps on the same day no longer pick the same replacement.

## Generalisation (no longer a "comeback-only" app)
- New `experience` setting (beginner / intermediate / advanced) drives Week-1 starting RPE (`startingRpe`) and is sent to Gemini; low energy, poor sleep or a long layoff still ease it.
- `weeksAway` stays but is now an ordinary optional input: "Weeks Since Last Trained (0 = training now)".
- New default goal `general_fitness`; neutral defaults (age 30, 75 kg, 0 weeks off, beginner).
- All copy, prompts, schema and week labels are neutral. Plan field `comeback_strategy` → `program_strategy`; old saved plans / backups / model replies using the old name still load (tested).
- A test fails if "comeback" / "re-entry" wording creeps back into user-facing files.

## Coach features added after the review
- ✅ Workout logging (`services/storage.js`, `components/LogSets.jsx`), kg-canonical, sanitised on load/import, capped at 800 entries.
- ✅ Deterministic double-progression suggestions (`services/progress.js`); log summary is passed into plan generation.
- ✅ Ask Your Coach tab (`components/AskCoach.jsx`, `askCoach()` in `geminiCoach.js`): context-grounded, safety-framed, replies survive tab switches, failed questions restore the draft.
- ✅ Form coaching: *Form help* shortcut + photo form check (`services/images.js` downsizes to ≤1280 px JPEG; pixels are never persisted).
- Verified in real Chrome with a mocked Gemini endpoint: no CSP violations, 270 KB photo sent as a 128 KB JPEG.
- ⏳ Not built: charts/history screen for logs, rest timer.

## Library expansion (38 → 68 exercises)
- ✅ 30 new exercises incl. two new categories, `arms` and `calves`, and six new animations (curl, pushdown, calf raise, plank, push-up, pull-up) with two new equipment props.
- ✅ `review.library.test.js` guards record shape, per-tier coverage, regression chains and animation geometry (bone lengths, mirroring, floor contact). It caught a stretched forearm while authoring.
- Note: the offline (no-key) engine still builds sessions from the original 10 patterns, so arms and calves appear in Gemini plans, swaps and the Exercises tab, not in keyless plans.
- Note: a few new mobility moves and the 90/90 / thread-the-needle style stretches reuse the generic mobility animation.

## Onboarding & health journey
- ✅ `services/health.js` (PAR-Q+ style screening, conditions, injuries, pregnancy, RPE caps, exclusions), `labs.js` (13 markers, unit conversion, sex-specific ranges), `baseline.js` (fitness tests), `rationale.js` (Why this plan).
- ✅ Caps are enforced on every plan, swap and adapt result, whichever engine produced them.
- ✅ Per-person storage: first person keeps the original keys (no migration); others are namespaced `mf_p_<id>__…`.
- Verified in real Chrome at 390 px with a mocked Gemini endpoint: full setup, plan with reasons, PDF report extraction, no console errors.
