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
import { instrument } from './usage';
import { applyRpeCap, healthAdjustments, labFinisher, sanitizeHealth } from './health';
import { buildPlanRationale } from './rationale';
import { assignDayStyles, isStrengthStyle, modalitiesOf, normalizeDoses, normalizeItem, weaveStyleDays, doseOf } from './styles';
import { sanitizeLabs, analyzeLabs, sanitizeAnalysis, previousValue, MARKER_MAP } from './labs';
import { LAB_REPORT_SCHEMA, BODY_SCAN_SCHEMA, LAB_ANALYSIS_SCHEMA, NEW_EXERCISES_SCHEMA } from './coach/schemas';
import { exercises as CATALOG, sanitizeCustomExercise, slugFor, BUILT_IN_IDS } from './catalog';
import { normalizeExtracted } from './bodyComp';
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

async function getAI(apiKey, feature = 'other') {
  const { GoogleGenAI } = await loadSdk();
  return instrument(new GoogleGenAI({ apiKey }), feature);
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
  const ai = await getAI(apiKey, 'test_connection');
  const response = await ai.models.generateContent({
    model,
    contents: 'Reply with strictly the word READY.',
    config: { temperature: 0 },
  });
  return (response?.text || '').trim();
}

export async function runCoachIntakeTurn(messages, currentProfile, apiKey, model) {
  if (!apiKey) return localIntakeTurn(messages);

  const ai = await getAI(apiKey, 'intake');
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

async function generatePlanRaw(
  profile,
  safeExercises,
  apiKey,
  model,
  recentFeedback = [],
  logSummary = '',
  bodySummary = ''
) {
  const metrics = computeReadinessMetrics(profile);
  const totalWeeks = Math.max(1, Math.min(4, Number(profile.programWeeks) || 4));

  if (!apiKey) {
    return buildDeterministicFallbackPlan(profile, safeExercises, metrics, totalWeeks);
  }

  const ai = await getAI(apiKey, 'plan');
  const prompt = buildPlanPrompt(profile, safeExercises, metrics, totalWeeks, recentFeedback, logSummary, bodySummary);

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

async function swapRaw(
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

  const ai = await getAI(apiKey, 'swap');
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

async function adaptRaw(dayPlan, constraint, profile, safeExercises, apiKey, model) {
  if (!apiKey) return localAdaptDay(dayPlan, constraint, safeExercises);

  const ai = await getAI(apiKey, 'adapt');

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
export async function askCoach({ messages, profile, plan, logs = [], bodySummary = '', focusExerciseId, photos = [], apiKey, model }) {
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
    bodySummary,
    focusExercise: focusExerciseId ? EXERCISE_MAP[focusExerciseId] : null,
  })}`;

  const ai = await getAI(apiKey, 'ask');
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

// ---- Health-aware wrappers ------------------------------------------------------------------------
// Whatever Gemini or the local engine produce, effort never exceeds the cap set by the health answers,
// and every new plan carries its "why this plan" explanation.
const capItem = (item, profile) => {
  const { rpeCap } = healthAdjustments(profile);
  return rpeCap && Number(item?.target_rpe) > rpeCap ? { ...item, target_rpe: rpeCap } : item;
};

export async function generateAdaptivePlan(profile, safeExercises, ...rest) {
  // Strength days (gym / calisthenics) come from Gemini or the local engine; yoga and cardio days are woven in.
  const styles = assignDayStyles(profile);
  const strengthStyles = styles.filter(isStrengthStyle);
  const strengthPool = safeExercises.filter((e) => modalitiesOf(e).some((m) => m === 'gym' || m === 'calisthenics'));
  let base;
  if (strengthStyles.length) {
    const sp = { ...profile, daysPerWeek: Math.max(2, strengthStyles.length), _strengthStyles: strengthStyles };
    base = await generatePlanRaw(sp, strengthPool, ...rest);
    if (strengthStyles.length === 1) base = { ...base, weeks: base.weeks.map((w) => ({ ...w, days: w.days.slice(0, 1) })) };
  } else {
    const metrics = computeReadinessMetrics(profile);
    const totalWeeks = Math.max(1, Math.min(4, Number(profile.programWeeks) || 4));
    const skel = buildDeterministicFallbackPlan({ ...profile, daysPerWeek: 2 }, strengthPool, metrics, totalWeeks);
    base = { ...skel, program_strategy: 'Yoga and cardio block: steady aerobic base and mobility, progressing a little each week.', weeks: skel.weeks.map((w) => ({ ...w, days: [] })) };
  }
  const woven = normalizeDoses(weaveStyleDays(base, profile, safeExercises), profile);
  const plan = applyRpeCap(woven, profile);
  const bodySummary = rest[4];
  const finisher = labFinisher(profile);
  const withFinisher = finisher
    ? { ...plan, weeks: plan.weeks.map((w) => ({ ...w, days: w.days.map((d) => (isStrengthStyle(d.style || 'gym') ? { ...d, finisher } : d)) })) }
    : plan;
  return { ...withFinisher, rationale: buildPlanRationale(profile, withFinisher, { bodySummary }), generated_at: Date.now() };
}

export async function swapExercise(currentItem, reason, profile, ...rest) {
  const out = await swapRaw(currentItem, reason, profile, ...rest);
  // A swapped-in hold or cardio piece needs its own kind of prescription.
  const keep = doseOf(out.exercise_id) === doseOf(currentItem.exercise_id) && doseOf(out.exercise_id) !== 'reps';
  const normalized = keep ? { ...out, ...pickDose(currentItem) } : normalizeItem({ ...out, time_sec_min: 0, minutes: 0 }, 0, profile);
  return capItem(normalized, profile);
}
const pickDose = (it) => Object.fromEntries(['dose', 'time_sec_min', 'time_sec_max', 'minutes', 'intensity', 'sets', 'target_rpe', 'rest_seconds'].filter((k) => it[k] !== undefined).map((k) => [k, it[k]]));

export async function adaptSingleDay(dayPlan, constraint, profile, ...rest) {
  const day = await adaptRaw(dayPlan, constraint, profile, ...rest);
  return { ...day, exercises: (day.exercises || []).map((e) => capItem(e, profile)) };
}

/**
 * Reads the numbers off a photo or PDF of a blood report. Returns sanitized { date, source, markers } or throws.
 * The file goes to Gemini once; only the extracted numbers are kept by the app.
 */
export async function extractLabReport({ file, apiKey, model }) {
  if (!apiKey) throw new Error('Reading a report needs a Gemini API key. You can type the values in instead.');
  const ai = await getAI(apiKey, 'lab_read');
  const parsed = await requestJson(
    ai,
    {
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Extract every numeric blood test result from this lab report. Use the test name exactly as printed, the numeric result (no ranges, no flags) and its unit. Skip anything without a number. report_date as YYYY-MM-DD if shown. If this is not a medical lab report, set is_lab_report to false and return no markers.',
            },
            { inlineData: { mimeType: file.mimeType, data: file.data } },
          ],
        },
      ],
      config: { responseMimeType: 'application/json', responseSchema: LAB_REPORT_SCHEMA, temperature: 0, maxOutputTokens: 16384 },
    },
    mustBeObject
  );
  if (parsed.is_lab_report === false) throw new Error("That doesn't look like a blood test report. Try a clearer photo of the results page.");
  const labs = sanitizeLabs({ date: parsed.report_date || '', source: 'upload', markers: parsed.markers });
  if (!labs) throw new Error('No readable results found. Try a sharper photo, or type the key values in.');
  return labs;
}

/** Reads an InBody (or similar) body-composition result sheet. Returns a sanitized scan or throws. */
export async function extractBodyScan({ file, apiKey, model }) {
  if (!apiKey) throw new Error('Reading a scan needs a Gemini API key. You can type the numbers in instead.');
  const ai = await getAI(apiKey, 'scan_read');
  const parsed = await requestJson(
    ai,
    {
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `This should be a body-composition result sheet (InBody, Tanita or similar). Extract the CURRENT test's values only (not history columns, not normal ranges). Fields: weightKg (weight), smmKg (skeletal muscle mass), bfmKg (body fat mass), pbf (percent body fat), visceralFat (visceral fat level), bmi, ffmKg (fat free mass), bmr (basal metabolic rate, kcal), tbwL (total body water), proteinKg, mineralsKg, inbodyScore, whr (waist-hip ratio), and segmental LEAN analysis in kg: leanRightArm, leanLeftArm, leanTrunk, leanRightLeg, leanLeftLeg. Use null for anything not printed. mass_unit is "kg" or "lb" as printed. test_date as YYYY-MM-DD. device = machine model if shown. If this is not a body-composition report, set is_body_composition_report false.`,
            },
            { inlineData: { mimeType: file.mimeType, data: file.data } },
          ],
        },
      ],
      config: { responseMimeType: 'application/json', responseSchema: BODY_SCAN_SCHEMA, temperature: 0, maxOutputTokens: 8192 },
    },
    mustBeObject
  );
  if (parsed.is_body_composition_report === false) throw new Error("That doesn't look like a body-composition report. Try a clearer photo of the result sheet.");
  const scan = normalizeExtracted(parsed);
  if (!scan) throw new Error('No readable values found. Try a sharper photo, or type the main numbers in.');
  return scan;
}

/**
 * Plain-language analysis of one blood report, with what it means for training and practical tips.
 * Grounded in the app's own range checks so the model explains values rather than re-judging them.
 */
export async function analyzeLabReport({ reports, reportId, profile, apiKey, model }) {
  if (!apiKey) throw new Error('AI analysis needs a Gemini API key. The basic checks and tips below still work without one.');
  const idx = reports.findIndex((r) => r.id === reportId);
  const report = reports[idx];
  if (!report) throw new Error('Report not found.');
  const { results } = analyzeLabs(report, profile?.sex);
  const lines = results.map((r) => {
    const prev = r.id ? previousValue(reports, idx, r.id) : null;
    const range = r.range ? ` [typical ${r.range.low}–${r.range.high >= 1000 ? '∞' : r.range.high} ${r.canonicalUnit}]` : '';
    const trend = prev ? ` (previous ${prev.value} ${MARKER_MAP[r.id].unit} on ${prev.date})` : '';
    return `- ${r.name}: ${r.value} ${r.unit} → ${r.status}${r.band ? ` (${r.band})` : ''}${range}${trend}`;
  });
  const h = sanitizeHealth(profile?.health);
  const ai = await getAI(apiKey, 'lab_analysis');
  const parsed = await requestJson(
    ai,
    {
      model,
      contents: `Blood report dated ${report.date}. Person: age ${profile?.age}, sex ${profile?.sex || 'not given'}, goal ${profile?.goal}, trains ${profile?.daysPerWeek} days/week, known conditions: ${h.conditions.join(', ') || 'none reported'}.
Results (status from typical adult reference ranges):
${lines.join('\n')}

Write for a non-medical reader:
- summary: 2 to 4 sentences: the overall picture and the most important thing to act on, and what improved if there is a previous value.
- overall: good | mixed | needs_attention.
- markers: ONLY for values that are low/high or changed meaningfully: meaning (what it is and why it matters, 1 to 2 sentences), training (how it should change their exercise, 1 sentence), tips (2 to 3 practical food/sleep/activity tips; Indian diet examples welcome).
- lifestyle_tips: up to 6 across nutrition, sleep, cardio, strength, lifestyle.
- training_adjustments: up to 4 short, concrete changes to their workout plan (e.g. add a 15-minute brisk walk after lifting).
- doctor_questions: up to 4 questions worth asking their doctor.
Rules: never diagnose, never give medication or supplement doses (say "ask your doctor about…"), be encouraging and specific.`,
      config: { responseMimeType: 'application/json', responseSchema: LAB_ANALYSIS_SCHEMA, temperature: 0.3, maxOutputTokens: 16384 },
    },
    (p) => {
      mustBeObject(p);
      if (!sanitizeAnalysis(p)) throw new Error('The analysis came back empty. Try again.');
    }
  );
  return sanitizeAnalysis({ ...parsed, generatedAt: Date.now() });
}

/**
 * Suggests new exercises for the library from a plain request ("kettlebell moves for shoulders").
 * Returns sanitized drafts (not saved): the person picks which to keep. Skips anything already in the library.
 */
export async function suggestExercises({ request, profile, apiKey, model, count = 4 }) {
  if (!apiKey) throw new Error('Adding exercises with AI needs a Gemini API key. Add one in Settings, or add an exercise by hand.');
  const ask = String(request || '').trim().slice(0, 300);
  if (!ask) throw new Error('Describe what you want, for example "kettlebell moves for shoulders".');
  const norm = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
  const known = new Set(CATALOG.map((e) => norm(e.name)));
  const ai = await getAI(apiKey, 'exercise_ideas');
  const parsed = await requestJson(
    ai,
    {
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                `Suggest up to ${count} well-established exercises for this request: "${ask}".`,
                `The person trains at: ${profile?.equipmentTier || 'commercial_gym'}; experience: ${profile?.experienceLevel || 'unknown'}.`,
                `Do NOT repeat any of these existing exercises: ${CATALOG.map((e) => e.name).join(', ')}.`,
                'Only safe, mainstream movements a coach would teach; no stunts. Use standard names.',
                'equipment_tiers: every setup where it can be done (home_setup = dumbbells/bands/bodyweight only).',
                'dose: reps for sets x reps, time for holds/poses in seconds, duration for continuous cardio minutes.',
                'joint_stress_flags: areas it loads hard enough to avoid when that area is injured; "impact" for jumping or running.',
                'cues: exactly 3 short coaching cues, each under 15 words.',
                `regression_id: an easier option from this list if one fits, else empty: ${[...BUILT_IN_IDS].join(', ')}.`,
              ].join('\n'),
            },
          ],
        },
      ],
      config: { responseMimeType: 'application/json', responseSchema: NEW_EXERCISES_SCHEMA, temperature: 0.4, maxOutputTokens: 8192 },
    },
    mustBeObject
  );
  const taken = new Set(CATALOG.map((e) => e.id));
  const out = [];
  for (const raw of Array.isArray(parsed.exercises) ? parsed.exercises : []) {
    const name = typeof raw?.name === 'string' ? raw.name : '';
    if (!name || known.has(norm(name))) continue;
    const id = slugFor(name, taken);
    const ex = sanitizeCustomExercise({ ...raw, id, source: 'ai' });
    if (ex) {
      taken.add(id);
      known.add(norm(name));
      out.push(ex);
    }
    if (out.length >= count) break;
  }
  if (!out.length) throw new Error('No new exercises came back for that. Try a different or more specific request.');
  return out;
}
