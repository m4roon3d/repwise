// Deterministic training-log maths: last-session lookup, next-load suggestion and prompt summaries.
// No AI involved, so it works offline and gives the same answer every time.
import { EXERCISE_MAP } from './catalogFilter';

export const KG_PER_LB = 0.45359237;

export const toDisplayWeight = (kg, unitSystem) =>
  unitSystem === 'imperial' ? Math.round((kg / KG_PER_LB) * 2) / 2 : Math.round(kg * 4) / 4;
export const fromDisplayWeight = (value, unitSystem) =>
  unitSystem === 'imperial' ? value * KG_PER_LB : value;
export const weightUnit = (unitSystem) => (unitSystem === 'imperial' ? 'lb' : 'kg');
export const formatWeight = (kg, unitSystem) => `${toDisplayWeight(kg, unitSystem)} ${weightUnit(unitSystem)}`;

const LOWER_BODY = new Set(['squat', 'hinge', 'lunge']);

/** Newest logged session for an exercise (logs are stored newest first), or null. */
export function lastSession(logs, exerciseId) {
  return (logs || []).find((l) => l.exercise_id === exerciseId) || null;
}

const heaviest = (entry) => Math.max(0, ...entry.sets.map((s) => s.weightKg));

/**
 * Double progression: earn the top of the rep range on EVERY set at the current load, then add weight.
 * Returns { action, weightKg, message } where action is start | increase | hold | reduce | reps.
 */
export function suggestNext(entry, item, unitSystem = 'metric') {
  if (!entry || !item) {
    return { action: 'start', weightKg: null, message: 'No history yet. Pick a weight you could lift for about 3 more reps than the target, then log it.' };
  }
  const unit = weightUnit(unitSystem);
  const top = heaviest(entry);
  const reps = entry.sets.map((s) => s.reps);
  const allTop = reps.every((r) => r >= item.rep_max);
  const worst = Math.min(...reps);
  const tooHard = entry.rpe != null && entry.rpe > Number(item.target_rpe) + 1;
  const pattern = EXERCISE_MAP[item.exercise_id]?.movement_pattern;

  // Bodyweight / mobility work: progress by reps and control, not load.
  if (top === 0) {
    return allTop && !tooHard
      ? { action: 'reps', weightKg: null, message: 'You hit the top of the range on every set. Slow the tempo, add a pause, or try a harder variation.' }
      : { action: 'reps', weightKg: null, message: `Aim for ${item.rep_max} clean reps on every set before making it harder.` };
  }

  const step = unitSystem === 'imperial' ? 5 : LOWER_BODY.has(pattern) ? 2.5 : 2;
  const topDisplay = toDisplayWeight(top, unitSystem);

  if (allTop && !tooHard) {
    const next = topDisplay + step;
    return { action: 'increase', weightKg: fromDisplayWeight(next, unitSystem), message: `Every set hit ${item.rep_max} reps. Go up to ${next} ${unit}.` };
  }
  if (worst < item.rep_min - 1 || tooHard) {
    const lighter = Math.max(step, Math.round((topDisplay * 0.9) / (step / 2)) * (step / 2));
    return {
      action: 'reduce',
      weightKg: fromDisplayWeight(lighter, unitSystem),
      message: tooHard ? `That felt very hard. Drop to about ${lighter} ${unit} and build back up.` : `Reps fell well short. Drop to about ${lighter} ${unit} and own the reps.`,
    };
  }
  return { action: 'hold', weightKg: top, message: `Stay at ${topDisplay} ${unit} and add reps. Aim for ${item.rep_max} on every set.` };
}

const day = 86400000;

/** Compact text for prompts: the most recent session per exercise, newest first. */
export function summarizeLogsForPrompt(logs, unitSystem = 'metric', maxLines = 12) {
  const seen = new Set();
  const lines = [];
  for (const l of logs || []) {
    if (seen.has(l.exercise_id)) continue;
    seen.add(l.exercise_id);
    const name = EXERCISE_MAP[l.exercise_id]?.name || l.exercise_id;
    const sets = l.sets
      .map((s) => (s.weightKg > 0 ? `${s.reps}x${toDisplayWeight(s.weightKg, unitSystem)}` : `${s.reps}`))
      .join(', ');
    const ago = Math.max(0, Math.round((Date.now() - l.ts) / day));
    lines.push(`- ${name}: ${sets}${weightUnitTag(l, unitSystem)}${l.rpe ? ` @RPE ${l.rpe}` : ''} (${ago === 0 ? 'today' : `${ago}d ago`})`);
    if (lines.length >= maxLines) break;
  }
  return lines.join('\n');
}
const weightUnitTag = (l, u) => (l.sets.some((s) => s.weightKg > 0) ? ` ${weightUnit(u)}` : ' reps');

/** Whole-history counts for a small "you've done X" line. */
export function logStats(logs) {
  const sessions = new Set((logs || []).map((l) => new Date(l.ts).toDateString()));
  const week = (logs || []).filter((l) => Date.now() - l.ts < 7 * day);
  return { sessions: sessions.size, exercisesThisWeek: week.length };
}
