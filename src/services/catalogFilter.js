import exercises from '../data/exercises.json';

export const EXERCISE_MAP = Object.fromEntries(exercises.map((e) => [e.id, e]));

export const EQUIPMENT_TIER_LABELS = {
  commercial_gym: 'Full Commercial Gym',
  apartment_gym: 'Apartment Gym (DBs + Cables/Machines)',
  home_setup: 'Home Setup (Dumbbells / Bands / Bodyweight)',
};

export function cmToFeetInches(cm) {
  const totalInches = Math.round((Number(cm) || 175) / 2.54);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return { feet, inches };
}

export function feetInchesToCm(feet, inches) {
  const totalInches = (Number(feet) || 0) * 12 + (Number(inches) || 0);
  return Math.round(totalInches * 2.54);
}

export function kgToLbs(kg) {
  return Math.round((Number(kg) || 78) * 2.20462);
}

export function lbsToKg(lbs) {
  return Number(((Number(lbs) || 172) / 2.20462).toFixed(1));
}

export function filterSafeExercises(profile) {
  const tier = profile.equipmentTier || 'commercial_gym';
  const activeJoints = Object.entries(profile.jointFlags || {})
    .filter(([, flagged]) => Boolean(flagged))
    .map(([joint]) => joint);

  const filtered = exercises.filter((ex) => {
    const matchesTier = ex.equipment_tiers.includes(tier);
    const conflictsJoint = ex.joint_stress_flags.some((f) => activeJoints.includes(f));
    return matchesTier && !conflictsJoint;
  });

  return filtered.length >= 6
    ? filtered
    : exercises.filter((ex) => ex.joint_stress_flags.length === 0);
}

/** Numeric field or fallback. Unlike `Number(v) || d`, a legitimate 0 is kept. */
function numOr(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function computeReadinessMetrics(profile) {
  const heightM = Math.max(1.2, numOr(profile.heightCm, 175) / 100);
  const weightKg = numOr(profile.weightKg, 78) || 78;
  const bmi = Number((weightKg / (heightM * heightM)).toFixed(1));

  const rhr = numOr(profile.restingHr, 68);
  const sleep = numOr(profile.sleepHours, 7);
  const weeksAway = Math.max(0, numOr(profile.weeksAway, 4));

  const energyBonus =
    profile.energyLevel === 'high' ? 12 : profile.energyLevel === 'moderate' ? 5 : -10;
  const sleepBonus = sleep >= 7.5 ? 6 : sleep >= 6.5 ? 2 : sleep >= 5.5 ? -5 : -12;
  const stressPenalty =
    profile.stressLevel === 'high' ? -8 : profile.stressLevel === 'low' ? 4 : 0;
  const rhrPenalty = rhr > 78 ? -8 : rhr > 72 ? -3 : 4;
  const layoffPenalty = Math.min(16, Math.round(weeksAway * 1.3));
  const jointCount = Object.values(profile.jointFlags || {}).filter(Boolean).length;

  const rawScore =
    74 + energyBonus + sleepBonus + stressPenalty + rhrPenalty - layoffPenalty - jointCount * 3;
  const readinessScore = Math.max(40, Math.min(96, rawScore));

  const recommendedRpe =
    weeksAway >= 8 || profile.energyLevel === 'low' || sleep < 6
      ? 'RPE 6–7 (Leave 3–4 reps in reserve)'
      : weeksAway >= 3
      ? 'RPE 7–7.5 (Steady, sustainable build)'
      : 'RPE 7.5–8.5 (Progressive build)';

  return { bmi, readinessScore, recommendedRpe, activeJointCount: jointCount };
}
