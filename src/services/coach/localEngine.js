// Keyless (offline) engine: deterministic plans, swaps, day adaptation and chat keyword parsing.
import { EQUIPMENT_TIER_LABELS, EXERCISE_MAP } from '../catalogFilter';
import { pickLeastUsedExercise } from './validate';

/** Starting RPE for Week 1: scaled by experience, eased when recovery or training history says so. */
export function startingRpe(profile) {
  const base = { beginner: 6.5, intermediate: 7.0, advanced: 7.5 }[profile.experience] ?? 7.0;
  const eased = profile.energyLevel === 'low' || Number(profile.weeksAway) >= 8 || Number(profile.sleepHours) < 6;
  return eased ? Math.max(6.0, base - 0.5) : base;
}

/**
 * Keyword parser used when there is no API key. Whole-word / phrase matching only, so that
 * "getting back into the gym", "10 days off" or "come home late" don't trigger anything.
 */
export function parseIntakeKeywords(text) {
  const lower = String(text || '').toLowerCase();
  const patch = {};

  if (/\bknees?\b/.test(lower)) patch.protectKnee = true;
  if (/\b(shoulders?|rotator)\b/.test(lower)) patch.protectShoulder = true;
  if (
    /\b(lower[\s-]?back|lumbar|sciatic\w*)\b/.test(lower) ||
    /\b(my|sore|stiff|tight|bad|achy)\s+back\b/.test(lower) ||
    /\bback\s+(pain|ache|aches|hurts?|issues?|problems?|spasms?)\b/.test(lower)
  ) {
    patch.protectLowerBack = true;
  }

  if (/\b(home gym|home setup|home workouts?|(train|training|work out|working out|workout|exercise|exercising) at home)\b/.test(lower)) {
    patch.equipmentTier = 'home_setup';
  } else if (/\bapartment\b/.test(lower)) {
    patch.equipmentTier = 'apartment_gym';
  } else if (/\b(commercial|full gym|full-service gym)\b/.test(lower)) {
    patch.equipmentTier = 'commercial_gym';
  }

  if (/\b(tired|exhausted|fatigued?|low energy|drained)\b/.test(lower)) patch.energyLevel = 'low';

  if (/\b(beginner|brand new|never (lifted|trained|worked out)|new to (the gym|lifting|working out|training))\b/.test(lower)) {
    patch.experience = 'beginner';
  } else if (/\b(advanced|very experienced|competitive lifter|lifting for (\d{2}|[1-9]\d) years)\b/.test(lower)) {
    patch.experience = 'advanced';
  } else if (/\bintermediate\b/.test(lower)) {
    patch.experience = 'intermediate';
  }

  // "4 days a week", "3 days/week", "4d/wk", "3x/wk", "3x a week", "3 times per week"
  const dayMatch = lower.match(
    /\b(\d{1,2})\s*(?:days?\s*(?:a|per|\/)\s*(?:week|wk)|d\s*\/\s*(?:week|wk)|x\s*\/?\s*(?:a\s*)?(?:week|wk)|times?\s*(?:a|per)\s*(?:week|wk))\b/
  );
  if (dayMatch) patch.daysPerWeek = Math.max(2, Math.min(5, Number(dayMatch[1])));

  // "6 hours of sleep", "6.5 hrs sleep", "sleeping about 6 hrs"
  const sleepMatch =
    lower.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:hrs?|hours?)\s*(?:of\s*)?sleep\b/) ||
    lower.match(/\bsleep(?:ing|s)?\s*(?:about|around|roughly|~)?\s*(\d{1,2}(?:\.\d)?)\s*(?:hrs?|hours?)\b/);
  if (sleepMatch) patch.sleepHours = Number(sleepMatch[1]);

  return patch;
}

export const LOWER_PATTERNS = new Set(['squat', 'hinge', 'lunge']);

export const UPPER_PATTERNS = ['horizontal_push', 'horizontal_pull', 'vertical_push', 'vertical_pull'];

/**
 * Understands the constraints the keyless engine can actually act on (body-part focus and the
 * knee / shoulder / lower-back joints). Anything else body-part related is reported back as
 * `unsupported` so the UI never claims it adapted something it didn't.
 */
export function parseDayConstraint(text) {
  const lower = String(text || '').toLowerCase();
  const upperFocus =
    /\bupper[\s-]?body\b|\b(no|skip|avoid)\s+legs?\b|\blegs?\s+(are\s+|is\s+)?(sore|tired|fried|wrecked|dead)\b/.test(lower);
  const lowerFocus =
    /\blower[\s-]?body\b|\b(no|skip|avoid)\s+upper\b|\blegs?\s+(only|day)\b/.test(lower);
  const joints = [];
  if (/\bknees?\b/.test(lower)) joints.push('knee');
  if (/\bshoulders?\b/.test(lower)) joints.push('shoulder');
  if (
    /\b(lower[\s-]?back|lumbar|sciatic\w*)\b/.test(lower) ||
    /\b(my|sore|stiff|tight|bad|achy)\s+back\b/.test(lower) ||
    /\bback\s+(is\s+)?(pain|ache|aches|hurts?|stiff|sore|tight|issues?|problems?|spasms?)\b/.test(lower)
  ) {
    joints.push('lower_back');
  }
  const unsupported = [...new Set(lower.match(/\b(wrists?|elbows?|ankles?|hips?|necks?|hamstrings?|calf|calves|groin)\b/g) || [])];
  let focus = null;
  if (upperFocus && !lowerFocus) focus = 'upper';
  else if (lowerFocus && !upperFocus) focus = 'lower';
  return { focus, joints, unsupported };
}

/** Swaps out / drops moves that break the requested focus or joint, keeping the day full. */
export function applyLocalConstraint(items, { focus, joints }, safeExercises) {
  if (!focus && joints.length === 0) return items;
  const allowedPattern = (pattern) => {
    if (!focus) return true;
    if (pattern === 'core' || pattern === 'mobility' || pattern === 'carry') return true;
    return focus === 'upper' ? !LOWER_PATTERNS.has(pattern) : LOWER_PATTERNS.has(pattern);
  };
  const jointSafe = (e) => !e.joint_stress_flags.some((f) => joints.includes(f));
  const pool = safeExercises.filter((e) => jointSafe(e) && allowedPattern(e.movement_pattern));
  const focusPatterns = focus === 'lower' ? [...LOWER_PATTERNS] : UPPER_PATTERNS;
  const used = new Set(items.map((i) => i.exercise_id));
  const result = [];
  let cycle = 0;

  for (const item of items) {
    const meta = EXERCISE_MAP[item.exercise_id];
    const ok = meta && allowedPattern(meta.movement_pattern) && jointSafe(meta);
    if (ok) {
      result.push(item);
      continue;
    }
    used.delete(item.exercise_id);
    const wanted =
      meta && allowedPattern(meta.movement_pattern) ? meta.movement_pattern : focusPatterns[cycle++ % focusPatterns.length];
    const alt = pickLeastUsedExercise(pool, wanted, used, new Map());
    if (alt) {
      used.add(alt.id);
      result.push({ ...item, exercise_id: alt.id });
    }
  }
  return result;
}

export function localAdaptBanner(constraint, { focus, joints, unsupported }) {
  const applied = [
    focus ? `${focus}-body focus` : '',
    ...joints.map((j) => `${j.replace('_', '-')}-safe swaps`),
  ].filter(Boolean);
  let msg = `Adapted locally for: "${constraint}"`;
  if (applied.length) msg += ` (${applied.join(', ')})`;
  if (unsupported.length) {
    msg += ` — ${unsupported.join(', ')} not supported by the local engine; add a Gemini key for full adaptation.`;
  }
  return msg;
}

export function buildDeterministicFallbackPlan(profile, safeExercises, metrics, totalWeeks) {
  const count = Math.max(2, Math.min(5, Number(profile.daysPerWeek) || 3));
  const perDayCount = profile.sessionMinutes <= 30 ? 4 : profile.sessionMinutes <= 45 ? 5 : 6;
  const baseRpe = startingRpe(profile);
  const baseSets = profile.sessionMinutes <= 30 ? 2 : 3;

  const dayTemplates = [
    { label: 'Day 1 — Full Body Foundation A', focus: 'Squat, Horizontal Push, Horizontal Pull & Core', patterns: ['squat', 'horizontal_push', 'horizontal_pull', 'hinge', 'core', 'mobility'] },
    { label: 'Day 2 — Full Body Foundation B', focus: 'Hinge, Vertical Pull, Vertical Push & Carry', patterns: ['hinge', 'vertical_pull', 'vertical_push', 'lunge', 'carry', 'mobility'] },
    { label: 'Day 3 — Athletic Strength & Mobility', focus: 'Unilateral Legs, Upper Back, Press & Core', patterns: ['lunge', 'horizontal_pull', 'horizontal_push', 'squat', 'core', 'mobility'] },
    { label: 'Day 4 — Upper Posture & Conditioning', focus: 'Upper Back Volume, Shoulders & Loaded Carry', patterns: ['vertical_pull', 'vertical_push', 'horizontal_pull', 'horizontal_push', 'carry', 'mobility'] },
    { label: 'Day 5 — Lower Body & Mobility Reset', focus: 'Glutes, Hamstrings, Knee-Friendly Quads & Flow', patterns: ['squat', 'hinge', 'lunge', 'core', 'mobility', 'carry'] },
  ];

  // Track week-wide usage across ALL days so every day rotates through fresh variations
  const weekUsage = new Map();
  const baseDays = dayTemplates.slice(0, count).map((tpl, dIdx) => {
    const dayUsed = new Set();
    const picked = [];
    for (const pattern of tpl.patterns) {
      if (picked.length >= perDayCount) break;
      const ex = pickLeastUsedExercise(safeExercises, pattern, dayUsed, weekUsage);
      if (ex) {
        dayUsed.add(ex.id);
        weekUsage.set(ex.id, (weekUsage.get(ex.id) || 0) + 1);
        picked.push({ ex, pattern });
      }
    }
    return { tpl, dIdx, picked };
  });

  const weekMeta = [
    {
      label: 'Week 1 — Foundation & Technique',
      focus: 'Groove clean form and find baseline working loads.',
      rule: 'Keep 2–3 smooth reps in reserve on every set; nail tempo.',
      rpeDelta: 0,
      setDelta: 0,
      repBump: 0,
    },
    {
      label: 'Week 2 — Build Volume',
      focus: 'Match Week 1 weights and add 1–2 clean reps per set.',
      rule: 'Own the 2-second lowering phase; stay steady on rest.',
      rpeDelta: 0.5,
      setDelta: 0,
      repBump: 1,
    },
    {
      label: 'Week 3 — Controlled Strength Build',
      focus: 'Small load bump (+2.5–5%) or +1 working set on primary lifts.',
      rule: 'Push main compounds toward RPE 7.5–8.0 with crisp form.',
      rpeDelta: 0.5,
      setDelta: 1,
      repBump: 0,
    },
    {
      label: 'Week 4 — Consolidate & Recover',
      focus: 'Solidify strength gains while keeping recovery fresh.',
      rule: 'Maintain Week 3 loads with cleaner bar speed, ready for Block 2.',
      rpeDelta: 0.5,
      setDelta: 0,
      repBump: 1,
    },
  ];

  const weeks = weekMeta.slice(0, totalWeeks).map((wm, wIdx) => ({
    week_number: wIdx + 1,
    week_label: wm.label,
    phase_focus: wm.focus,
    progression_rule: wm.rule,
    days: baseDays.map(({ tpl, dIdx, picked }) => ({
      day_id: `w${wIdx + 1}_d${dIdx + 1}`,
      day_label: tpl.label,
      focus: tpl.focus,
      estimated_minutes: Number(profile.sessionMinutes) || 40,
      warmup_checklist: [
        '2 min brisk walk, bike, or march to raise core temperature',
        '6 slow World’s Greatest / Thoracic rotations per side',
        '1 light ramp-up set (~50% working weight) of your first exercise',
      ],
      exercises: picked.map(({ ex, pattern }, exIdx) => ({
        exercise_id: ex.id,
        sets:
          pattern === 'mobility'
            ? 2
            : Math.min(4, baseSets + (exIdx < 2 ? wm.setDelta : 0)),
        rep_min: 8 + wm.repBump,
        rep_max: (pattern === 'core' || pattern === 'mobility' ? 12 : 10) + wm.repBump,
        target_rpe:
          pattern === 'mobility'
            ? 6.0
            : Math.min(8.5, Number((baseRpe + wm.rpeDelta).toFixed(1))),
        rest_seconds: pattern === 'mobility' ? 45 : 75,
        coach_note:
          wIdx === 0
            ? 'Leave 2–3 smooth reps in reserve; own the technique.'
            : wIdx === 1
            ? 'Same load as Week 1—aim for 1–2 extra crisp reps.'
            : wIdx === 2
            ? 'Nudge weight up 2.5–5% if Week 2 felt smooth.'
            : 'Lock in strong technique and steady breathing.',
      })),
    })),
  }));

  return {
    program_title: `${totalWeeks}-Week Training Block (${count}d/wk)`,
    coach_summary: `Calibrated for ${EQUIPMENT_TIER_LABELS[profile.equipmentTier]} with ${safeExercises.length} joint-safe exercises unlocked. Readiness ${metrics.readinessScore}/100 — add your Gemini API key in Settings for live AI coaching, conversational intake, and custom swaps.`,
    program_strategy:
      'Progressive ramp: Week 1 sets a technique-first baseline, then steadily builds reps, sets and load across the block.',
    weekly_progression_tip:
      'Log your weekly check-in rating at the bottom of the Routine tab to steer your next AI block.',
    weeks,
    source: 'local',
    modelUsed: 'Local Deterministic Engine',
    equipmentTier: profile.equipmentTier,
    unitSystem: profile.unitSystem,
    readinessScore: metrics.readinessScore,
    bmi: metrics.bmi,
    generatedAt: new Date().toISOString(),
  };
}

export function localIntakeTurn(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.text || '';
  const patch = parseIntakeKeywords(lastUser);
  if (lastUser.trim()) patch.notesAppend = lastUser.trim();

  return {
    coach_reply:
      'Got it! I captured your notes and key flags locally. Add your Gemini API key in Settings for a full conversational AI intake—or tap "Generate Plan" below whenever you are ready.',
    ready_to_generate: true,
    profile_patch: patch,
    source: 'local',
  };

}

export function localSwap(currentItem, reason, profile, preferredPool, fallbackPool) {
  const pick = preferredPool[0] || fallbackPool[0];
  return {
    exercise_id: pick.id,
    sets: currentItem.sets,
    rep_min: currentItem.rep_min,
    rep_max: currentItem.rep_max,
    target_rpe: Math.max(
      6,
      Number(
        (
          currentItem.target_rpe -
          (reason.toLowerCase().includes('tight') || reason.toLowerCase().includes('hurt')
            ? 0.5
            : 0)
        ).toFixed(1)
      )
    ),
    rest_seconds: currentItem.rest_seconds,
    coach_note: `Swapped locally for: "${reason}". Focus on pain-free tempo.`,
    swap_rationale: `Matches ${pick.movement_pattern.replace('_', ' ')} pattern within your ${EQUIPMENT_TIER_LABELS[profile.equipmentTier]} setup.`,
    source: 'local',
  };

}

export function localAdaptDay(dayPlan, constraint, safeExercises) {
  const lower = constraint.toLowerCase();
  const parsed = parseDayConstraint(constraint);
  const minuteMatch = lower.match(/(\d{2})\s*min/);
  const targetMinutes = minuteMatch ? Math.max(15, Math.min(60, Number(minuteMatch[1]))) : null;
  const isShort = Boolean(targetMinutes && targetMinutes <= 30) || lower.includes('short') || lower.includes('quick');
  const isTired = lower.includes('sleep') || /\blow\b/.test(lower) || lower.includes('tired') || lower.includes('sore');

  const sliceCount = targetMinutes && targetMinutes <= 20 ? 3 : isShort ? 4 : dayPlan.exercises.length;
  const constrained = applyLocalConstraint(dayPlan.exercises, parsed, safeExercises);
  const nextExercises = constrained.slice(0, sliceCount).map((ex) => ({
    ...ex,
    sets: isShort || isTired ? Math.max(2, ex.sets - 1) : ex.sets,
    target_rpe: isTired ? Math.max(6, Number((ex.target_rpe - 0.5).toFixed(1))) : ex.target_rpe,
    rest_seconds: isShort ? Math.max(45, ex.rest_seconds - 15) : ex.rest_seconds,
    coach_note: isShort
      ? 'Express pace: crisp sets with tighter rest intervals.'
      : isTired
      ? 'Recovery-first tempo: prioritize clean reps over heavy load.'
      : 'Adapted locally—adjust load smoothly to match today’s feel.',
  }));

  return {
    ...dayPlan,
    estimated_minutes: targetMinutes || (isShort ? 25 : dayPlan.estimated_minutes),
    adaptedBanner: localAdaptBanner(constraint, parsed),
    exercises: nextExercises,
  };

}
