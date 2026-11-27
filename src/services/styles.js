// Training styles: gym, calisthenics, yoga and cardio. Decides which style each training day gets, builds yoga
// and cardio days deterministically (so timing and safety are predictable), and gives timed or duration-based
// exercises their prescription and weekly progression.
import { exercises, EXERCISE_MAP as BY_ID } from './catalog';

export const STYLES = [
  { id: 'gym', label: 'Gym', icon: '🏋️', blurb: 'Weights and machines' },
  { id: 'calisthenics', label: 'Calisthenics', icon: '🤸', blurb: 'Bodyweight strength' },
  { id: 'yoga', label: 'Yoga', icon: '🧘', blurb: 'Mobility and calm' },
  { id: 'cardio', label: 'Cardio', icon: '🏃', blurb: 'Heart and lungs' },
];
const STYLE_IDS = STYLES.map((s) => s.id);
const STRENGTH = new Set(['gym', 'calisthenics']);

export const modalitiesOf = (ex) => ex?.modalities || ['gym'];
export const doseOf = (idOrEx) => (typeof idOrEx === 'string' ? BY_ID[idOrEx]?.dose : idOrEx?.dose) || 'reps';

export function sanitizeStyles(raw) {
  const list = Array.isArray(raw) ? STYLE_IDS.filter((s) => raw.includes(s)) : [];
  return list.length ? list : ['gym'];
}

/**
 * One style per training day. Strength styles (gym / calisthenics) get at least half the week when chosen;
 * yoga and cardio fill the rest, spaced between strength days. Order is stable for a given profile.
 */
export function assignDayStyles(profile) {
  const days = Math.max(2, Math.min(5, Number(profile?.daysPerWeek) || 3));
  const styles = sanitizeStyles(profile?.styles);
  const strength = styles.filter((s) => STRENGTH.has(s));
  const other = styles.filter((s) => !STRENGTH.has(s));
  if (!strength.length) return Array.from({ length: days }, (_, i) => other[i % other.length]);
  const otherDays = Math.min(other.length, days - Math.ceil(days / 2));
  const strengthDays = days - otherDays;
  const strengthSeq = Array.from({ length: strengthDays }, (_, i) => strength[i % strength.length]);
  const otherSeq = other.slice(0, otherDays);
  // Interleave: S O S O S … so recovery-style days sit between strength days.
  const out = [];
  while (strengthSeq.length || otherSeq.length) {
    if (strengthSeq.length) out.push(strengthSeq.shift());
    if (otherSeq.length) out.push(otherSeq.shift());
  }
  return out;
}

export const isStrengthStyle = (s) => STRENGTH.has(s);

export function poolFor(style, safeExercises) {
  return safeExercises.filter((e) => modalitiesOf(e).includes(style));
}

// ---- Prescriptions -------------------------------------------------------------------------------

/** Timed hold for a yoga pose or an isometric (plank, side plank). Grows 5 s a week. */
export function timeDose(ex, weekIdx, { yoga = false } = {}) {
  const base = yoga ? 30 : ex?.id === 'mountain_climbers' ? 20 : 25;
  const add = Math.min(3, weekIdx) * 5;
  return {
    sets: yoga ? 1 : 3,
    rep_min: 1,
    rep_max: 2,
    time_sec_min: base + add,
    time_sec_max: base + 15 + add,
    target_rpe: yoga ? 4 : 7,
    rest_seconds: yoga ? 10 : 45,
  };
}

const CARDIO_PLAN = [
  { label: 'Steady, Zone 2', text: 'Easy, steady pace: you can talk in full sentences.', rpe: 5, extra: 0 },
  { label: 'Steady, a bit longer', text: 'Same easy pace, a few minutes longer.', rpe: 5, extra: 3 },
  { label: 'Intervals', text: 'After a 5-minute warm-up: 6 rounds of 1 minute hard, 2 minutes easy. Easy pace to finish.', rpe: 7, extra: 0 },
  { label: 'Steady, longest', text: 'Easy pace, your longest session of the block.', rpe: 5, extra: 5 },
];

export function durationDose(profile, weekIdx) {
  const w = CARDIO_PLAN[Math.min(weekIdx, CARDIO_PLAN.length - 1)];
  const minutes = Math.max(15, Math.min(60, (Number(profile?.sessionMinutes) || 40) - 8 + w.extra));
  return { sets: 1, rep_min: 1, rep_max: 2, minutes, intensity: `${w.label}: ${w.text}`, target_rpe: w.rpe, rest_seconds: 0 };
}

/** Makes every timed / duration exercise in a plan carry the right prescription for its week. */
export function normalizeDoses(plan, profile) {
  if (!plan?.weeks) return plan;
  return {
    ...plan,
    weeks: plan.weeks.map((w, wIdx) => ({
      ...w,
      days: w.days.map((d) => ({
        ...d,
        exercises: d.exercises.map((it) => normalizeItem(it, wIdx, profile, d.style)),
      })),
    })),
  };
}

export function normalizeItem(item, weekIdx, profile, style) {
  const ex = BY_ID[item.exercise_id];
  // On a yoga day every pose is a timed hold, even moves that are rep-based on gym days (e.g. cat-cow).
  const dose = style === 'yoga' ? 'time' : doseOf(ex);
  if (dose === 'time' && !(item.time_sec_min > 0)) return { ...item, dose, ...timeDose(ex, weekIdx, { yoga: style === 'yoga' || modalitiesOf(ex).includes('yoga') && !modalitiesOf(ex).includes('calisthenics') }) };
  if (dose === 'duration' && !(item.minutes > 0)) return { ...item, dose, ...durationDose(profile, weekIdx) };
  return dose === 'reps' ? item : { ...item, dose };
}

// ---- Yoga and cardio days -------------------------------------------------------------------------

/** A yoga flow: standing poses first, then floor work, ending lying down. Rotates poses across yoga days. */
export function buildYogaDay(safeExercises, profile, yogaDayIdx = 0) {
  const pool = poolFor('yoga', safeExercises).sort((a, b) => (a.flow_order ?? 99) - (b.flow_order ?? 99));
  const count = Math.max(6, Math.min(10, Math.round((Number(profile?.sessionMinutes) || 40) / 4)));
  let picked = pool;
  if (pool.length > count) {
    // Keep the opener and the closing poses, rotate the middle.
    const middle = pool.slice(1, -2);
    const take = count - 3;
    const start = (yogaDayIdx * take) % Math.max(1, middle.length);
    const rotated = [...middle.slice(start), ...middle.slice(0, start)].slice(0, take);
    picked = [pool[0], ...rotated, ...pool.slice(-2)].sort((a, b) => (a.flow_order ?? 99) - (b.flow_order ?? 99));
  }
  return {
    style: 'yoga',
    day_title: 'Yoga Flow',
    focus: 'Mobility, breathing and recovery',
    warmup_checklist: ['1 minute of slow nasal breathing, standing tall', 'Gentle neck and shoulder rolls', 'Move slowly between poses; never force a stretch'],
    exercises: picked.map((ex) => ({ exercise_id: ex.id, coach_note: 'Breathe slowly; ease in, never force.', dose: 'time', ...timeDose(ex, 0, { yoga: true }) })),
  };
}

export function buildCardioDay(safeExercises, profile, cardioDayIdx = 0) {
  const pool = poolFor('cardio', safeExercises);
  const yoga = poolFor('yoga', safeExercises);
  const main = pool.length ? pool[cardioDayIdx % pool.length] : null;
  const cool = yoga.filter((e) => ['childs_pose', 'standing_forward_fold', 'knees_to_chest'].includes(e.id)).slice(0, 2);
  const items = [];
  if (main) items.push({ exercise_id: main.id, coach_note: 'Warm up for the first 3 minutes.', dose: 'duration', ...durationDose(profile, 0) });
  for (const c of cool) items.push({ exercise_id: c.id, coach_note: 'Cool down and let your breathing settle.', dose: 'time', ...timeDose(c, 0, { yoga: true }) });
  return {
    style: 'cardio',
    day_title: 'Cardio',
    focus: main ? `${main.name} and cool-down` : 'Conditioning',
    warmup_checklist: ['3 minutes easy on the same machine or a brisk walk', 'A few leg swings and ankle circles', 'Sip water before you start'],
    exercises: items,
  };
}

const WARMUPS = {
  gym: null,
  calisthenics: ['1 minute of jumping jacks or marching on the spot', '10 arm circles each way and 10 hip circles', '5 easy reps of your first exercise'],
};

/**
 * Takes a plan whose days are the strength days (in order) and slots yoga / cardio days into the positions
 * `assignDayStyles` chose, in every week, with each week's progression.
 */
export function weaveStyleDays(plan, profile, safeExercises) {
  const styles = assignDayStyles(profile);
  let yogaN = 0;
  let cardioN = 0;
  const extra = styles.map((s) => (s === 'yoga' ? buildYogaDay(safeExercises, profile, yogaN++) : s === 'cardio' ? buildCardioDay(safeExercises, profile, cardioN++) : null));
  return {
    ...plan,
    day_styles: styles,
    weeks: plan.weeks.map((w, wIdx) => {
      const strengthDays = [...w.days];
      const days = styles.map((s, i) => {
        if (isStrengthStyle(s)) {
          const d = strengthDays.shift() || { exercises: [] };
          return { ...d, style: s, ...(WARMUPS[s] ? { warmup_checklist: WARMUPS[s] } : {}) };
        }
        return { ...extra[i], exercises: extra[i].exercises.map((it) => normalizeItem({ ...it, time_sec_min: 0, minutes: 0 }, wIdx, profile, s)) };
      });
      return {
        ...w,
        days: days.map((d, i) => ({
          ...d,
          estimated_minutes: d.estimated_minutes || Number(profile?.sessionMinutes) || 40,
          day_id: `w${wIdx + 1}_d${i + 1}`,
          day_label: `Day ${i + 1} — ${d.style === 'yoga' ? 'Yoga Flow' : d.style === 'cardio' ? 'Cardio' : `${d.style === 'calisthenics' ? 'Calisthenics · ' : ''}${(d.day_label || d.day_title || 'Strength').replace(/^Day \d+\s*[—–-]\s*/, '')}`}`,
          day_title: d.day_title || d.day_label,
        })),
      };
    }),
  };
}

export function describeStylesForPrompt(profile) {
  const styles = assignDayStyles(profile);
  return styles.map((s, i) => `Day ${i + 1}: ${s}`).join(', ');
}
