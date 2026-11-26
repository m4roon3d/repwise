// Pre-exercise health screening and the training adjustments it implies.
// Nothing here diagnoses. It decides how cautious the plan should be, which exercises to leave out,
// and what safety notes to show, and it says when a doctor's OK is a good idea first.
import exercises from '../data/exercises.json';
import { analyzeLabs, describeLabsForPrompt } from './labs';
import { baselineRpeDelta, describeBaselineForPrompt, latestBaseline } from './baseline';

// Based on the general questions of the PAR-Q+ (physical activity readiness questionnaire), reworded.
export const PARQ_QUESTIONS = [
  { id: 'heart', text: 'Has a doctor ever said you have a heart condition or high blood pressure?' },
  { id: 'chestPain', text: 'Do you get chest pain at rest, during daily activities, or when you exercise?', urgent: true },
  { id: 'dizziness', text: 'In the past 12 months, have you lost your balance because of dizziness, or lost consciousness?', urgent: true },
  { id: 'chronic', text: 'Have you been diagnosed with any other long-term medical condition?' },
  { id: 'medication', text: 'Do you take prescribed medicine for a long-term condition?' },
  { id: 'boneJoint', text: 'In the past 12 months, have you had a bone, joint or muscle problem that more activity could make worse?' },
  { id: 'supervised', text: 'Has a doctor ever said you should only exercise under medical supervision?', urgent: true },
];

export const CONDITIONS = [
  { id: 'hypertension', label: 'High blood pressure' },
  { id: 'heart', label: 'Heart condition' },
  { id: 'diabetes', label: 'Diabetes or prediabetes' },
  { id: 'asthma', label: 'Asthma' },
  { id: 'osteoporosis', label: 'Osteoporosis / osteopenia' },
  { id: 'arthritis', label: 'Arthritis' },
  { id: 'thyroid', label: 'Thyroid condition' },
];

export const PREGNANCY_OPTIONS = [
  { id: 'none', label: 'Not applicable' },
  { id: 'pregnant_t1', label: 'Pregnant: first trimester' },
  { id: 'pregnant_t2', label: 'Pregnant: second trimester' },
  { id: 'pregnant_t3', label: 'Pregnant: third trimester' },
  { id: 'postpartum_early', label: 'Had a baby in the last 12 weeks' },
  { id: 'postpartum', label: 'Had a baby 3 to 12 months ago' },
];

export const INJURY_AREAS = [
  { id: 'knee', label: 'Knee', legacy: true },
  { id: 'shoulder', label: 'Shoulder', legacy: true },
  { id: 'lower_back', label: 'Lower back', legacy: true },
  { id: 'wrist', label: 'Wrist' },
  { id: 'elbow', label: 'Elbow' },
  { id: 'hip', label: 'Hip' },
  { id: 'ankle', label: 'Ankle' },
  { id: 'neck', label: 'Neck' },
];
export const INJURY_STATUS = ['none', 'old', 'current'];

const byId = Object.fromEntries(exercises.map((e) => [e.id, e]));
const where = (fn) => exercises.filter(fn).map((e) => e.id);

// Exercises that load each area hard. Knee / shoulder / lower back use the catalogue's own joint flags.
const AREA_EXCLUSIONS = {
  wrist: ['pushup', 'incline_pushup', 'pike_pushup_elevated', 'barbell_front_squat', 'barbell_bench_press', 'worlds_greatest_stretch', 'cat_cow_thoracic', 'thread_the_needle'],
  elbow: [...where((e) => ['curl', 'pushdown', 'pullup'].includes(e.animation_key)), 'assisted_pullup', 'db_pullover', 'barbell_bench_press', 'pike_pushup_elevated'],
  hip: [...where((e) => e.movement_pattern === 'lunge'), 'sumo_goblet_squat', 'hip_90_90_switch', 'barbell_back_squat', 'barbell_front_squat', 'single_leg_rdl_db'],
  ankle: [...where((e) => e.movement_pattern === 'lunge' || e.movement_pattern === 'calves'), 'worlds_greatest_stretch'],
  neck: ['seated_db_overhead_press', 'machine_shoulder_press', 'band_overhead_press', 'pike_pushup_elevated', 'barbell_back_squat', 'farmers_carry', 'suitcase_carry'],
};

const SUPINE = ['glute_bridge', 'single_leg_glute_bridge', 'dead_bug', 'barbell_bench_press', 'db_bench_press', 'db_floor_press', 'db_pullover'];
const ABDOMINAL_PRESSURE = ['forearm_plank', 'pushup', 'pike_pushup_elevated'];
const HEAVY_BARBELL = ['barbell_back_squat', 'barbell_front_squat', 'trap_bar_deadlift', 'barbell_bench_press'];

export const EMPTY_HEALTH = {
  parq: {}, // { [questionId]: true | false }
  conditions: [],
  betaBlocker: false,
  glucoseLoweringMeds: false,
  pregnancy: 'none',
  injuries: {}, // { [area]: 'none' | 'old' | 'current' }
};

export function sanitizeHealth(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...EMPTY_HEALTH, parq: {}, injuries: {}, conditions: [] };
  for (const q of PARQ_QUESTIONS) if (typeof src.parq?.[q.id] === 'boolean') out.parq[q.id] = src.parq[q.id];
  if (Array.isArray(src.conditions)) out.conditions = CONDITIONS.map((c) => c.id).filter((id) => src.conditions.includes(id));
  out.betaBlocker = src.betaBlocker === true;
  out.glucoseLoweringMeds = src.glucoseLoweringMeds === true;
  if (PREGNANCY_OPTIONS.some((p) => p.id === src.pregnancy)) out.pregnancy = src.pregnancy;
  for (const a of INJURY_AREAS) if (INJURY_STATUS.includes(src.injuries?.[a.id])) out.injuries[a.id] = src.injuries[a.id];
  return out;
}

export const parqComplete = (health) => PARQ_QUESTIONS.every((q) => typeof health?.parq?.[q.id] === 'boolean');

/** Injury status for an area, falling back to the legacy joint flag for knee / shoulder / lower back. */
export function injuryStatus(profile, area) {
  const legacy = INJURY_AREAS.find((a) => a.id === area)?.legacy;
  // The legacy joint flag is what actually filters the catalogue, so it wins for knee / shoulder / back.
  if (legacy && profile?.jointFlags?.[area]) return 'current';
  const s = profile?.health?.injuries?.[area];
  if (s) return legacy && s === 'current' ? 'none' : s;
  return 'none';
}

/** Returns a new profile with the injury set, keeping the legacy joint flags in step. */
export function setInjury(profile, area, status) {
  const health = sanitizeHealth(profile.health);
  health.injuries = { ...health.injuries, [area]: status };
  const next = { ...profile, health };
  if (INJURY_AREAS.find((a) => a.id === area)?.legacy) {
    next.jointFlags = { ...profile.jointFlags, [area]: status === 'current' };
  }
  return next;
}

/**
 * Everything the screening implies for programming:
 * { rpeCap, exclusions: [{ reason, ids }], notes: [{ kind, text }], clearance: 'none'|'advised'|'strong', labs }
 */
export function healthAdjustments(profile) {
  const h = sanitizeHealth(profile?.health);
  const notes = [];
  const exclusions = [];
  const caps = [];
  let clearance = 'none';
  const advise = (lvl) => {
    if (lvl === 'strong' || clearance === 'none') clearance = lvl;
  };
  const exclude = (reason, ids) => {
    const valid = ids.filter((id) => byId[id]);
    if (valid.length) exclusions.push({ reason, ids: [...new Set(valid)] });
  };

  // Screening answers
  const yes = PARQ_QUESTIONS.filter((q) => h.parq[q.id] === true);
  if (yes.some((q) => q.urgent)) {
    advise('strong');
    caps.push(6.5);
    notes.push({ kind: 'clearance', text: 'You answered yes to chest pain, dizziness or supervised-only exercise. Please get a doctor\'s OK before training; until then the plan stays very light.' });
  } else if (yes.length) {
    advise('advised');
    caps.push(7);
    notes.push({ kind: 'clearance', text: 'You answered yes to a screening question, so a quick check with your doctor is a good idea. The plan starts gentle.' });
  }

  // Conditions
  const has = (id) => h.conditions.includes(id);
  if (has('heart')) {
    advise('strong');
    caps.push(6.5);
    notes.push({ kind: 'warning', text: 'Heart condition: keep every set conversational and get your cardiologist\'s guidance on limits.' });
  }
  if (has('hypertension')) {
    caps.push(7.5);
    notes.push({ kind: 'safety', text: 'Blood pressure: breathe out as you push, never hold your breath, and stop a set 2 to 3 reps before failure.' });
  }
  if (has('diabetes') || h.glucoseLoweringMeds) {
    notes.push({
      kind: 'safety',
      text: h.glucoseLoweringMeds
        ? 'Glucose-lowering medicine: check your sugar before training, keep fast carbs nearby, and stop if you feel shaky or sweaty.'
        : 'Diabetes: strength training improves blood sugar control. Keep water and a snack handy.',
    });
  }
  if (has('asthma')) notes.push({ kind: 'safety', text: 'Asthma: warm up for 10 minutes and keep your reliever inhaler with you.' });
  if (has('osteoporosis')) {
    caps.push(7.5);
    notes.push({ kind: 'safety', text: 'Bone health: loading is good for bone, but keep your spine neutral. No rounding or twisting under load.' });
  }
  if (has('arthritis')) notes.push({ kind: 'info', text: 'Arthritis: some discomfort is fine, but pain that lasts more than 2 hours after training means ease off next time.' });
  if (has('thyroid')) notes.push({ kind: 'info', text: 'Thyroid: energy can swing; use the effort scale, not the weight, to judge each session.' });
  if (h.betaBlocker) notes.push({ kind: 'info', text: 'Beta-blockers keep your heart rate low, so judge effort by how hard it feels (RPE), not by heart rate.' });

  // Pregnancy / postpartum
  const preg = h.pregnancy;
  if (preg.startsWith('pregnant')) {
    caps.push(7);
    advise('advised');
    notes.push({ kind: 'safety', text: 'Pregnancy: you should be able to talk through every set. Stop for dizziness, bleeding, fluid loss or pain, and check this plan with your doctor or midwife.' });
    exclude('Pregnancy: heavy barbell lifts', HEAVY_BARBELL);
    if (preg !== 'pregnant_t1') {
      exclude('Pregnancy: no lying flat on your back', SUPINE);
      exclude('Pregnancy: avoids strain on the abdominal wall', ABDOMINAL_PRESSURE);
    }
  } else if (preg === 'postpartum_early') {
    caps.push(6.5);
    advise('advised');
    notes.push({ kind: 'safety', text: 'Early postpartum: wait for your 6-week check before loading, rebuild breathing and pelvic floor first, and stop for heaviness, leaking or pain.' });
    exclude('Early postpartum: abdominal-wall and heavy loading', [...ABDOMINAL_PRESSURE, ...HEAVY_BARBELL, 'pullup']);
  } else if (preg === 'postpartum') {
    caps.push(7.5);
    notes.push({ kind: 'info', text: 'Postpartum: if you notice leaking, heaviness or doming of the belly, mention it to a women\'s health physio.' });
  }

  // Injuries (wrist, elbow, hip, ankle, neck; knee/shoulder/back go through the catalogue's joint flags)
  for (const area of INJURY_AREAS) {
    const status = injuryStatus(profile, area.id);
    if (status === 'current' && AREA_EXCLUSIONS[area.id]) exclude(`${area.label}: currently sore or injured`, AREA_EXCLUSIONS[area.id]);
    if (status === 'old') notes.push({ kind: 'info', text: `Old ${area.label.toLowerCase()} injury: warm it up well and back off if it complains.` });
  }

  // Dislikes
  const dislikes = (profile?.preferences?.dislikes || []).filter((id) => byId[id]);
  if (dislikes.length) exclude('You said you don\'t enjoy these', dislikes);

  // Blood report
  const labs = profile?.labs ? analyzeLabs(profile.labs, profile.sex) : null;
  if (labs?.rpeCap) caps.push(labs.rpeCap);
  if (labs?.doctor) advise('advised');
  if (labs?.glucose && !has('diabetes')) notes.push({ kind: 'safety', text: 'Your blood sugar markers are high: regular training helps, so this plan keeps you consistent.' });

  return { rpeCap: caps.length ? Math.min(...caps) : null, exclusions, notes, clearance, labs };
}

/** Starting RPE including fitness tests and health caps. */
export function adjustedStartingRpe(baseRpe, profile) {
  const withTest = baseRpe + baselineRpeDelta(latestBaseline(profile), profile?.age);
  const { rpeCap } = healthAdjustments(profile);
  return Math.max(5.5, rpeCap ? Math.min(rpeCap, withTest) : withTest);
}

/** Clamps every exercise's target RPE in a plan to the health cap. Returns a new plan. */
export function applyRpeCap(plan, profile) {
  const { rpeCap } = healthAdjustments(profile);
  if (!plan || !rpeCap) return plan;
  const capItem = (it) => (Number(it.target_rpe) > rpeCap ? { ...it, target_rpe: rpeCap } : it);
  return {
    ...plan,
    weeks: (plan.weeks || []).map((w) => ({ ...w, days: w.days.map((d) => ({ ...d, exercises: d.exercises.map(capItem) })) })),
  };
}

export function describeHealthForPrompt(profile) {
  const h = sanitizeHealth(profile?.health);
  const adj = healthAdjustments(profile);
  const parqYes = PARQ_QUESTIONS.filter((q) => h.parq[q.id]).map((q) => q.id);
  const injuries = INJURY_AREAS.map((a) => [a.label, injuryStatus(profile, a.id)])
    .filter(([, s]) => s !== 'none')
    .map(([l, s]) => `${l} (${s})`);
  const pref = profile?.preferences || {};
  return [
    `- Sex: ${profile?.sex || 'not given'} | Daily activity: ${pref.activity || 'not given'} | Other sports: ${pref.sports || 'none'} | Prefers training: ${pref.timeOfDay || 'any time'}`,
    `- Specific goal: ${pref.specificGoal || 'not given'}${pref.goalWhy ? ` | Why it matters: ${pref.goalWhy}` : ''}`,
    `- Health screening: ${parqYes.length ? `answered YES to ${parqYes.join(', ')}` : Object.keys(h.parq).length ? 'all no' : 'not answered'}`,
    `- Conditions: ${h.conditions.length ? h.conditions.join(', ') : 'none reported'}${h.betaBlocker ? ' | takes beta-blockers (use RPE, not HR)' : ''}${h.glucoseLoweringMeds ? ' | on glucose-lowering medicine' : ''}`,
    `- Pregnancy / postpartum: ${h.pregnancy}`,
    `- Injuries: ${injuries.length ? injuries.join(', ') : 'none'}`,
    `- Blood report flags: ${describeLabsForPrompt(profile?.labs, profile?.sex)}`,
    `- Fitness baseline: ${describeBaselineForPrompt(profile || {})}`,
    `- Likes: ${(pref.likes || []).map((id) => byId[id]?.name || id).join(', ') || 'none given'}`,
    `- HARD LIMITS: never prescribe above RPE ${adj.rpeCap ?? 9}. Safety notes to respect: ${adj.notes.map((n) => n.text).join(' ') || 'none'}`,
  ].join('\n');
}
