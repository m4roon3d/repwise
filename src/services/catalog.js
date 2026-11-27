// The live exercise catalogue: the built-in library plus the person's own exercises (added by hand or by AI).
// Everything that reads exercises imports from here. `exercises` and `EXERCISE_MAP` are updated in place, so
// modules holding a reference always see the current person's catalogue.
import builtIn from '../data/exercises.json';

export const BUILT_IN_IDS = new Set(builtIn.map((e) => e.id));
export const exercises = [...builtIn];
export const EXERCISE_MAP = Object.fromEntries(builtIn.map((e) => [e.id, e]));

export const MOVEMENT_PATTERNS = [
  'squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull',
  'core', 'carry', 'arms', 'calves', 'mobility', 'yoga', 'cardio',
];
export const PATTERN_LABELS = Object.fromEntries(MOVEMENT_PATTERNS.map((p) => [p, p.replace('_', ' ')]));
export const TIERS = ['commercial_gym', 'apartment_gym', 'home_setup'];
export const MODALITIES = ['gym', 'calisthenics', 'yoga', 'cardio'];
export const DOSES = ['reps', 'time', 'duration'];
/** Areas a custom exercise can load. knee / shoulder / lower_back match the built-in joint flags. */
export const STRESS_AREAS = ['knee', 'shoulder', 'lower_back', 'wrist', 'elbow', 'hip', 'ankle', 'neck', 'impact'];
export const MAX_CUSTOM = 60;

export const isCustom = (id) => typeof id === 'string' && id.startsWith('my_');

const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const list = (v, allowed) => (Array.isArray(v) ? [...new Set(v.filter((x) => allowed.includes(x)))] : []);

export function slugFor(name, taken) {
  const base = `my_${str(name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'exercise'}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`;
  return id;
}

/** A clean custom exercise, or null when it is unusable. Never trusts the shape it is given. */
export function sanitizeCustomExercise(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name, 60);
  const id = isCustom(raw.id) && /^my_[a-z0-9_]{1,60}$/.test(raw.id) ? raw.id : null;
  if (!name || !id) return null;
  const movement_pattern = MOVEMENT_PATTERNS.includes(raw.movement_pattern) ? raw.movement_pattern : 'core';
  const modalities = list(raw.modalities, MODALITIES);
  const fallbackModality = movement_pattern === 'yoga' ? 'yoga' : movement_pattern === 'cardio' ? 'cardio' : 'gym';
  const dose = DOSES.includes(raw.dose) ? raw.dose : movement_pattern === 'cardio' ? 'duration' : movement_pattern === 'yoga' ? 'time' : 'reps';
  const ex = {
    id,
    name,
    movement_pattern,
    primary_muscles: (Array.isArray(raw.primary_muscles) ? raw.primary_muscles : []).map((m) => str(m, 24)).filter(Boolean).slice(0, 4),
    equipment_tiers: list(raw.equipment_tiers, TIERS),
    equipment_label: str(raw.equipment_label, 50) || 'Bodyweight',
    joint_stress_flags: list(raw.joint_stress_flags, STRESS_AREAS),
    cues: (Array.isArray(raw.cues) ? raw.cues : []).map((c) => str(c, 140)).filter(Boolean).slice(0, 4),
    modalities: modalities.length ? modalities : [fallbackModality],
    dose,
    custom: true,
    source: raw.source === 'ai' ? 'ai' : 'manual',
  };
  if (!ex.equipment_tiers.length) ex.equipment_tiers = [...TIERS];
  if (!ex.primary_muscles.length) ex.primary_muscles = ['Full body'];
  if (!ex.cues.length) ex.cues = ['Move with control and stop if anything hurts.'];
  if (typeof raw.regression_id === 'string' && BUILT_IN_IDS.has(raw.regression_id)) ex.regression_id = raw.regression_id;
  if (Number.isFinite(raw.flow_order)) ex.flow_order = raw.flow_order;
  return ex;
}

export function sanitizeCustomList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const ex = sanitizeCustomExercise(r);
    if (ex && !seen.has(ex.id)) {
      seen.add(ex.id);
      out.push(ex);
    }
    if (out.length >= MAX_CUSTOM) break;
  }
  return out;
}

/** Swap in a person's own exercises. Built-ins always stay. */
export function setCustomExercises(customList) {
  const clean = sanitizeCustomList(customList);
  exercises.length = 0;
  exercises.push(...builtIn, ...clean);
  for (const k of Object.keys(EXERCISE_MAP)) if (!BUILT_IN_IDS.has(k)) delete EXERCISE_MAP[k];
  for (const e of clean) EXERCISE_MAP[e.id] = e;
  return clean;
}

export const customExercises = () => exercises.filter((e) => e.custom);
/** Custom exercises that load an area (or 'impact'): used by the health exclusions. */
export const customLoading = (area) => exercises.filter((e) => e.custom && e.joint_stress_flags.includes(area)).map((e) => e.id);
