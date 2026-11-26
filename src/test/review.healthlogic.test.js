/** Health screening, lab analysis, fitness baselines, plan rationale and per-person storage. */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE, sanitizeProfile, saveProfile, loadProfile, listProfiles, createProfile, switchProfile, deleteProfile, getActiveProfileId, loadOnboarded, saveOnboarded, savePlan, loadPlan } from '../services/storage';
import { healthAdjustments, applyRpeCap, injuryStatus, setInjury, parqComplete, describeHealthForPrompt, PARQ_QUESTIONS } from '../services/health';
import { analyzeLabs, matchMarker, toCanonical, sanitizeLabs } from '../services/labs';
import { scoreBaseline, retestDue, baselineDelta, sanitizeBaselines } from '../services/baseline';
import { filterSafeExercises } from '../services/catalogFilter';
import { buildPlanRationale } from '../services/rationale';
import { generateAdaptivePlan } from '../services/geminiCoach';
import exercises from '../data/exercises.json';

const P = (over = {}) => sanitizeProfile({ ...DEFAULT_PROFILE, ...over });
const allNo = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q.id, false]));
const ids = (profile) => new Set(filterSafeExercises(profile).map((e) => e.id));
const maxRpe = (plan) => Math.max(...plan.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises.map((e) => e.target_rpe))));

describe('health screening', () => {
  it('a clean screen changes nothing', () => {
    const adj = healthAdjustments(P({ health: { parq: allNo } }));
    expect(adj).toMatchObject({ rpeCap: null, clearance: 'none', exclusions: [] });
    expect(parqComplete({ parq: allNo })).toBe(true);
    expect(parqComplete({ parq: { heart: false } })).toBe(false);
  });

  it('an ordinary yes advises a doctor and caps effort at 7; chest pain / dizziness is a strong warning at 6.5', () => {
    expect(healthAdjustments(P({ health: { parq: { ...allNo, medication: true } } }))).toMatchObject({ rpeCap: 7, clearance: 'advised' });
    expect(healthAdjustments(P({ health: { parq: { ...allNo, chestPain: true } } }))).toMatchObject({ rpeCap: 6.5, clearance: 'strong' });
  });

  it('conditions add the right notes and caps', () => {
    const adj = healthAdjustments(P({ health: { conditions: ['hypertension', 'asthma'], betaBlocker: true } }));
    expect(adj.rpeCap).toBe(7.5);
    const text = adj.notes.map((n) => n.text).join(' ');
    expect(text).toMatch(/breathe out/);
    expect(text).toMatch(/inhaler/);
    expect(text).toMatch(/Beta-blockers/);
  });

  it('second-trimester pregnancy removes lying-on-back and plank work; first trimester keeps them', () => {
    const t2 = ids(P({ sex: 'female', health: { pregnancy: 'pregnant_t2' } }));
    for (const id of ['glute_bridge', 'dead_bug', 'forearm_plank', 'barbell_back_squat']) expect(t2.has(id), id).toBe(false);
    const t1 = ids(P({ sex: 'female', health: { pregnancy: 'pregnant_t1' } }));
    expect(t1.has('dead_bug')).toBe(true);
    expect(t1.has('barbell_back_squat')).toBe(false);
  });

  it('a sore wrist / elbow / ankle filters the right moves; an old injury only adds a note', () => {
    const wrist = ids(P({ health: { injuries: { wrist: 'current' } } }));
    expect(wrist.has('pushup')).toBe(false);
    expect(ids(P({ health: { injuries: { elbow: 'current' } } })).has('db_biceps_curl')).toBe(false);
    expect(ids(P({ health: { injuries: { ankle: 'current' } } })).has('standing_calf_raise_db')).toBe(false);
    const old = P({ health: { injuries: { wrist: 'old' } } });
    expect(ids(old).has('pushup')).toBe(true);
    expect(healthAdjustments(old).notes.some((n) => /Old wrist/.test(n.text))).toBe(true);
  });

  it('knee / shoulder / back keep using the catalogue joint flags, and setInjury keeps both in step', () => {
    let p = setInjury(P(), 'knee', 'current');
    expect(p.jointFlags.knee).toBe(true);
    expect(injuryStatus(p, 'knee')).toBe('current');
    p = setInjury(p, 'knee', 'old');
    expect(p.jointFlags.knee).toBe(false);
    expect(injuryStatus(p, 'knee')).toBe('old');
    // the chat setting only the legacy flag still counts as current
    expect(injuryStatus(P({ jointFlags: { knee: true, shoulder: false, lower_back: false } }), 'knee')).toBe('current');
  });

  it('dislikes are dropped while there is plenty of choice, but never empty the pool', () => {
    expect(ids(P({ preferences: { dislikes: ['pushup', 'goblet_squat'] } })).has('pushup')).toBe(false);
    const everything = exercises.map((e) => e.id).slice(0, 20);
    expect(filterSafeExercises(P({ preferences: { dislikes: everything } })).length).toBeGreaterThanOrEqual(12);
  });

  it('applyRpeCap clamps every week; the prompt states the hard limit', () => {
    const profile = P({ health: { conditions: ['heart'] } });
    const plan = { weeks: [{ days: [{ exercises: [{ target_rpe: 8.5 }, { target_rpe: 6 }] }] }] };
    expect(maxRpe(applyRpeCap(plan, profile))).toBe(6.5);
    expect(describeHealthForPrompt(profile)).toMatch(/never prescribe above RPE 6.5/);
  });

  it('generated plans (local engine) respect the cap and carry a rationale', async () => {
    const profile = P({ experience: 'advanced', health: { parq: { ...allNo, dizziness: true } } });
    const plan = await generateAdaptivePlan(profile, filterSafeExercises(profile), '', 'm');
    expect(maxRpe(plan)).toBeLessThanOrEqual(6.5);
    expect(plan.rationale.find((r) => r.id === 'intensity').text).toMatch(/cap effort at RPE 6.5/);
    const easy = P({ experience: 'beginner', health: { conditions: ['hypertension'] } }); // starts 6.5, cap 7.5 isn't the reason
    const easyPlan = await generateAdaptivePlan(easy, filterSafeExercises(easy), '', 'm');
    expect(easyPlan.rationale.find((r) => r.id === 'intensity').text).not.toMatch(/cap effort/);
    expect(plan.rationale.map((r) => r.id)).toEqual(expect.arrayContaining(['schedule', 'goal', 'intensity', 'health']));
  });
});

describe('blood report analysis', () => {
  it('matches printed names, preferring the most specific', () => {
    expect(matchMarker('LDL Cholesterol, Direct')).toBe('ldl');
    expect(matchMarker('Cholesterol - Total')).toBe('total_cholesterol');
    expect(matchMarker('HbA1c (Glycated Haemoglobin)')).toBe('hba1c');
    expect(matchMarker('Hemoglobin')).toBe('hemoglobin');
    expect(matchMarker('Glucose PP')).toBeNull();
    expect(matchMarker('Platelet count')).toBeNull();
  });
  it('converts common units', () => {
    expect(toCanonical('fasting_glucose', 5.5, 'mmol/L')).toBe(99);
    expect(toCanonical('vitamin_d', 50, 'nmol/L')).toBeCloseTo(20, 0);
    expect(toCanonical('hemoglobin', 130, 'g/L')).toBe(13);
  });
  it('flags low haemoglobin (sex-specific), caps effort and advises a doctor', () => {
    const labs = { markers: [{ name: 'Hemoglobin', value: 12.8, unit: 'g/dL' }] };
    expect(analyzeLabs(labs, 'female').flagged).toHaveLength(0);
    const male = analyzeLabs(labs, 'male');
    expect(male.flagged[0]).toMatchObject({ id: 'hemoglobin', status: 'low', doctor: true });
    expect(male.rpeCap).toBe(7);
  });
  it('bands HbA1c and notes cardio for lipids', () => {
    const a = analyzeLabs({ markers: [{ name: 'HbA1c', value: 6.1, unit: '%' }, { name: 'Triglycerides', value: 220, unit: 'mg/dL' }] });
    expect(a.flagged.find((r) => r.id === 'hba1c').band).toBe('prediabetes range');
    expect(a.wantsCardio).toBe(true);
    expect(a.glucose).toBe(true);
  });
  it('sanitizes untrusted data and keeps unknown tests without judging them', () => {
    expect(sanitizeLabs({ markers: [{ name: 'x', value: 'abc' }] })).toBeNull();
    const l = sanitizeLabs({ markers: [{ name: 'Platelets', value: 250, unit: '10^3/uL' }, { name: 'Vitamin D', value: 14, unit: 'ng/mL' }], image: 'BASE64' });
    expect(JSON.stringify(l)).not.toContain('BASE64');
    const a = analyzeLabs(l);
    expect(a.results[0].status).toBe('unknown');
    expect(a.results[1].status).toBe('low');
  });
});

describe('fitness baseline', () => {
  it('scores into three levels, with age-adjusted chair stands and knee push-ups capped at average', () => {
    expect(scoreBaseline({ pushups: 5, sitToStand: 12, plankSec: 20 }).level).toBe('foundation');
    expect(scoreBaseline({ pushups: 30, sitToStand: 25, plankSec: 120 }).level).toBe('strong');
    expect(scoreBaseline({ sitToStand: 16 }, 65).sitToStand).toBe(2);
    expect(scoreBaseline({ sitToStand: 16 }, 30).sitToStand).toBe(2);
    expect(scoreBaseline({ pushups: 40, pushupType: 'knee' }).pushups).toBe(2);
  });
  it('a weak baseline lowers the starting effort of the local plan', async () => {
    const base = P({ experience: 'intermediate' });
    const weak = P({ experience: 'intermediate', baselines: [{ ts: Date.now(), pushups: 2, sitToStand: 10, plankSec: 15 }] });
    const a = await generateAdaptivePlan(base, filterSafeExercises(base), '', 'm');
    const b = await generateAdaptivePlan(weak, filterSafeExercises(weak), '', 'm');
    expect(b.weeks[0].days[0].exercises[0].target_rpe).toBeLessThan(a.weeks[0].days[0].exercises[0].target_rpe);
  });
  it('knows when a retest is due and shows the change', () => {
    const old = Date.now() - 40 * 86400000;
    const p = P({ programWeeks: 4, baselines: [{ ts: old, pushups: 12 }, { ts: old - 1000, pushups: 8 }] });
    expect(retestDue(p)).toBe(true);
    expect(baselineDelta(p)).toEqual({ pushups: 4 });
    expect(retestDue(P({ baselines: [{ ts: Date.now(), pushups: 3 }] }))).toBe(false);
    expect(sanitizeBaselines([{ ts: 'x' }, { ts: 1 }])).toEqual([]);
  });
});

describe('why this plan', () => {
  it('ties lines to the person\'s answers', async () => {
    const profile = P({
      weeksAway: 10,
      sex: 'male',
      health: { injuries: { wrist: 'current' } },
      labs: { markers: [{ name: 'Hemoglobin', value: 11, unit: 'g/dL' }] },
      baselines: [{ ts: Date.now(), pushups: 4, sitToStand: 11, plankSec: 20, deepSquat: false }],
      preferences: { specificGoal: 'do 10 push-ups', activity: 'sedentary', likes: ['goblet_squat'] },
    });
    const plan = await generateAdaptivePlan(profile, filterSafeExercises(profile), '', 'm');
    const byId = Object.fromEntries(buildPlanRationale(profile, plan).map((l) => [l.id, l]));
    expect(byId.goal.text).toMatch(/Your goal: "do 10 push-ups"/);
    expect(byId.intensity.text).toMatch(/away 10 weeks/);
    expect(byId.protected.text).toMatch(/wrist/);
    expect(byId.labs.text).toMatch(/Haemoglobin is low/);
    expect(byId.baseline.text).toMatch(/box or goblet/);
    expect(byId.you.text).toMatch(/sit most of the day/);
    expect(byId.you.text).toMatch(/Goblet Squat/);
    for (const l of Object.values(byId)) expect(l.ask).toMatch(/\?$/);
  });
});

describe('profiles on one device', () => {
  it('the first person keeps the original keys; a new person is fully separate; deleting cleans up', () => {
    saveProfile({ ...DEFAULT_PROFILE, name: 'Ramanaa' });
    savePlan({ weeks: [{ days: [{ exercises: [] }] }] });
    expect(localStorage.getItem('mf_profile_v1')).toContain('Ramanaa');
    localStorage.setItem('mf_byok_gemini_api_key', 'shared');

    const id = createProfile('Partner');
    expect(getActiveProfileId()).toBe(id);
    expect(loadProfile().name).toBe('');
    expect(loadPlan()).toBeNull();
    expect(loadOnboarded()).toBe(false);
    saveProfile({ ...DEFAULT_PROFILE, name: 'Asha' });
    saveOnboarded(true);
    expect(localStorage.getItem(`mf_p_${id}__profile_v1`)).toContain('Asha');
    expect(localStorage.getItem('mf_byok_gemini_api_key')).toBe('shared');
    expect(listProfiles().map((p) => p.name)).toEqual(['Ramanaa', 'Asha']);

    switchProfile('default');
    expect(loadProfile().name).toBe('Ramanaa');
    expect(deleteProfile('default')).toBe(false);
    expect(deleteProfile(id)).toBe(true);
    expect(Object.keys(localStorage).some((k) => k.includes(id))).toBe(false);
    expect(listProfiles()).toHaveLength(1);
  });

  it('existing users with saved data count as onboarded', () => {
    localStorage.removeItem('mf_onboarded_v1');
    expect(loadOnboarded()).toBe(false);
    saveProfile(DEFAULT_PROFILE);
    expect(loadOnboarded()).toBe(true);
  });

  it('a garbage active-profile id falls back to the first person', () => {
    localStorage.setItem('mf_active_profile_v1', '../../etc');
    expect(getActiveProfileId()).toBe('default');
  });
});

vi.mock('@google/genai', () => ({ Type: {}, GoogleGenAI: vi.fn() }));
