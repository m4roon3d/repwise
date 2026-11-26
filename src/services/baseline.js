// Short fitness self-tests that replace "beginner / intermediate" guesswork, and give a baseline to retest.
// Bands are deliberately coarse, adult general-population cut-offs; they set a starting point, not a grade.

export const BASELINE_TESTS = [
  {
    id: 'pushups',
    name: 'Push-ups',
    how: 'As many good push-ups as you can in a row. Chest to a fist-height, body straight. Stop when form breaks. Knee push-ups count if that is where you are.',
    unit: 'reps',
    max: 150,
  },
  {
    id: 'sitToStand',
    name: '30-second chair stand',
    how: 'Arms crossed, sit and stand up fully from a chair as many times as you can in 30 seconds.',
    unit: 'reps',
    max: 60,
  },
  {
    id: 'plankSec',
    name: 'Forearm plank',
    how: 'Hold a straight-line forearm plank. Stop when your hips sag or lift.',
    unit: 'seconds',
    max: 600,
  },
];

export const MOBILITY_CHECKS = [
  { id: 'overheadReach', question: 'Standing with your back against a wall, can you raise both straight arms overhead until your thumbs touch the wall, without your lower back arching off it?' },
  { id: 'deepSquat', question: 'Can you squat until your thighs are level with the floor, heels down, without holding on to anything?' },
];

const band = (v, lo, hi) => (v == null ? null : v < lo ? 1 : v < hi ? 2 : 3);

/** 1 = needs work, 2 = average, 3 = good, per test; null when not done. */
export function scoreBaseline(test, age = 30) {
  if (!test) return null;
  const knee = test.pushupType === 'knee';
  const pushups = test.pushups == null ? null : knee ? Math.min(2, band(test.pushups, 10, 20)) : band(test.pushups, 10, 25);
  const older = Number(age) >= 60;
  const sitToStand = band(test.sitToStand, older ? 12 : 15, older ? 17 : 22);
  const plank = band(test.plankSec, 30, 90);
  const scores = [pushups, sitToStand, plank].filter((s) => s != null);
  const overall = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return {
    pushups,
    sitToStand,
    plank,
    overall,
    level: overall == null ? null : overall < 1.7 ? 'foundation' : overall < 2.5 ? 'developing' : 'strong',
  };
}

export const LEVEL_LABEL = { foundation: 'Building the base', developing: 'Solid foundation', strong: 'Strong base' };

/** Starting-RPE nudge from the latest test: weaker baselines start easier. */
export function baselineRpeDelta(test, age) {
  const s = scoreBaseline(test, age);
  if (!s?.level) return 0;
  return s.level === 'foundation' ? -0.5 : 0;
}

export function sanitizeBaselines(raw) {
  if (!Array.isArray(raw)) return [];
  const num = (v, max) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 ? Math.min(max, n) : null;
  };
  return raw
    .filter((t) => t && Number.isFinite(Number(t.ts)))
    .map((t) => ({
      ts: Number(t.ts),
      pushups: num(t.pushups, 150),
      pushupType: t.pushupType === 'knee' ? 'knee' : 'standard',
      sitToStand: num(t.sitToStand, 60),
      plankSec: num(t.plankSec, 600),
      overheadReach: typeof t.overheadReach === 'boolean' ? t.overheadReach : null,
      deepSquat: typeof t.deepSquat === 'boolean' ? t.deepSquat : null,
    }))
    .filter((t) => t.pushups != null || t.sitToStand != null || t.plankSec != null || t.overheadReach != null || t.deepSquat != null)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 12);
}

export const latestBaseline = (profile) => (profile?.baselines || [])[0] || null;

/** True when the newest test is older than one training block (or 4 weeks). */
export function retestDue(profile, now = Date.now()) {
  const t = latestBaseline(profile);
  if (!t) return false;
  const weeks = Math.max(2, Number(profile.programWeeks) || 4);
  return now - t.ts > weeks * 7 * 86400000;
}

/** Change from the previous test, e.g. { pushups: +4, sitToStand: +2, plankSec: -5 }. */
export function baselineDelta(profile) {
  const [a, b] = profile?.baselines || [];
  if (!a || !b) return null;
  const d = {};
  for (const k of ['pushups', 'sitToStand', 'plankSec']) if (a[k] != null && b[k] != null) d[k] = a[k] - b[k];
  return Object.keys(d).length ? d : null;
}

export function describeBaselineForPrompt(profile) {
  const t = latestBaseline(profile);
  if (!t) return 'Not tested';
  const s = scoreBaseline(t, profile.age);
  const parts = [];
  if (t.pushups != null) parts.push(`${t.pushups} ${t.pushupType === 'knee' ? 'knee ' : ''}push-ups`);
  if (t.sitToStand != null) parts.push(`${t.sitToStand} chair stands/30s`);
  if (t.plankSec != null) parts.push(`${t.plankSec}s plank`);
  if (t.overheadReach === false) parts.push('limited overhead reach');
  if (t.deepSquat === false) parts.push('cannot yet squat to parallel');
  return `${parts.join(', ')}${s?.level ? ` → ${LEVEL_LABEL[s.level]}` : ''}`;
}
