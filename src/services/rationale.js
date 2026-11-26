// "Why this plan": every line ties a decision in the plan to something the person told us.
// Deterministic, so it works offline and never contradicts the plan it describes.
import { EQUIPMENT_TIER_LABELS, EXERCISE_MAP } from './catalogFilter';
import { healthAdjustments, injuryStatus, INJURY_AREAS, sanitizeHealth } from './health';
import { LEVEL_LABEL, latestBaseline, scoreBaseline } from './baseline';

const GOAL_WHY = {
  general_fitness: 'a balance of strength, muscle and conditioning, with moderate rep ranges (8 to 12) that build all three',
  rebuild_consistency: 'sessions that are easy to repeat, so the habit sticks before the weights go up',
  strength_hypertrophy: 'compound lifts first with progressive overload, the most reliable driver of strength and muscle',
  fat_loss_conditioning: 'full-body work with shorter rests to keep your heart rate up, while lifting heavy enough to keep muscle',
  mobility_longevity: 'controlled tempo, full range of motion and joint-friendly variations',
};

const ACTIVITY_LINE = {
  sedentary: 'You sit most of the day, so every session includes hip and upper-back mobility.',
  light: 'You are lightly active day to day, so recovery between sessions should be good.',
  active: 'You are on your feet a lot, so leg volume is kept moderate to avoid piling on fatigue.',
  very_active: 'You are very active already, so the plan adds strength without adding much extra conditioning.',
};

function planStats(plan) {
  const week = plan?.weeks?.[0];
  const days = week?.days || [];
  const items = days.flatMap((d) => d.exercises);
  const rpes = items.map((i) => Number(i.target_rpe)).filter(Number.isFinite);
  const lastWeek = plan?.weeks?.[plan.weeks.length - 1];
  const lastRpes = (lastWeek?.days || []).flatMap((d) => d.exercises).map((i) => Number(i.target_rpe)).filter(Number.isFinite);
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  return { days: days.length, perDay: days.length ? Math.round(items.length / days.length) : 0, startRpe: avg(rpes), endRpe: avg(lastRpes), weeks: plan?.weeks?.length || 0 };
}

/**
 * Returns [{ id, icon, title, text, ask }]; `ask` is a ready-made question for the coach.
 */
export function buildPlanRationale(profile, plan, { bodySummary } = {}) {
  const out = [];
  const add = (id, icon, title, text, ask) => out.push({ id, icon, title, text, ask });
  const s = planStats(plan);
  const pref = profile.preferences || {};
  const adj = healthAdjustments(profile);
  const h = sanitizeHealth(profile.health);

  add(
    'schedule',
    '📅',
    'Your schedule',
    `${s.days} days a week, about ${profile.sessionMinutes} minutes each, so each day has ${s.perDay} exercises. That is what you said you can fit in, and consistency beats a perfect plan you skip.`,
    `Why ${s.days} days and ${s.perDay} exercises per session for me?`
  );

  add(
    'goal',
    '🎯',
    'Built for your goal',
    `${pref.specificGoal ? `Your goal: "${pref.specificGoal.trim().replace(/\.$/, '')}". ` : ''}The plan focuses on ${GOAL_WHY[profile.goal] || GOAL_WHY.general_fitness}.`,
    'How does this plan move me toward my goal?'
  );

  const reasons = [];
  if (Number(profile.weeksAway) >= 3) reasons.push(`you have been away ${profile.weeksAway} weeks`);
  if (Number(profile.sleepHours) < 6) reasons.push('you are sleeping under 6 hours');
  if (profile.energyLevel === 'low') reasons.push('your energy is low right now');
  const test = latestBaseline(profile);
  const score = scoreBaseline(test, profile.age);
  if (score?.level === 'foundation') reasons.push('your fitness test showed a base to build');
  const rpe = s.startRpe ? s.startRpe.toFixed(1) : '7';
  // Only blame the health cap when it is what actually holds effort down.
  if (adj.rpeCap && s.startRpe && adj.rpeCap <= s.startRpe + 0.01) reasons.push(`your health answers cap effort at RPE ${adj.rpeCap}`);
  add(
    'intensity',
    '📈',
    'Starting effort',
    `Week 1 averages RPE ${rpe} (${Number(rpe) <= 6.5 ? '4 or more' : Number(rpe) <= 7.5 ? '2 to 3' : 'about 2'} reps left in the tank)${reasons.length ? ` because ${reasons.join(', ')}` : ` for a ${profile.experience} lifter`}.${s.weeks > 1 && s.endRpe ? ` It builds to about RPE ${s.endRpe.toFixed(1)} by week ${s.weeks}.` : ''}`,
    'Why does my plan start at this effort level, and how will it progress?'
  );

  if (test && score?.level) {
    add(
      'baseline',
      '🧪',
      'Your fitness test',
      `${LEVEL_LABEL[score.level]}: ${[test.pushups != null && `${test.pushups} ${test.pushupType === 'knee' ? 'knee ' : ''}push-ups`, test.sitToStand != null && `${test.sitToStand} chair stands`, test.plankSec != null && `${test.plankSec}s plank`].filter(Boolean).join(', ')}.${test.deepSquat === false ? ' Squats start with a box or goblet variation to build depth.' : ''}${test.overheadReach === false ? ' Overhead reach is limited, so shoulder mobility is included and pressing stays controlled.' : ''} Retest after this block to see the change.`,
      'What do my fitness test results say, and what should I work on?'
    );
  }

  const protectedAreas = INJURY_AREAS.filter((a) => injuryStatus(profile, a.id) === 'current').map((a) => a.label.toLowerCase());
  const removed = adj.exclusions.reduce((n, e) => n + e.ids.length, 0);
  if (protectedAreas.length || adj.exclusions.length) {
    add(
      'protected',
      '🛡️',
      'What we left out',
      `${protectedAreas.length ? `Exercises that load your ${protectedAreas.join(', ')} were filtered out before the plan was built. ` : ''}${adj.exclusions.map((e) => e.reason).filter((r) => !/currently sore/.test(r)).join('. ')}${removed ? ` (${removed} exercise${removed === 1 ? '' : 's'} excluded in total).` : ''}`.trim(),
      `Which exercises did you leave out for me and what should I watch for?`
    );
  }

  const conditions = h.conditions.length || h.pregnancy !== 'none' || h.betaBlocker;
  if (conditions || adj.notes.some((n) => n.kind !== 'info')) {
    add(
      'health',
      '❤️',
      'Health considerations',
      adj.notes.filter((n) => n.kind !== 'info').map((n) => n.text).join(' ') || 'Your health answers shaped the intensity and exercise choices.',
      'What should I keep in mind about my health while training?'
    );
  }

  if (adj.labs?.flagged?.length) {
    add(
      'labs',
      '🩸',
      'From your blood report',
      `${adj.labs.flagged.map((r) => `${r.name} is ${r.status}`).join(', ')}. ${adj.labs.rpeCap ? `Effort is held at RPE ${adj.labs.rpeCap} or below until that is sorted. ` : ''}${adj.labs.wantsCardio ? 'Adding 2 to 3 brisk 20-minute walks a week will help these markers. ' : ''}${adj.labs.doctor ? 'Some of these are worth discussing with your doctor.' : ''}`.trim(),
      'What do my blood report results mean for my training?'
    );
  } else if (adj.labs?.results?.length) {
    add('labs', '🩸', 'From your blood report', 'Everything we could read is within typical ranges, so it did not change the plan.', 'Is there anything in my blood report I should watch?');
  }

  if (bodySummary && !/^No /.test(bodySummary)) {
    add('body', '📊', 'Your body scan', `${bodySummary.replace(/^Latest scan /, 'From your scan on ')}. ${plan?.source === 'gemini' ? 'The coach used these to balance muscle-building volume against conditioning.' : 'Add a Gemini key and the coach will use these to fine-tune volume.'} Track every scan on the Progress tab.`, 'What do my body scan results mean for this plan?');
  }

  const extras = [];
  if (pref.activity && ACTIVITY_LINE[pref.activity]) extras.push(ACTIVITY_LINE[pref.activity]);
  if (pref.sports) extras.push(`You also do ${pref.sports}, so the plan avoids hammering the same muscles right before it.`);
  if ((pref.likes || []).length) extras.push(`Exercises you enjoy were favoured where they fit: ${(pref.likes || []).map((id) => EXERCISE_MAP[id]?.name).filter(Boolean).join(', ')}.`);
  extras.push(`Every exercise uses equipment from your ${EQUIPMENT_TIER_LABELS[profile.equipmentTier] || 'setup'}.`);
  add('you', '🙋', 'Fitted to your life', extras.join(' '), 'How could I adjust this plan around my week?');

  if (plan?.program_strategy) add('coach', '🧠', "Coach's strategy", plan.program_strategy, 'Can you explain the strategy behind my plan in more detail?');

  return out;
}
