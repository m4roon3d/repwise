import { sanitizeHealth, EMPTY_HEALTH } from './health';
import { sanitizeBaselines } from './baseline';
import { sanitizeLabs } from './labs';
import exerciseCatalog from '../data/exercises.json';

const KEYS = {
  API_KEY: 'mf_byok_gemini_api_key',
  MODEL: 'mf_byok_gemini_model',
  PROFILE: 'mf_profile_v1',
  PLAN: 'mf_active_plan_v1',
  FEEDBACK: 'mf_weekly_feedback_v1',
  HEALTH_ACK: 'mf_health_notice_ack_v1',
  WORKOUT_LOGS: 'mf_workout_logs_v1',
  COACH_CHAT: 'mf_coach_chat_v1',
  ONBOARDED: 'mf_onboarded_v1',
  PROFILES: 'mf_profiles_v1', // device-level: [{ id, name }]
  ACTIVE_PROFILE: 'mf_active_profile_v1', // device-level
};

// ---- Profiles (two people, one phone) --------------------------------------------------------------
// The first person keeps the original, unprefixed keys so existing data needs no migration. Everyone else's
// data lives under `mf_p_<id>__…`. The API key and model are shared by the device.
const DEVICE_KEYS = new Set([KEYS.API_KEY, KEYS.MODEL, KEYS.PROFILES, KEYS.ACTIVE_PROFILE]);
const DEFAULT_PROFILE_ID = 'default';

function rawGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function activeProfileId() {
  const id = rawGet(KEYS.ACTIVE_PROFILE);
  return id && /^[a-z0-9]{1,16}$/.test(id) ? id : DEFAULT_PROFILE_ID;
}
function scoped(key, id = activeProfileId()) {
  if (DEVICE_KEYS.has(key) || id === DEFAULT_PROFILE_ID) return key;
  return key.replace(/^mf_/, `mf_p_${id}__`);
}

// localStorage can throw (Safari "block all cookies", embedded webviews, quota exceeded, private mode).
// Persistence is best-effort: the app must keep working in-memory when it fails.
function safeGet(key) {
  try {
    return localStorage.getItem(scoped(key));
  } catch {
    return null;
  }
}
function safeSet(key, value) {
  try {
    localStorage.setItem(scoped(key), value);
    return true;
  } catch {
    return false;
  }
}
function safeRemove(key) {
  try {
    localStorage.removeItem(scoped(key));
  } catch {
    /* ignore */
  }
}

export const DEFAULT_MODEL = 'gemini-3.8-flash';

export const DEFAULT_PROFILE = {
  unitSystem: 'metric', // metric (cm/kg) | imperial (ft-in/lbs)
  age: 30,
  heightCm: 175,
  weightKg: 75,
  restingHr: 68,
  sleepHours: 7,
  stressLevel: 'moderate', // low | moderate | high
  bodyFatPct: '', // optional fitness estimate
  bloodPressure: '', // optional context (non-diagnostic)
  weeksAway: 0, // weeks since last trained (0 = currently training)
  experience: 'beginner', // beginner | intermediate | advanced
  energyLevel: 'moderate', // low | moderate | high
  goal: 'general_fitness',
  equipmentTier: 'commercial_gym',
  daysPerWeek: 3,
  sessionMinutes: 40,
  programWeeks: 4, // 1 to 4 week progressive block
  jointFlags: {
    knee: false,
    shoulder: false,
    lower_back: false,
  },
  notes: '',
  name: '',
  sex: '', // female | male | other | '' (used for reference ranges and pregnancy questions only)
  health: EMPTY_HEALTH,
  baselines: [], // fitness test history, newest first
  labs: null, // { date, source, markers: [{ id, name, value, unit }] } — never the image itself
  preferences: { specificGoal: '', goalWhy: '', activity: '', sports: '', timeOfDay: '', likes: [], dislikes: [] },
};

/**
 * Normalizes both V1 single-week plans (plan.days) and V2 multi-week plans (plan.weeks)
 * so existing backups load cleanly with zero migration issues.
 */
function isUsableWeeks(weeks) {
  return (
    Array.isArray(weeks) &&
    weeks.length > 0 &&
    weeks.every(
      (w) =>
        w &&
        Array.isArray(w.days) &&
        w.days.length > 0 &&
        w.days.every((d) => d && Array.isArray(d.exercises))
    )
  );
}

/**
 * Normalizes both V1 single-week plans (plan.days) and V2 multi-week plans (plan.weeks)
 * so existing backups load cleanly with zero migration issues.
 * Returns null for anything the UI could not render (so callers never persist/crash on it).
 */
export function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  if (isUsableWeeks(plan.weeks)) return plan;
  if (Array.isArray(plan.days) && plan.days.length > 0) {
    const migrated = {
      ...plan,
      weeks: [
        {
          week_number: 1,
          week_label: 'Week 1 — Foundation',
          phase_focus: plan.program_strategy || plan.comeback_strategy || 'Build rhythm with controlled form.',
          progression_rule: plan.weekly_progression_tip || 'Keep 2–3 reps in reserve.',
          days: plan.days,
        },
      ],
    };
    return isUsableWeeks(migrated.weeks) ? migrated : null;
  }
  return null;
}

const NUMERIC_FIELDS = {
  age: [16, 85],
  heightCm: [130, 220],
  weightKg: [40, 180],
  restingHr: [40, 115],
  sleepHours: [3, 12],
  weeksAway: [0, 104],
  daysPerWeek: [2, 5],
  sessionMinutes: [25, 60],
  programWeeks: [1, 4],
};
const ENUM_FIELDS = {
  unitSystem: ['metric', 'imperial'],
  stressLevel: ['low', 'moderate', 'high'],
  energyLevel: ['low', 'moderate', 'high'],
  experience: ['beginner', 'intermediate', 'advanced'],
  goal: ['general_fitness', 'rebuild_consistency', 'strength_hypertrophy', 'fat_loss_conditioning', 'mobility_longevity'],
  equipmentTier: ['commercial_gym', 'apartment_gym', 'home_setup'],
};

/**
 * Merges untrusted data (localStorage / backup file) onto DEFAULT_PROFILE, keeping only
 * well-typed values: numbers are clamped into the same ranges the form allows, enums must
 * match, text fields must be strings. Anything else falls back to the default.
 */
export function sanitizeProfile(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...DEFAULT_PROFILE, jointFlags: { ...DEFAULT_PROFILE.jointFlags } };

  for (const [key, [min, max]] of Object.entries(NUMERIC_FIELDS)) {
    const v = src[key];
    if (v === '' || v === null || v === undefined || typeof v === 'boolean') continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[key] = Math.min(max, Math.max(min, n));
  }
  for (const [key, allowed] of Object.entries(ENUM_FIELDS)) {
    if (allowed.includes(src[key])) out[key] = src[key];
  }
  for (const key of ['bodyFatPct', 'bloodPressure', 'notes']) {
    if (typeof src[key] === 'string') out[key] = src[key];
  }
  if (typeof src.name === 'string') out.name = src.name.trim().slice(0, 30);
  if (['female', 'male', 'other'].includes(src.sex)) out.sex = src.sex;
  out.health = sanitizeHealth(src.health);
  out.baselines = sanitizeBaselines(src.baselines);
  out.labs = sanitizeLabs(src.labs);
  out.preferences = sanitizePreferences(src.preferences);
  if (src.jointFlags && typeof src.jointFlags === 'object') {
    for (const joint of Object.keys(DEFAULT_PROFILE.jointFlags)) {
      if (typeof src.jointFlags[joint] === 'boolean') out.jointFlags[joint] = src.jointFlags[joint];
    }
  }
  return out;
}

const EXERCISE_IDS = new Set(exerciseCatalog.map((e) => e.id));
const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
function sanitizePreferences(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const ids = (a) => (Array.isArray(a) ? [...new Set(a.filter((id) => EXERCISE_IDS.has(id)))].slice(0, 20) : []);
  return {
    specificGoal: text(src.specificGoal, 160),
    goalWhy: text(src.goalWhy, 200),
    activity: ['sedentary', 'light', 'active', 'very_active'].includes(src.activity) ? src.activity : '',
    sports: text(src.sports, 100),
    timeOfDay: ['morning', 'afternoon', 'evening', 'any'].includes(src.timeOfDay) ? src.timeOfDay : '',
    likes: ids(src.likes),
    dislikes: ids(src.dislikes),
  };
}

// ---- Onboarding ------------------------------------------------------------------------------------
/** True once this person finished (or skipped) the guided setup. Anyone with saved data counts as done. */
export function loadOnboarded() {
  return safeGet(KEYS.ONBOARDED) === '1' || safeGet(KEYS.PROFILE) !== null || safeGet(KEYS.PLAN) !== null;
}
export function saveOnboarded(done = true) {
  if (done) safeSet(KEYS.ONBOARDED, '1');
  else safeRemove(KEYS.ONBOARDED);
}

export function listProfiles() {
  let list = [];
  try {
    list = JSON.parse(rawGet(KEYS.PROFILES) || '[]');
  } catch {
    list = [];
  }
  list = Array.isArray(list) ? list.filter((p) => p && /^[a-z0-9]{1,16}$/.test(p.id)) : [];
  if (!list.some((p) => p.id === DEFAULT_PROFILE_ID)) list.unshift({ id: DEFAULT_PROFILE_ID, name: '' });
  return list.map((p) => {
    // A person's display name comes from their own profile, so renaming in the form is enough.
    let name = '';
    try {
      name = JSON.parse(rawGet(scoped(KEYS.PROFILE, p.id)) || '{}')?.name || '';
    } catch {
      /* ignore */
    }
    return { id: p.id, name: (name || p.name || (p.id === DEFAULT_PROFILE_ID ? 'Me' : 'New person')).slice(0, 30) };
  });
}

export function getActiveProfileId() {
  const id = activeProfileId();
  return listProfiles().some((p) => p.id === id) ? id : DEFAULT_PROFILE_ID;
}

export function switchProfile(id) {
  if (!listProfiles().some((p) => p.id === id)) return false;
  safeSet(KEYS.ACTIVE_PROFILE, id);
  return true;
}

export function createProfile(name) {
  const list = listProfiles();
  if (list.length >= 6) throw new Error('You can have up to 6 people on one device.');
  const id = Math.random().toString(36).slice(2, 10) || `p${Date.now()}`;
  const clean = String(name || '').trim().slice(0, 30) || 'New person';
  safeSet(KEYS.PROFILES, JSON.stringify([...list.map(({ id: i, name: n }) => ({ id: i, name: n })), { id, name: clean }]));
  safeSet(KEYS.ACTIVE_PROFILE, id);
  return id;
}

/** Removes a person and every key of theirs. The first person cannot be deleted. */
export function deleteProfile(id) {
  if (id === DEFAULT_PROFILE_ID) return false;
  const list = listProfiles().filter((p) => p.id !== id);
  safeSet(KEYS.PROFILES, JSON.stringify(list));
  try {
    const prefix = `mf_p_${id}__`;
    for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  if (activeProfileId() === id) safeSet(KEYS.ACTIVE_PROFILE, DEFAULT_PROFILE_ID);
  return true;
}

export function loadHealthAck() {
  return safeGet(KEYS.HEALTH_ACK) === '1';
}

export function saveHealthAck() {
  safeSet(KEYS.HEALTH_ACK, '1');
}

export function loadApiKey() {
  return safeGet(KEYS.API_KEY) || '';
}

export function saveApiKey(key) {
  const trimmed = (key || '').trim();
  if (!trimmed) {
    safeRemove(KEYS.API_KEY);
  } else {
    safeSet(KEYS.API_KEY, trimmed);
  }
}

export function loadModel() {
  return safeGet(KEYS.MODEL) || DEFAULT_MODEL;
}

export function saveModel(model) {
  safeSet(KEYS.MODEL, (model || DEFAULT_MODEL).trim());
}

export function loadProfile() {
  try {
    const raw = safeGet(KEYS.PROFILE);
    return raw ? sanitizeProfile(JSON.parse(raw)) : sanitizeProfile(null);
  } catch {
    return sanitizeProfile(null);
  }
}

export function saveProfile(profile) {
  safeSet(KEYS.PROFILE, JSON.stringify(profile));
}

export function loadPlan() {
  try {
    const raw = safeGet(KEYS.PLAN);
    return raw ? normalizePlan(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function savePlan(plan) {
  const normalized = normalizePlan(plan);
  if (normalized) safeSet(KEYS.PLAN, JSON.stringify(normalized));
}

export function loadFeedbackHistory() {
  try {
    const raw = safeGet(KEYS.FEEDBACK);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function appendFeedback(entry) {
  const list = loadFeedbackHistory();
  const next = [{ ...entry, createdAt: new Date().toISOString() }, ...list].slice(0, 20);
  safeSet(KEYS.FEEDBACK, JSON.stringify(next));
  return next;
}


// ---- Workout logs -------------------------------------------------------------------------------
// One entry per exercise per session: { id, ts, exercise_id, weekNumber, dayTitle, rpe, sets: [{ reps, weightKg }] }.
// Weights are always stored in kg so switching the unit system never corrupts history.
const MAX_LOG_ENTRIES = 800;

export function sanitizeLogs(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object' || typeof e.exercise_id !== 'string' || !Array.isArray(e.sets)) continue;
    const ts = Number(e.ts);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const sets = e.sets
      .map((s) => ({
        reps: Math.max(0, Math.min(200, Math.round(Number(s?.reps) || 0))),
        weightKg: Math.max(0, Math.min(1000, Number(Number(s?.weightKg).toFixed(2)) || 0)),
      }))
      .filter((s) => s.reps > 0)
      .slice(0, 12);
    if (sets.length === 0) continue;
    const rpe = Number(e.rpe);
    out.push({
      id: typeof e.id === 'string' && e.id ? e.id.slice(0, 60) : `log_${ts}`,
      ts,
      exercise_id: e.exercise_id.slice(0, 60),
      weekNumber: Number.isFinite(Number(e.weekNumber)) ? Number(e.weekNumber) : null,
      dayTitle: typeof e.dayTitle === 'string' ? e.dayTitle.slice(0, 80) : '',
      rpe: rpe >= 1 && rpe <= 10 ? rpe : null,
      sets,
    });
  }
  // Newest first, capped so storage can't grow without bound.
  return out.sort((a, b) => b.ts - a.ts).slice(0, MAX_LOG_ENTRIES);
}

export function loadWorkoutLogs() {
  try {
    return sanitizeLogs(JSON.parse(safeGet(KEYS.WORKOUT_LOGS) || '[]'));
  } catch {
    return [];
  }
}

export function saveWorkoutLogs(logs) {
  const clean = sanitizeLogs(logs);
  safeSet(KEYS.WORKOUT_LOGS, JSON.stringify(clean));
  return clean;
}

// ---- Ask-your-coach chat ------------------------------------------------------------------------
const MAX_CHAT_MESSAGES = 30;

export function sanitizeChat(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === 'user' || m.role === 'coach') && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role, text: m.text.slice(0, 6000), photos: Math.max(0, Math.min(3, Number(m.photos) || 0)) }))
    .slice(-MAX_CHAT_MESSAGES);
}

export function loadCoachChat() {
  try {
    return sanitizeChat(JSON.parse(safeGet(KEYS.COACH_CHAT) || '[]'));
  } catch {
    return [];
  }
}

export function saveCoachChat(messages) {
  safeSet(KEYS.COACH_CHAT, JSON.stringify(sanitizeChat(messages)));
}

/**
 * Exports user profile, saved routine, weekly feedback and workout logs.
 * Explicitly EXCLUDES the Gemini API key for safety.
 */
export function exportBackupJson() {
  const logs = loadWorkoutLogs();

  const payload = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    profile: loadProfile(),
    activePlan: loadPlan(),
    feedbackHistory: loadFeedbackHistory(),
    workoutLogs: logs,
  };

  return JSON.stringify(payload, null, 2);
}

export function importBackupJson(jsonText) {
  const data = JSON.parse(jsonText);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Backup file is not a Repwise export.');
  }
  const skipped = [];

  if (data.profile !== undefined) {
    if (data.profile && typeof data.profile === 'object') saveProfile(sanitizeProfile(data.profile));
    else skipped.push('profile');
  }
  if (data.activePlan) {
    // Never overwrite the current plan with something the UI can't render.
    const plan = normalizePlan(data.activePlan);
    if (plan) savePlan(plan);
    else skipped.push('activePlan');
  }
  if (Array.isArray(data.feedbackHistory)) {
    const clean = data.feedbackHistory.filter((f) => f && typeof f === 'object').slice(0, 20);
    safeSet(KEYS.FEEDBACK, JSON.stringify(clean));
  }
  if (Array.isArray(data.workoutLogs)) {
    saveWorkoutLogs(data.workoutLogs);
  }
  return {
    profile: loadProfile(),
    activePlan: loadPlan(),
    feedbackHistory: loadFeedbackHistory(),
    workoutLogs: loadWorkoutLogs(),
    skipped,
  };
}
