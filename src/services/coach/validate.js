// Everything that treats model output as untrusted: parsing, clamping, de-duplication.
import { EXERCISE_MAP } from '../catalogFilter';

export function parseGeminiJson(response) {
  const finishReason = response?.candidates?.[0]?.finishReason;
  const raw = (response?.text || '').trim();

  if (!raw) {
    if (finishReason === 'MAX_TOKENS') {
      throw new Error(
        'Gemini hit its output token limit before writing JSON. Try switching to gemini-3.8-flash or gemini-2.5-flash in Settings.'
      );
    }
    throw new Error(`Gemini returned an empty response (${finishReason || 'unknown'}).`);
  }

  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    if (finishReason === 'MAX_TOKENS') {
      throw new Error(
        'Response was cut off by the model token limit. Please tap Generate again or switch to a faster Flash model in Settings.'
      );
    }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // Fall through
      }
    }
    throw new Error(`Could not parse Gemini JSON (${finishReason || 'parse error'}): ${err.message}`);
  }
}

/**
 * Picks the least-used safe exercise matching a movement pattern that is not already in `dayUsed`.
 * Guarantees high variety across days instead of always picking index 0.
 */
export function pickLeastUsedExercise(safeExercises, pattern, dayUsed, weekUsage) {
  const byPattern = safeExercises.filter(
    (e) => e.movement_pattern === pattern && !dayUsed.has(e.id)
  );
  const pool =
    byPattern.length > 0
      ? byPattern
      : safeExercises.filter((e) => !dayUsed.has(e.id));

  if (pool.length === 0) return null;

  let best = pool[0];
  let bestCount = weekUsage.get(best.id) || 0;
  for (let i = 1; i < pool.length; i++) {
    const c = weekUsage.get(pool[i].id) || 0;
    if (c < bestCount) {
      best = pool[i];
      bestCount = c;
    }
  }
  return best;
}

export function clampRepRange(rawMin, rawMax) {
  const repMin = Math.max(4, Number(rawMin) || 8);
  const repMax = Math.max(repMin + 1, 6, Number(rawMax) || 12);
  return { rep_min: repMin, rep_max: repMax };
}

/**
 * Post-processes generated days (from Gemini OR local engine) to guarantee:
 * 1. Only valid IDs from safeExercises exist.
 * 2. Zero duplicate exercise_ids within any single day.
 * 3. Cross-day variety: if an exercise_id repeats on a later day and an unused safe
 *    exercise in the same movement_pattern exists, automatically rotate to it.
 */
export function enforceWeeklyVariety(days, safeExercises) {
  const allowedIds = new Set(safeExercises.map((e) => e.id));
  const weekUsage = new Map();

  return (days || []).map((day, dIdx) => {
    const dayUsed = new Set();
    const cleanedExercises = [];

    for (const rawItem of day.exercises || []) {
      if (!allowedIds.has(rawItem.exercise_id)) continue;

      let chosenId = rawItem.exercise_id;
      const meta = EXERCISE_MAP[chosenId];
      const pattern = meta?.movement_pattern;
      const currentWeekCount = weekUsage.get(chosenId) || 0;

      if (dayUsed.has(chosenId)) {
        // Hard intra-day duplicate: replace with least-used alternative in same pattern
        const alt = pickLeastUsedExercise(safeExercises, pattern, dayUsed, weekUsage);
        if (!alt) continue;
        chosenId = alt.id;
      } else if (currentWeekCount > 0 && pattern) {
        // Already used on an earlier day this week: check if an unused same-pattern move exists
        const unusedSamePattern = safeExercises.find(
          (e) =>
            e.movement_pattern === pattern &&
            !dayUsed.has(e.id) &&
            (weekUsage.get(e.id) || 0) < currentWeekCount
        );
        if (unusedSamePattern) {
          chosenId = unusedSamePattern.id;
        }
      }

      dayUsed.add(chosenId);
      weekUsage.set(chosenId, (weekUsage.get(chosenId) || 0) + 1);

      cleanedExercises.push({
        ...rawItem,
        exercise_id: chosenId,
        sets: Math.max(1, Math.min(5, Number(rawItem.sets) || 3)),
        ...clampRepRange(rawItem.rep_min, rawItem.rep_max),
        target_rpe: Math.max(5.5, Math.min(9, Number(rawItem.target_rpe) || 7)),
        rest_seconds: Math.max(30, Math.min(180, Number(rawItem.rest_seconds) || 75)),
      });
    }

    return {
      ...day,
      day_id: day.day_id || `day_${dIdx + 1}`,
      warmup_checklist: Array.isArray(day.warmup_checklist)
        ? day.warmup_checklist.slice(0, 4)
        : [],
      exercises: cleanedExercises,
    };
  });
}

/**
 * A swap is computed against the plan as it was when the user tapped, but another swap may have
 * landed on the same day in the meantime. Re-check against the latest day before applying:
 * returns the replacement unchanged, a same-pattern alternative, or null when nothing fits.
 */
export function resolveSwapConflict(replacement, otherDayIds, safeExercises) {
  if (!otherDayIds.includes(replacement.exercise_id)) return replacement;
  const pattern = EXERCISE_MAP[replacement.exercise_id]?.movement_pattern;
  const alt = pickLeastUsedExercise(safeExercises, pattern, new Set(otherDayIds), new Map());
  if (!alt) return null;
  return {
    ...replacement,
    exercise_id: alt.id,
    swap_rationale: 'Picked a different option so the day has no duplicate exercises.',
  };
}

/**
 * Carries a swap into another week of the program. The new exercise keeps its own base prescription, shifted by
 * the same sets / reps / RPE progression that week had over the week the swap was made in. Mobility work has no
 * progression, so it keeps the replacement's own prescription.
 */
export function carryProgression(replacement, baseItem, weekItem) {
  const isMobility = (id) => EXERCISE_MAP[id]?.movement_pattern === 'mobility';
  if (!baseItem || !weekItem || isMobility(replacement.exercise_id) || isMobility(weekItem.exercise_id)) {
    return { ...replacement };
  }
  const diff = (key) => (Number(weekItem[key]) || 0) - (Number(baseItem[key]) || 0);
  return {
    ...replacement,
    sets: Math.max(2, Math.min(5, Math.round((Number(replacement.sets) || 3) + diff('sets')))),
    target_rpe: Math.max(5.5, Math.min(9, Number(((Number(replacement.target_rpe) || 7) + diff('target_rpe')).toFixed(1)))),
    ...clampRepRange(
      (Number(replacement.rep_min) || 8) + diff('rep_min'),
      (Number(replacement.rep_max) || 12) + diff('rep_max')
    ),
  };
}
