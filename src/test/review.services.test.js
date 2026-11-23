/**
 * Review-driven tests for the service layer.
 *
 * Conventions
 *  - `it(...)`        guards behaviour that is correct today (regression protection).
 *  - `it.fails(...)`  documents a CONFIRMED BUG. The assertion states the correct behaviour;
 *                     vitest treats "assertion fails" as a pass. Once you fix the bug the test
 *                     flips to red with "expected to fail" -> just delete the `.fails`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import exercises from '../data/exercises.json';
import { computeReadinessMetrics, filterSafeExercises } from '../services/catalogFilter';
import { DEFAULT_PROFILE } from '../services/storage';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', INTEGER: 'INTEGER', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));

import {
  adaptSingleDay,
  enforceWeeklyVariety,
  generateAdaptivePlan,
  parseGeminiJson,
  resolveSwapConflict,
  runCoachIntakeTurn,
  swapExercise,
} from '../services/geminiCoach';

const TIERS = ['commercial_gym', 'apartment_gym', 'home_setup'];
const JOINTS = ['knee', 'shoulder', 'lower_back'];
const ex = (id, over = {}) => ({
  exercise_id: id, sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 75, coach_note: 'n', ...over,
});
const geminiReply = (obj) => ({ candidates: [{ finishReason: 'STOP' }], text: JSON.stringify(obj) });

beforeEach(() => mockGenerateContent.mockReset());

/* ------------------------------------------------------------------ */
describe('Local engine — property sweep over every profile combination', () => {
  const combos = [];
  for (const tier of TIERS)
    for (const joints of [[], ['knee'], ['shoulder'], ['lower_back'], JOINTS])
      for (const daysPerWeek of [2, 3, 4, 5])
        for (const sessionMinutes of [25, 45, 60])
          combos.push({ tier, joints, daysPerWeek, sessionMinutes });

  it(`produces valid, joint-safe, tier-correct plans for all ${combos.length} combinations`, async () => {
    for (const { tier, joints, daysPerWeek, sessionMinutes } of combos) {
      const profile = {
        ...DEFAULT_PROFILE,
        equipmentTier: tier,
        daysPerWeek,
        sessionMinutes,
        programWeeks: 4,
        jointFlags: { knee: false, shoulder: false, lower_back: false, ...Object.fromEntries(joints.map((j) => [j, true])) },
      };
      const safe = filterSafeExercises(profile);
      const safeIds = new Set(safe.map((e) => e.id));
      const plan = await generateAdaptivePlan(profile, safe, '', 'm');
      const label = `${tier}/${joints.join('+') || 'none'}/${daysPerWeek}d/${sessionMinutes}m`;

      expect(plan.weeks, label).toHaveLength(4);
      for (const wk of plan.weeks) {
        expect(wk.days, label).toHaveLength(daysPerWeek);
        for (const day of wk.days) {
          const ids = day.exercises.map((e) => e.exercise_id);
          expect(ids.length, `${label} exercise count`).toBeGreaterThanOrEqual(4);
          expect(new Set(ids).size, `${label} dup in day`).toBe(ids.length);
          for (const item of day.exercises) {
            expect(safeIds.has(item.exercise_id), `${label} unsafe id ${item.exercise_id}`).toBe(true);
            expect(item.rep_max, label).toBeGreaterThan(item.rep_min);
            expect(item.target_rpe, label).toBeGreaterThanOrEqual(5.5);
            expect(item.target_rpe, label).toBeLessThanOrEqual(9);
            expect(item.sets, label).toBeGreaterThanOrEqual(1);
            expect(item.sets, label).toBeLessThanOrEqual(5);
          }
        }
      }
    }
  });

  it('day_ids are unique across the whole plan (RoutineView uses them as React keys / warm-up state)', async () => {
    const plan = await generateAdaptivePlan(DEFAULT_PROFILE, filterSafeExercises(DEFAULT_PROFILE), '', 'm');
    const all = plan.weeks.flatMap((w) => w.days.map((d) => d.day_id));
    expect(new Set(all).size).toBe(all.length);
  });

  it('a 1-week block yields exactly one week', async () => {
    const p = { ...DEFAULT_PROFILE, programWeeks: 1 };
    const plan = await generateAdaptivePlan(p, filterSafeExercises(p), '', 'm');
    expect(plan.weeks).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
describe('parseGeminiJson', () => {
  it('parses plain, fenced and prose-wrapped JSON', () => {
    expect(parseGeminiJson({ text: '{"a":1}' })).toEqual({ a: 1 });
    expect(parseGeminiJson({ text: '```json\n{"a":1}\n```' })).toEqual({ a: 1 });
    expect(parseGeminiJson({ text: 'Sure! Here you go: {"a":1} hope that helps' })).toEqual({ a: 1 });
  });

  it('gives actionable errors for empty / blocked / truncated / garbage responses', () => {
    expect(() => parseGeminiJson({ candidates: [{ finishReason: 'MAX_TOKENS' }], text: '' })).toThrow(/token limit/i);
    expect(() => parseGeminiJson({ candidates: [{ finishReason: 'SAFETY' }], text: '' })).toThrow(/SAFETY/);
    expect(() => parseGeminiJson({ text: 'not json at all' })).toThrow(/parse/i);
    expect(() => parseGeminiJson(undefined)).toThrow(/empty/i);
  });
});

/* ------------------------------------------------------------------ */
describe('enforceWeeklyVariety — sanitising model output', () => {
  const safe = filterSafeExercises(DEFAULT_PROFILE);

  it('clamps sets / RPE / rest into sane ranges and coerces junk numbers', () => {
    const [d] = enforceWeeklyVariety(
      [{ exercises: [ex('goblet_squat', { sets: 99, target_rpe: 12, rest_seconds: 5 }), ex('leg_press', { sets: 'x', target_rpe: null })] }],
      safe
    );
    expect(d.exercises[0]).toMatchObject({ sets: 5, target_rpe: 9, rest_seconds: 30 });
    expect(d.exercises[1]).toMatchObject({ sets: 3, target_rpe: 7 });
  });

  it('drops hallucinated ids and ids that were filtered out for joint safety', () => {
    const kneeSafe = filterSafeExercises({ ...DEFAULT_PROFILE, jointFlags: { knee: true, shoulder: false, lower_back: false } });
    const kneeUnsafe = exercises.find((e) => e.joint_stress_flags.includes('knee') && e.equipment_tiers.includes('commercial_gym'));
    const [d] = enforceWeeklyVariety([{ exercises: [ex('nope'), ex(kneeUnsafe.id), ex('goblet_squat')] }], kneeSafe);
    expect(d.exercises.map((e) => e.exercise_id)).toEqual(['goblet_squat']);
  });

  it('tolerates missing / null input without throwing', () => {
    expect(enforceWeeklyVariety(undefined, safe)).toEqual([]);
    expect(enforceWeeklyVariety([{}], safe)[0].exercises).toEqual([]);
  });

  // BUG: rep_min/rep_max are clamped independently, so an inverted range from the model survives.
  it('never emits an inverted rep range (rep_max >= rep_min)', () => {
    const [d] = enforceWeeklyVariety([{ exercises: [ex('goblet_squat', { rep_min: 12, rep_max: 8 })] }], safe);
    expect(d.exercises[0].rep_max).toBeGreaterThanOrEqual(d.exercises[0].rep_min);
  });
});

/* ------------------------------------------------------------------ */
describe('generateAdaptivePlan with Gemini — validating the *shape* of the response', () => {
  const profile = { ...DEFAULT_PROFILE, daysPerWeek: 3, programWeeks: 4 };
  const safe = filterSafeExercises(profile);
  const day = (n, ids) => ({
    day_id: `d${n}`, day_label: `Day ${n}`, focus: 'f', estimated_minutes: 40, warmup_checklist: ['a'],
    exercises: ids.map((i) => ex(i)),
  });
  const prog = (n) => ({ week_number: n, week_label: `W${n}`, phase_focus: 'p', progression_rule: 'r', rpe_delta: 0, set_delta: 0, rep_delta: 0 });
  const base = (over) => geminiReply({
    program_title: 't', coach_summary: 's', program_strategy: 'c', weekly_progression_tip: 'w',
    base_days: [day(1, ['goblet_squat']), day(2, ['leg_press']), day(3, ['lat_pulldown_neutral'])],
    week_progressions: [prog(1), prog(2), prog(3), prog(4)],
    ...over,
  });

  it('happy path: expands to programWeeks x days', async () => {
    mockGenerateContent.mockResolvedValueOnce(base());
    const plan = await generateAdaptivePlan(profile, safe, 'k', 'm');
    expect(plan.weeks).toHaveLength(4);
    expect(plan.weeks[0].days).toHaveLength(3);
  });

  it('clamps wild progression deltas from the model', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      base({ week_progressions: [prog(1), { ...prog(2), rpe_delta: 50, set_delta: 9, rep_delta: 99 }, prog(3), prog(4)] })
    );
    const plan = await generateAdaptivePlan(profile, safe, 'k', 'm');
    for (const item of plan.weeks[1].days[0].exercises) {
      expect(item.target_rpe).toBeLessThanOrEqual(9);
      expect(item.sets).toBeLessThanOrEqual(5);
      expect(item.rep_min).toBeLessThanOrEqual(8 + 3);
    }
  });

  it('propagates API failures (so the UI can show them) rather than swallowing them', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('API key not valid'));
    await expect(generateAdaptivePlan(profile, safe, 'k', 'm')).rejects.toThrow(/API key not valid/);
  });

  // BUG: if the model returns fewer week_progressions than requested, the block silently shrinks.
  it('still returns programWeeks weeks when the model returns fewer progressions', async () => {
    mockGenerateContent.mockResolvedValueOnce(base({ week_progressions: [prog(1), prog(2)] }));
    const plan = await generateAdaptivePlan(profile, safe, 'k', 'm');
    expect(plan.weeks).toHaveLength(4);
  });

  // BUG: base_days length is never reconciled with daysPerWeek (prompt asks for it, code doesn't enforce it).
  it('returns exactly daysPerWeek days even if the model over-delivers', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      base({ base_days: [1, 2, 3, 4, 5].map((n) => day(n, ['goblet_squat'])) })
    );
    const plan = await generateAdaptivePlan(profile, safe, 'k', 'm');
    expect(plan.weeks[0].days).toHaveLength(3);
  });

  // BUG: a day whose exercises were all hallucinated is kept as an empty day (blank card in the UI).
  it('never ships a day with zero exercises', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      base({ base_days: [day(1, ['made_up_1', 'made_up_2']), day(2, ['leg_press']), day(3, ['lat_pulldown_neutral'])] })
    );
    const plan = await generateAdaptivePlan(profile, safe, 'k', 'm');
    for (const d of plan.weeks[0].days) expect(d.exercises.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
describe('swapExercise', () => {
  const safe = filterSafeExercises(DEFAULT_PROFILE);
  const current = ex('goblet_squat');

  it('ignores a model suggestion that is not in the candidate pool (joint-unsafe / hallucinated)', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiReply({ ...ex('totally_fake'), swap_rationale: 'x' }));
    const r = await swapExercise(current, 'busy', DEFAULT_PROFILE, safe, 'k', 'm', ['goblet_squat'], []);
    expect(safe.map((e) => e.id)).toContain(r.exercise_id);
    expect(r.exercise_id).not.toBe('goblet_squat');
  });

  it('local swap lowers RPE (floor 6) when the reason mentions pain, and keeps prescription otherwise', async () => {
    const hurt = await swapExercise(ex('goblet_squat', { target_rpe: 7 }), 'knee hurts', DEFAULT_PROFILE, safe, '', 'm', [], []);
    expect(hurt.target_rpe).toBe(6.5);
    const floor = await swapExercise(ex('goblet_squat', { target_rpe: 6 }), 'hurt', DEFAULT_PROFILE, safe, '', 'm', [], []);
    expect(floor.target_rpe).toBe(6);
    const calm = await swapExercise(current, 'fresh variation', DEFAULT_PROFILE, safe, '', 'm', [], []);
    expect(calm).toMatchObject({ sets: 3, rep_min: 8, rep_max: 10, rest_seconds: 75 });
  });

  it('prefers the same movement pattern', async () => {
    const r = await swapExercise(current, 'busy', DEFAULT_PROFILE, safe, '', 'm', [], []);
    expect(exercises.find((e) => e.id === r.exercise_id).movement_pattern).toBe('squat');
  });
});

/* ------------------------------------------------------------------ */
describe('adaptSingleDay (local engine)', () => {
  const safe = filterSafeExercises(DEFAULT_PROFILE);
  const day = {
    day_id: 'w1_d1', day_label: 'Day 1', focus: 'f', estimated_minutes: 45,
    exercises: ['goblet_squat', 'leg_press', 'lat_pulldown_neutral', 'machine_chest_press', 'dead_bug'].map((i) => ex(i)),
  };

  it('trims to 3 moves for <=20 min and 4 for "short"', async () => {
    const a = await adaptSingleDay(day, 'Only 15 min today', DEFAULT_PROFILE, safe, '', 'm');
    expect(a.exercises).toHaveLength(3);
    expect(a.estimated_minutes).toBe(15);
    const b = await adaptSingleDay(day, 'Only have 25 minutes today', DEFAULT_PROFILE, safe, '', 'm');
    expect(b.exercises).toHaveLength(4);
    expect(b.estimated_minutes).toBe(25);
  });

  it('eases off when tired and does not mutate its input', async () => {
    const snapshot = JSON.stringify(day);
    const r = await adaptSingleDay(day, 'Low sleep / feeling fatigued', DEFAULT_PROFILE, safe, '', 'm');
    expect(r.exercises[0].target_rpe).toBe(6.5);
    expect(r.exercises[0].sets).toBe(2);
    expect(JSON.stringify(day)).toBe(snapshot);
  });

  // FIXED: free-text constraints the regex can't parse are silently ignored, yet the banner
  // claims the day was "Adapted locally for: …". The UI placeholder itself suggests "upper body only".
  it('honours a body-part constraint ("upper body only") or says it could not', async () => {
    const r = await adaptSingleDay(day, 'upper body only', DEFAULT_PROFILE, safe, '', 'm');
    const lower = new Set(['squat', 'hinge', 'lunge']);
    const changed = r.exercises.some((e) => !day.exercises.find((d) => d.exercise_id === e.exercise_id));
    const droppedLower = r.exercises.every((e) => !lower.has(exercises.find((x) => x.id === e.exercise_id).movement_pattern));
    expect(changed || droppedLower || /could not|not supported/i.test(r.adaptedBanner)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
describe('readiness metrics', () => {
  it('is monotonic in sleep and layoff length', () => {
    const score = (o) => computeReadinessMetrics({ ...DEFAULT_PROFILE, ...o }).readinessScore;
    expect(score({ sleepHours: 8 })).toBeGreaterThan(score({ sleepHours: 5 }));
    expect(score({ weeksAway: 1 })).toBeGreaterThan(score({ weeksAway: 12 }));
  });

  it('always stays within 40..96 even for extreme inputs', () => {
    const lo = computeReadinessMetrics({ ...DEFAULT_PROFILE, sleepHours: 3, stressLevel: 'high', energyLevel: 'low', weeksAway: 104, restingHr: 115, jointFlags: { knee: true, shoulder: true, lower_back: true } });
    const hi = computeReadinessMetrics({ ...DEFAULT_PROFILE, sleepHours: 9, stressLevel: 'low', energyLevel: 'high', weeksAway: 1, restingHr: 50 });
    expect(lo.readinessScore).toBe(40);
    expect(hi.readinessScore).toBeLessThanOrEqual(96);
  });

  // FIXED: `Number(weeksAway) || 4` treats 0 as "missing" -> someone who never stopped training
  // is scored as if they had 4 weeks off (score 80 vs 84 for one week off, wrong RPE advice).
  it('treats weeksAway = 0 as 0, not as 4', () => {
    const zero = computeReadinessMetrics({ ...DEFAULT_PROFILE, weeksAway: 0 });
    const one = computeReadinessMetrics({ ...DEFAULT_PROFILE, weeksAway: 1 });
    expect(zero.readinessScore).toBeGreaterThanOrEqual(one.readinessScore);
    expect(zero.recommendedRpe).toContain('7.5–8.5');
  });
});

/* ------------------------------------------------------------------ */
describe('local (keyless) chat intake keyword parser', () => {
  const run = async (text) =>
    (await runCoachIntakeTurn([{ role: 'user', text }], DEFAULT_PROFILE, '', 'm')).profile_patch;

  it('flags real joint complaints and parses simple schedule / sleep / equipment phrases', async () => {
    expect(await run('my left knee clicks')).toMatchObject({ protectKnee: true });
    expect(await run('right shoulder is cranky')).toMatchObject({ protectShoulder: true });
    expect(await run('lower back is stiff')).toMatchObject({ protectLowerBack: true });
    expect(await run('I can do 4 days a week')).toMatchObject({ daysPerWeek: 4 });
    expect(await run('I get 6 hours sleep')).toMatchObject({ sleepHours: 6 });
    expect(await run('I only have a home gym with dumbbells')).toMatchObject({ equipmentTier: 'home_setup' });
  });

  it('always marks the chat as ready and echoes the note', async () => {
    const r = await runCoachIntakeTurn([{ role: 'user', text: 'hello' }], DEFAULT_PROFILE, '', 'm');
    expect(r).toMatchObject({ ready_to_generate: true, source: 'local' });
    expect(r.profile_patch.notesAppend).toBe('hello');
  });

  // FIXED: bare substring matching. "getting BACK into the gym" (the app's core use case!) flags the lower
  // back, which then silently removes ~6 exercises from the pool.
  it('does not flag the lower back for "getting back into the gym"', async () => {
    expect(await run('I am getting back into the gym after a break')).not.toHaveProperty('protectLowerBack');
  });

  // FIXED: regex captured a single digit, so "10 days" -> "0 days" -> clamps to 2 days/week.
  it('does not turn "off for 10 days" into 2 training days a week', async () => {
    expect(await run('I was off for 10 days')).not.toHaveProperty('daysPerWeek');
  });

  // FIXED: "home" matched "come home late" / "work from home".
  it('does not switch to a home gym because the user said they come home late', async () => {
    expect(await run('I come home late and I am tired')).not.toHaveProperty('equipmentTier');
  });
});

/* ------------------------------------------------------------------ */
describe('exercise catalog data quality', () => {
  const byId = Object.fromEntries(exercises.map((e) => [e.id, e]));

  const PATTERNS = ['squat', 'hinge', 'lunge', 'horizontal_push', 'horizontal_pull', 'vertical_push', 'vertical_pull', 'core', 'mobility'];
  const count = (tier, p) => exercises.filter((e) => e.movement_pattern === p && e.equipment_tiers.includes(tier)).length;

  it.each(TIERS)('tier %s has at least 2 options for every core movement pattern', (tier) => {
    const short = PATTERNS.filter((p) => count(tier, p) < 2);
    expect(short).toEqual([]);
  });

  // FIXED DATA GAP: only ONE 'carry' exercise exists per tier, yet the local engine schedules a carry on
  // days 2, 4 and 5, so the same move repeats across the week (defeats the variety engine).
  it.each(TIERS)('tier %s has at least 2 carry options (local days 2/4/5 all request one)', (tier) => {
    expect(count(tier, 'carry')).toBeGreaterThanOrEqual(2);
  });

  it('every exercise has the required fields and only known joint / tier values', () => {
    for (const e of exercises) {
      expect(e.name?.length, e.id).toBeGreaterThan(2);
      expect(e.primary_muscles.length, e.id).toBeGreaterThan(0);
      for (const t of e.equipment_tiers) expect(TIERS, e.id).toContain(t);
      for (const j of e.joint_stress_flags) expect(JOINTS, e.id).toContain(j);
    }
  });

  // FIXED DATA: 6 exercises list themselves as their own regression (glute_bridge, incline_pushup,
  // db_lateral_raise, band_pull_apart, dead_bug, cat_cow_thoracic). (regression_id is also unused by the UI.)
  it('regression_id never points at the exercise itself', () => {
    expect(exercises.filter((e) => e.regression_id === e.id).map((e) => e.id)).toEqual([]);
  });

  // FIXED DATA: a regression must be doable wherever the original is.
  it('regression exercise is available in every tier the original is', () => {
    const bad = exercises.filter((e) => e.regression_id && !e.equipment_tiers.every((t) => byId[e.regression_id].equipment_tiers.includes(t)));
    expect(bad.map((e) => `${e.id}->${e.regression_id}`)).toEqual([]);
  });

  it('regression chains do not form long loops', () => {
    for (const e of exercises) {
      const seen = new Set([e.id]);
      let cur = byId[e.regression_id];
      let hops = 0;
      while (cur && !seen.has(cur.id) && hops++ < 10) { seen.add(cur.id); cur = byId[cur.regression_id]; }
      expect(hops, e.id).toBeLessThan(10);
    }
  });
});

/* ------------------------------------------------------------------ */
describe('parseIntakeKeywords — more phrasings', () => {
  const P = {
    '3x/wk': 3, 'I can train 4 days a week': 4, 'about 5 days/week': 5, '2d/wk please': 2, '3 times per week': 3, '9 days a week': 5,
  };
  it.each(Object.entries(P))('days: %j -> %i', async (text, n) => {
    const { parseIntakeKeywords } = await import('../services/geminiCoach');
    expect(parseIntakeKeywords(text).daysPerWeek).toBe(n);
  });

  it('parses sleep in either word order, incl. decimals', async () => {
    const { parseIntakeKeywords } = await import('../services/geminiCoach');
    expect(parseIntakeKeywords('sleeping 6 hrs lately').sleepHours).toBe(6);
    expect(parseIntakeKeywords('I get 6.5 hours of sleep').sleepHours).toBe(6.5);
    expect(parseIntakeKeywords('sleep about 7 hours').sleepHours).toBe(7);
  });

  it('matches the chat box placeholder example end-to-end', async () => {
    const { parseIntakeKeywords } = await import('../services/geminiCoach');
    expect(parseIntakeKeywords('Sleeping 6 hrs, right shoulder clicks overhead, 3x/wk for 40 min')).toEqual({
      sleepHours: 6, protectShoulder: true, daysPerWeek: 3,
    });
  });

  it('does not trigger on innocent words', async () => {
    const { parseIntakeKeywords } = await import('../services/geminiCoach');
    for (const t of [
      'back to training next week', 'I want to get back in shape', 'bounce back quickly', 'come back stronger',
      'was away 3 days', 'last trained 12 days ago', 'home from work at 6', 'feeling great', 'my knee-jerk reaction is to quit',
    ]) {
      const p = parseIntakeKeywords(t);
      expect(Object.keys(p), t).toEqual(t.includes('knee-jerk') ? ['protectKnee'] : []);
    }
  });

  it('still detects genuine lower-back complaints', async () => {
    const { parseIntakeKeywords } = await import('../services/geminiCoach');
    for (const t of ['my back hurts', 'lower back is tight', 'lumbar tightness', 'back pain when deadlifting', 'sciatica flare', 'stiff back']) {
      expect(parseIntakeKeywords(t).protectLowerBack, t).toBe(true);
    }
  });

  it('detects equipment phrases', async () => {
    const { parseIntakeKeywords } = await import('../services/geminiCoach');
    expect(parseIntakeKeywords('I work out at home with dumbbells').equipmentTier).toBe('home_setup');
    expect(parseIntakeKeywords('I have a home gym').equipmentTier).toBe('home_setup');
    expect(parseIntakeKeywords('my apartment gym has cables').equipmentTier).toBe('apartment_gym');
    expect(parseIntakeKeywords('full gym membership').equipmentTier).toBe('commercial_gym');
  });
});

describe('readiness — zero / blank inputs', () => {
  it('keeps 0 weeks away; blank or junk falls back to the 4-week default', () => {
    const s = (weeksAway) => computeReadinessMetrics({ ...DEFAULT_PROFILE, weeksAway }).readinessScore;
    expect(s(0)).toBeGreaterThan(s(1));
    expect(s('')).toBe(s(4));
    expect(s(undefined)).toBe(s(4));
    expect(s('abc')).toBe(s(4));
    expect(s(-3)).toBe(s(0));
  });
});

describe('adaptSingleDay (local) — constraint handling', () => {
  const safe = filterSafeExercises(DEFAULT_PROFILE);
  const day = {
    day_id: 'w1_d1', day_label: 'Day 1', focus: 'f', estimated_minutes: 45,
    exercises: ['goblet_squat', 'db_romanian_deadlift', 'machine_chest_press', 'lat_pulldown_neutral', 'dead_bug'].map((i) => ex(i)),
  };
  const meta = (id) => exercises.find((e) => e.id === id);
  const run = (c) => adaptSingleDay(day, c, DEFAULT_PROFILE, safe, '', 'm');

  it('"upper body only" removes lower-body patterns, keeps the day full and duplicate-free', async () => {
    const r = await run('Only upper body today');
    const pats = r.exercises.map((e) => meta(e.exercise_id).movement_pattern);
    expect(pats.some((p) => ['squat', 'hinge', 'lunge'].includes(p))).toBe(false);
    expect(r.exercises).toHaveLength(5);
    expect(new Set(r.exercises.map((e) => e.exercise_id)).size).toBe(5);
    expect(r.adaptedBanner).toMatch(/upper-body focus/);
  });

  it('"lower body only" removes upper-body pushes/pulls and does not count as "tired"', async () => {
    const r = await run('lower body only');
    const pats = r.exercises.map((e) => meta(e.exercise_id).movement_pattern);
    expect(pats.some((p) => p.includes('push') || p.includes('pull'))).toBe(false);
    expect(r.exercises[0].sets).toBe(3); // untouched: "lower" must not match "low"
    expect(r.exercises[0].target_rpe).toBe(7);
  });

  it.each([['knee', 'my knee hurts'], ['shoulder', 'right shoulder is sore'], ['lower_back', 'lower back stiff']])(
    'joint "%s" removes every move with that stress flag',
    async (joint, text) => {
      const r = await run(text);
      for (const e of r.exercises) expect(meta(e.exercise_id).joint_stress_flags, e.exercise_id).not.toContain(joint);
      expect(new Set(r.exercises.map((e) => e.exercise_id)).size).toBe(r.exercises.length);
    }
  );

  it('is honest about body parts it cannot handle (wrist, elbow, …)', async () => {
    const r = await run('left wrist hurts');
    expect(r.adaptedBanner).toMatch(/wrist.*not supported/i);
  });

  it('plain constraints keep the original banner and exercises', async () => {
    const r = await run('Feeling great — slight intensity boost');
    expect(r.adaptedBanner).toBe('Adapted locally for: "Feeling great — slight intensity boost"');
    expect(r.exercises.map((e) => e.exercise_id)).toEqual(day.exercises.map((e) => e.exercise_id));
  });
});

describe('resolveSwapConflict', () => {
  const safe = filterSafeExercises(DEFAULT_PROFILE);
  const rep = { ...ex('lat_pulldown_neutral'), swap_rationale: 'r' };

  it('leaves a non-conflicting replacement untouched', () => {
    expect(resolveSwapConflict(rep, ['goblet_squat'], safe)).toBe(rep);
  });

  it('re-picks a same-pattern alternative when another swap already took that exercise', () => {
    const r = resolveSwapConflict(rep, ['lat_pulldown_neutral', 'goblet_squat'], safe);
    expect(r.exercise_id).not.toBe('lat_pulldown_neutral');
    expect(['lat_pulldown_neutral', 'goblet_squat']).not.toContain(r.exercise_id);
    expect(exercises.find((e) => e.id === r.exercise_id).movement_pattern).toBe('vertical_pull');
    expect(r.swap_rationale).toMatch(/no duplicate/i);
  });

  it('returns null when nothing is left to pick', () => {
    expect(resolveSwapConflict(rep, safe.map((e) => e.id), safe)).toBeNull();
  });
});
