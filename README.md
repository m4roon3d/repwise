# Repwise — Personal BYOK AI Workout Coach (PWA)

<p align="center"><img src="branding/repwise-lockup.png" alt="Repwise" width="520" /></p>

A zero-backend, personal-use Progressive Web App (Vite + React) powered by your own **Gemini API key**.

## Guided setup & health-aware planning
- **Guided first-run setup:** name, training basics, a 7-question health check based on the PAR-Q+, injuries for 8 body areas (fine / old / sore now), then optional extras. Everything stays editable on the Coach tab, with a completeness bar.
- **Health-aware plans:** conditions (blood pressure, heart, diabetes, asthma, osteoporosis, arthritis, thyroid), beta-blockers, and pregnancy/postpartum stages cap effort, remove unsuitable exercises and add safety notes. Gemini plans are clamped to the same limits.
- **Fitness baseline:** push-ups, 30-second chair stand, plank, plus overhead-reach and squat-depth checks. Results set the starting effort; a retest prompt appears after each block, with your change since last time.
- **Blood report:** upload a photo or PDF (Gemini reads the values; only the numbers are kept) or type values in. 13 common markers are checked against typical ranges with plain-language notes. Not a diagnosis.
- **Why this plan:** every plan explains its schedule, goal focus, starting effort, what was left out and why, health and blood-report considerations, with one-tap follow-up questions to the coach.
- **Two people, one phone:** switch person from the header. Each person has their own profile, plans, logs and chat; the API key is shared by the device.

## Training log, progression and Ask Your Coach
- **68-exercise library:** now covers arms (curls, pushdowns), calves, push-ups, pull-ups, planks, hip thrusts, single-leg work and more hip/spine mobility, across all three equipment tiers.
- **Workout logging:** log weight and reps per set on any exercise card. Weights are stored in kg and shown in your unit; logs are included in backups.
- **Auto-progression (works offline):** double progression. Hit the top of the rep range on every set and the app suggests the next weight; fall well short or log a very hard session and it suggests backing off. Gemini plan generation also sees your recent logs.
- **Ask Your Coach (needs a Gemini key):** free-form questions grounded in your profile, plan and logs. Chat history is kept on the device.
- **Form coaching:** a *Form help* button on every exercise opens the coach focused on that lift, and you can attach up to 3 photos for a form check. Photos are resized in the browser, sent to Gemini with your question and never stored.

## What's New in v2
- **20 Parametric Animations for 68 Exercises:** Each exercise has a form animation (squat, hinge, curl, pushdown, calf raise, plank, push-up, pull-up and more), including bespoke silhouettes for **Glute Bridge**, **Bilateral Lateral Raise**, **Seated Hamstring Curl**, and **Anti-Rotation Pallof Press**, with Play/Pause, `0.5x` Slow-Mo, and phase scrubbing.
- **Conversational AI Coach Intake (`CoachIntakeChat.jsx`):** Chat naturally about sleep, aches, schedule, and preferences to auto-update your profile before generating a plan.
- **Deeper Vitals + Metric/Imperial Toggle:** Switch seamlessly between `cm / kg` and `ft-in / lbs`, with average sleep hours, stress level, and optional body-fat / BP context folded into readiness scoring.
- **Multi-Week Progressive Training Blocks (`1–4 Weeks`):** Generates structured multi-week progression (RPE, sets, and rep ramps) with Week tabs (`W1–W4`) and phase rules.
- **Custom Free-Text Swap & Adapt Prompts:** Type any ad-hoc constraint (*"Left wrist hurts"*, *"Only 15 min, upper body only"*) alongside one-tap quick chips.
- **Deploy-Ready for Cloudflare Pages & GitHub Pages:** Includes `.gitignore`, `public/_headers`, `.github/workflows/deploy-pages.yml`, and `DEPLOY_HANDOVER.md`.

## Quick Start
```bash
npm install
npm run dev
```
See `DEPLOY_HANDOVER.md` for one-step Cloudflare Pages and GitHub Pages deployment instructions.

## Credits
Exercise and background photos come from [free-exercise-db](https://github.com/yuhonas/free-exercise-db), released into the public domain (Unlicense). Photos are resized and stored in `public/photos` and `public/bg`.
