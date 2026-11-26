// JSON-schema contracts and system prompt for the Gemini calls.

// Schema type names (same string values as the SDK's `Type` enum). Declared locally so this module
// doesn't need the SDK at load time.
export const Type = {
  OBJECT: 'OBJECT',
  ARRAY: 'ARRAY',
  STRING: 'STRING',
  INTEGER: 'INTEGER',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
};

export const SYSTEM_INSTRUCTION = `You are Repwise, a pragmatic, evidence-based strength and general fitness coach for people of every level.
Rules:
1. NEVER provide medical diagnoses or medical prescriptions. Frame all guidance strictly as fitness programming and movement selection.
2. You MUST ONLY pick exercise_id values from the provided ALLOWED_EXERCISES JSON array. Never invent IDs.
3. Match intensity to the trainee's experience: beginners and anyone returning after a layoff get sustainable adherence, joint comfort and controlled RPE progression over burnout volume; experienced trainees can progress load, sets and RPE more assertively.
4. Maximize exercise variety across days of the week: NEVER duplicate an exercise_id within the same day, and avoid repeating the same exercise_id across different days whenever another safe exercise exists for that movement pattern.
5. Keep every coach_note concise (under 14 words).
6. Output ONLY valid JSON matching the requested schema.`;

export const DEFAULT_STRATEGY =
  'Progressive overload: start with technique and manageable intensity, then build reps, sets and load week by week.';

export const DAY_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    day_id: { type: Type.STRING },
    day_label: { type: Type.STRING },
    focus: { type: Type.STRING },
    estimated_minutes: { type: Type.INTEGER },
    warmup_checklist: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    exercises: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          exercise_id: { type: Type.STRING },
          sets: { type: Type.INTEGER },
          rep_min: { type: Type.INTEGER },
          rep_max: { type: Type.INTEGER },
          target_rpe: { type: Type.NUMBER },
          rest_seconds: { type: Type.INTEGER },
          coach_note: { type: Type.STRING },
        },
        required: [
          'exercise_id',
          'sets',
          'rep_min',
          'rep_max',
          'target_rpe',
          'rest_seconds',
          'coach_note',
        ],
      },
    },
  },
  required: [
    'day_id',
    'day_label',
    'focus',
    'estimated_minutes',
    'warmup_checklist',
    'exercises',
  ],
};

export const COMPACT_BLOCK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    program_title: { type: Type.STRING },
    coach_summary: { type: Type.STRING },
    program_strategy: { type: Type.STRING },
    weekly_progression_tip: { type: Type.STRING },
    base_days: {
      type: Type.ARRAY,
      items: DAY_ITEM_SCHEMA,
    },
    week_progressions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          week_number: { type: Type.INTEGER },
          week_label: { type: Type.STRING },
          phase_focus: { type: Type.STRING },
          progression_rule: { type: Type.STRING },
          rpe_delta: { type: Type.NUMBER },
          set_delta: { type: Type.INTEGER },
          rep_delta: { type: Type.INTEGER },
        },
        required: [
          'week_number',
          'week_label',
          'phase_focus',
          'progression_rule',
          'rpe_delta',
          'set_delta',
          'rep_delta',
        ],
      },
    },
  },
  required: [
    'program_title',
    'coach_summary',
    'program_strategy',
    'weekly_progression_tip',
    'base_days',
    'week_progressions',
  ],
};

export const SWAP_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    exercise_id: { type: Type.STRING },
    sets: { type: Type.INTEGER },
    rep_min: { type: Type.INTEGER },
    rep_max: { type: Type.INTEGER },
    target_rpe: { type: Type.NUMBER },
    rest_seconds: { type: Type.INTEGER },
    coach_note: { type: Type.STRING },
    swap_rationale: { type: Type.STRING },
  },
  required: [
    'exercise_id',
    'sets',
    'rep_min',
    'rep_max',
    'target_rpe',
    'rest_seconds',
    'coach_note',
    'swap_rationale',
  ],
};

export const INTAKE_CHAT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    coach_reply: { type: Type.STRING },
    ready_to_generate: { type: Type.BOOLEAN },
    profile_patch: {
      type: Type.OBJECT,
      properties: {
        age: { type: Type.INTEGER },
        heightCm: { type: Type.INTEGER },
        weightKg: { type: Type.NUMBER },
        restingHr: { type: Type.INTEGER },
        sleepHours: { type: Type.NUMBER },
        stressLevel: { type: Type.STRING },
        weeksAway: { type: Type.INTEGER },
        experience: { type: Type.STRING },
        energyLevel: { type: Type.STRING },
        goal: { type: Type.STRING },
        equipmentTier: { type: Type.STRING },
        daysPerWeek: { type: Type.INTEGER },
        sessionMinutes: { type: Type.INTEGER },
        programWeeks: { type: Type.INTEGER },
        protectKnee: { type: Type.BOOLEAN },
        protectShoulder: { type: Type.BOOLEAN },
        protectLowerBack: { type: Type.BOOLEAN },
        notesAppend: { type: Type.STRING },
      },
    },
  },
  required: ['coach_reply', 'ready_to_generate', 'profile_patch'],
};

export const LAB_REPORT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    is_lab_report: { type: Type.BOOLEAN },
    report_date: { type: Type.STRING },
    markers: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          value: { type: Type.NUMBER },
          unit: { type: Type.STRING },
        },
        required: ['name', 'value'],
      },
    },
  },
  required: ['is_lab_report', 'markers'],
};

const num = { type: Type.NUMBER, nullable: true };
export const BODY_SCAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    is_body_composition_report: { type: Type.BOOLEAN },
    device: { type: Type.STRING },
    test_date: { type: Type.STRING },
    mass_unit: { type: Type.STRING },
    weightKg: num, smmKg: num, bfmKg: num, pbf: num, visceralFat: num, bmi: num, ffmKg: num, bmr: num, tbwL: num,
    proteinKg: num, mineralsKg: num, inbodyScore: num, whr: num,
    leanRightArm: num, leanLeftArm: num, leanTrunk: num, leanRightLeg: num, leanLeftLeg: num,
  },
  required: ['is_body_composition_report'],
};
