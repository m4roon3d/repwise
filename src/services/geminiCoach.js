/**
 * Gemini orchestration (the only module that talks to the SDK). Supporting code lives in ./coach:
 *   schemas.js     JSON schemas + system prompt        validate.js     parse / clamp / de-duplicate model output
 *   prompts.js     prompt builders                     localEngine.js  keyless plans, swaps, adaptation, chat parser
 */
import { EXERCISE_MAP, computeReadinessMetrics } from './catalogFilter';
import { SYSTEM_INSTRUCTION, DEFAULT_STRATEGY, DAY_ITEM_SCHEMA, COMPACT_BLOCK_SCHEMA, SWAP_RESPONSE_SCHEMA, INTAKE_CHAT_SCHEMA } from './coach/schemas';
import { parseGeminiJson, enforceWeeklyVariety } from './coach/validate';
import { buildIntakePrompt, buildPlanPrompt, buildSwapPrompt, buildAdaptPrompt, ASK_SYSTEM_INSTRUCTION, buildAskContext } from './coach/prompts';
import { summarizeLogsForPrompt } from './progress';
import { buildDeterministicFallbackPlan, localIntakeTurn, localSwap, localAdaptDay } from './coach/localEngine';

// Public API (kept stable): everything the UI and tests import comes from this file.
export { parseGeminiJson, enforceWeeklyVariety, resolveSwapConflict, carryProgression } from './coach/validate';
export { parseIntakeKeywords, parseDayConstraint, startingRpe } from './coach/localEngine';

// The SDK is ~450 kB: load it only when a request actually goes to Gemini, so keyless (local engine)
// users never download it.
let sdkPromise = null;

function loadSdk() {
  // One shared download for concurrent callers; a failed load (e.g. offline) is not cached, so the next call retries.
  sdkPromise ||= import('@google/genai').catch((err) => {
    sdkPromise = null;
    throw err;
  });
  return sdkPromise;
}

async function getAI(apiKey) {
  const { GoogleGenAI } = await loadSdk();
  return new GoogleGenAI({ apiKey });
}

/**
 * Calls Gemini and parses its JSON. If the reply is unusable (empty, not JSON, or fails `check`) it asks once more,
 * since a second sample usually fixes a one-off malformed reply. Network / auth / quota errors are thrown
 * straight away (retrying those would only double the wait), and so are token-limit cut-offs, which repeat.
 */
async function requestJson(ai, request, check) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await ai.models.generateContent(request);
    try {
      const parsed = parseGeminiJson(response);
      check?.(parsed);
      return parsed;
    } catch (err) {
      lastErr = err;
      if (response?.candidates?.[0]?.finishReason === 'MAX_TOKENS') break;
    }
  }
  throw lastErr;
}

const mustBeObject = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Gemini returned an unexpected shape.');
};

export async function testGeminiConnection(apiKey, model) {
  if (!apiKey) throw new Error('Please paste your Gemini API key first.');
  const ai = await getAI(apiKey);
  const response = await ai.models.generateContent({
    model,
    contents: 'Reply with strictly the word READY.',
    config: { temperature: 0 },
  });
  return (response?.text || '').trim();
}

export async function runCoachIntakeTurn(messages, currentProfile, apiKey, model) {
  if (!apiKey) return localIntakeTurn(messages);

  const ai = await getAI(apiKey);
  const prompt = buildIntakePrompt(messages, currentProfile);

  const parsed = await requestJson(
    ai,
    {
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: INTAKE_CHAT_SCHEMA,
        temperature: 0.4,
        maxOutputTokens: 16384,
      },
    },
    mustBeObject
  );
  return { ...parsed, source: 'gemini' };
}

export async function generateAdaptivePlan(
  profile,
  safeExercises,
  apiKey,
  model,
  recentFeedback = [],
  logSummary = ''
) {
  const metrics = computeReadinessMetrics(profile);
  const totalWeeks = Math.max(1, Math.min(4, Number(profile.programWeeks) || 4));

  if (!apiKey) {
    return buildDeterministicFallbackPlan(profile, safeExercises, metrics, totalWeeks);
  }

  const ai = await getAI(apiKey);
  const prompt = buildPlanPrompt(profile, safeExercises, metrics, totalWeeks, recentFeedback, logSummary);

  const dayCount = Math.max(2, Math.min(5, Number(profile.daysPerWeek) || 3));
  let cleanedDays = [];
  const parsed = await requestJson(
    ai,
    {
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: COMPACT_BLOCK_SCHEMA,
        temperature: 0.4,
        maxOutputTokens: 65536,
      },
    },
    (p) => {
      mustBeObject(p);
      cleanedDays = enforceWeeklyVariety(p.base_days, safeExercises).slice(0, dayCount);
      if (!cleanedDays.some((d) => d.exercises.length > 0)) {
        throw new Error('Gemini returned a plan with no usable exercises.');
      }
    }
  );
  // Backfill missing / empty days (model under-delivered or hallucinated every ID) from the local engine.
  let fallbackDays = null;
  const cleanBaseDays = Array.from({ length: dayCount }, (_, i) => {
    const d = cleanedDays[i];
    if (d && d.exercises.length > 0) return d;
    fallbackDays ||= buildDeterministicFallbackPlan(profile, safeExercises, metrics, 1).weeks[0].days;
    return fallbackDays[i];
  });

  const defaultProgression = (i) => ({
    week_number: i + 1,
    week_label: `Week ${i + 1}`,
    phase_focus: i === 0 ? 'Foundation & technique.' : 'Steady progressive build.',
    progression_rule: 'Add 1–2 clean reps before nudging weight up.',
    rpe_delta: i === 0 ? 0 : Math.min(1.0, i * 0.5),
    set_delta: i >= 2 ? 1 : 0,
    rep_delta: i === 1 ? 1 : 0,
  });
  const modelProgressions = Array.isArray(parsed.week_progressions) ? parsed.week_progressions : [];
  // Always exactly `totalWeeks` entries: trust the model where it delivered, default the rest.
  const rawProgressions = Array.from({ length: totalWeeks }, (_, i) => modelProgressions[i] || defaultProgression(i));

  const expandedWeeks = rawProgressions.map((wp, wIdx) => {
    const rpeDelta = Math.max(-1, Math.min(1.5, Number(wp.rpe_delta) || 0));
    const setDelta = Math.max(-1, Math.min(1, Math.round(Number(wp.set_delta) || 0)));
    const repDelta = Math.max(-2, Math.min(3, Math.round(Number(wp.rep_delta) || 0)));

    return {
      week_number: Number(wp.week_number) || wIdx + 1,
      week_label: wp.week_label || `Week ${wIdx + 1}`,
      phase_focus: wp.phase_focus || 'Controlled progression with crisp form.',
      progression_rule: wp.progression_rule || 'Prioritize smooth tempo and recovery.',
      days: cleanBaseDays.map((day, dIdx) => ({
        ...day,
        day_id: `w${wIdx + 1}_d${dIdx + 1}`,
        exercises: day.exercises.map((item, exIdx) => {
          const meta = EXERCISE_MAP[item.exercise_id];
          const isMobility = meta?.movement_pattern === 'mobility';
          const nextSets = isMobility
            ? item.sets
            : Math.max(2, Math.min(5, item.sets + (exIdx < 2 ? setDelta : 0)));
          const nextRepMin = Math.max(4, item.rep_min + (isMobility ? 0 : repDelta));
          const nextRepMax = Math.max(nextRepMin + 2, item.rep_max + (isMobility ? 0 : repDelta));
          const nextRpe = isMobility
            ? item.target_rpe
            : Math.max(5.5, Math.min(9.0, Number((item.target_rpe + rpeDelta).toFixed(1))));

          return {
            ...item,
            sets: nextSets,
            rep_min: nextRepMin,
            rep_max: nextRepMax,
            target_rpe: nextRpe,
          };
        }),
      })),
    };
  });

  return {
    program_title: parsed.program_title,
    coach_summary: parsed.coach_summary,
    program_strategy: parsed.program_strategy || parsed.comeback_strategy || DEFAULT_STRATEGY,
    weekly_progression_tip: parsed.weekly_progression_tip,
    weeks: expandedWeeks,
    source: 'gemini',
    modelUsed: model,
    equipmentTier: profile.equipmentTier,
    unitSystem: profile.unitSystem,
    readinessScore: metrics.readinessScore,
    bmi: metrics.bmi,
    generatedAt: new Date().toISOString(),
  };
}

export async function swapExercise(
  currentItem,
  reason,
  profile,
  safeExercises,
  apiKey,
  model,
  dayExerciseIds = [],
  weekExerciseIds = []
) {
  const currentMeta = EXERCISE_MAP[currentItem.exercise_id];
  const dayExclude = new Set([currentItem.exercise_id, ...dayExerciseIds]);
  const weekUsedSet = new Set(weekExerciseIds);

  // Strictly exclude every exercise already on the same day
  const candidates = safeExercises.filter((e) => !dayExclude.has(e.id));
  const fallbackPool =
    candidates.length > 0
      ? candidates
      : safeExercises.filter((e) => e.id !== currentItem.exercise_id);

  const samePattern = fallbackPool.filter(
    (e) => currentMeta && e.movement_pattern === currentMeta.movement_pattern
  );
  const freshSamePattern = samePattern.filter((e) => !weekUsedSet.has(e.id));
  const freshAny = fallbackPool.filter((e) => !weekUsedSet.has(e.id));

  const preferredPool =
    freshSamePattern.length > 0
      ? freshSamePattern
      : samePattern.length > 0
      ? samePattern
      : freshAny.length > 0
      ? freshAny
      : fallbackPool;

  if (!apiKey) return localSwap(currentItem, reason, profile, preferredPool, fallbackPool);

  const ai = await getAI(apiKey);
  const candidateIds = new Set(fallbackPool.map((e) => e.id));
  const prompt = buildSwapPrompt(currentItem, currentMeta, reason, profile, fallbackPool);

  const parsed = await requestJson(
    ai,
    {
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: SWAP_RESPONSE_SCHEMA,
        temperature: 0.3,
        maxOutputTokens: 16384,
      },
    },
    mustBeObject
  );
  if (!candidateIds.has(parsed.exercise_id)) {
    parsed.exercise_id = (preferredPool[0] || fallbackPool[0]).id;
  }
  return { ...parsed, source: 'gemini' };
}

export async function adaptSingleDay(dayPlan, constraint, profile, safeExercises, apiKey, model) {
  if (!apiKey) return localAdaptDay(dayPlan, constraint, safeExercises);

  const ai = await getAI(apiKey);

  const prompt = buildAdaptPrompt(dayPlan, constraint, safeExercises);

  let dedupedDay;
  await requestJson(
    ai,
    {
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: DAY_ITEM_SCHEMA,
        temperature: 0.35,
        maxOutputTokens: 16384,
      },
    },
    (p) => {
      mustBeObject(p);
      [dedupedDay] = enforceWeeklyVariety([p], safeExercises);
      if (!dedupedDay.exercises.length) {
        throw new Error('Gemini returned no valid exercises for that request. Try rephrasing it.');
      }
    }
  );
  return {
    ...dedupedDay,
    day_id: dayPlan.day_id,
    adaptedBanner: `AI adapted for: "${constraint}"`,
  };
}

/**
 * Free-form question to the coach. `messages` is the chat so far ({ role: 'user' | 'coach', text }) and must end with the
 * question being asked. `photos` ({ mimeType, data }) are attached to that last question only.
 * Needs a Gemini key: there is no local fallback for open questions.
 */
export async function askCoach({ messages, profile, plan, logs = [], focusExerciseId, photos = [], apiKey, model }) {
  if (!apiKey) throw new Error('Ask Your Coach needs a Gemini API key. Add one in Settings.');
  const turns = (messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'coach') && typeof m.text === 'string' && m.text.trim())
    .slice(-12);
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') throw new Error('Type a question first.');

  const last = turns.length - 1;
  const contents = turns.map((m, i) => {
    const parts = [{ text: m.text.slice(0, 2000) + (m.photos && i < last ? ' [photo attached]' : '') }];
    if (i === last) for (const p of photos.slice(0, 3)) parts.push({ inlineData: { mimeType: p.mimeType, data: p.data } });
    return { role: m.role === 'coach' ? 'model' : 'user', parts };
  });

  const system = `${ASK_SYSTEM_INSTRUCTION}\n\nCONTEXT:\n${buildAskContext({
    profile,
    plan,
    logSummary: summarizeLogsForPrompt(logs, profile?.unitSystem),
    focusExercise: focusExerciseId ? EXERCISE_MAP[focusExerciseId] : null,
  })}`;

  const ai = await getAI(apiKey);
  let finishReason;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: { systemInstruction: system, temperature: 0.5, maxOutputTokens: 8192 },
    });
    const text = (response?.text || '').trim();
    if (text) return text;
    finishReason = response?.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS' || finishReason === 'SAFETY') break;
  }
  throw new Error(
    finishReason === 'SAFETY'
      ? 'Gemini declined to answer that one. Try rewording it.'
      : 'The coach sent back an empty reply. Try asking again or rephrasing.'
  );
}
