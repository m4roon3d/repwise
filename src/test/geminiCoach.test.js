import { describe, expect, it, vi, beforeEach } from 'vitest';
import { filterSafeExercises } from '../services/catalogFilter';
import { DEFAULT_PROFILE } from '../services/storage';

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  Type: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    INTEGER: 'INTEGER',
    NUMBER: 'NUMBER',
    BOOLEAN: 'BOOLEAN',
  },
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

import {
  adaptSingleDay,
  enforceWeeklyVariety,
  generateAdaptivePlan,
  parseGeminiJson,
  swapExercise,
} from '../services/geminiCoach';

beforeEach(() => {
  mockGenerateContent.mockReset();
});

describe('Exercise Variety & Deduplication (Local Fallback Engine)', () => {
  it('never repeats an exercise within the same day across all tiers and day counts', async () => {
    for (const tier of ['commercial_gym', 'apartment_gym', 'home_setup']) {
      for (const daysPerWeek of [2, 3, 4, 5]) {
        const profile = { ...DEFAULT_PROFILE, equipmentTier: tier, daysPerWeek, sessionMinutes: 45 };
        const safe = filterSafeExercises(profile);
        const plan = await generateAdaptivePlan(profile, safe, '', 'gemini-3.8-flash');

        expect(plan.weeks.length).toBe(profile.programWeeks);
        for (const day of plan.weeks[0].days) {
          const ids = day.exercises.map((e) => e.exercise_id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }
    }
  });

  it('rotates exercises across days of the week instead of repeating the same 10 moves', async () => {
    const profile = { ...DEFAULT_PROFILE, equipmentTier: 'commercial_gym', daysPerWeek: 5, sessionMinutes: 45 };
    const safe = filterSafeExercises(profile);
    const plan = await generateAdaptivePlan(profile, safe, '', 'gemini-3.8-flash');

    const week1Ids = plan.weeks[0].days.flatMap((d) => d.exercises.map((e) => e.exercise_id));
    const uniqueCount = new Set(week1Ids).size;
    // Previously this was only 10 unique exercises out of 25 slots!
    expect(uniqueCount).toBeGreaterThanOrEqual(18);
  });

  it('progresses RPE or volume cleanly across Weeks 1 to 4', async () => {
    const profile = { ...DEFAULT_PROFILE, programWeeks: 4, daysPerWeek: 3 };
    const safe = filterSafeExercises(profile);
    const plan = await generateAdaptivePlan(profile, safe, '', 'gemini-3.8-flash');

    expect(plan.weeks).toHaveLength(4);
    const w1Rpe = plan.weeks[0].days[0].exercises[0].target_rpe;
    const w4Rpe = plan.weeks[3].days[0].exercises[0].target_rpe;
    expect(w4Rpe).toBeGreaterThanOrEqual(w1Rpe);
  });
});

describe('Gemini AI Mode — Deduplication, Token Limit Safety & Swaps', () => {
  it('deduplicates and diversifies repeated exercises returned by Gemini across days', () => {
    const safe = filterSafeExercises(DEFAULT_PROFILE);
    const rawDays = [
      {
        day_id: 'd1',
        day_label: 'Day 1',
        focus: 'Full Body A',
        estimated_minutes: 40,
        warmup_checklist: ['Walk'],
        exercises: [
          { exercise_id: 'goblet_squat', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 75, coach_note: 'Smooth' },
          { exercise_id: 'goblet_squat', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 75, coach_note: 'Duplicate' },
          { exercise_id: 'db_incline_press', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 75, coach_note: 'Smooth' },
        ],
      },
      {
        day_id: 'd2',
        day_label: 'Day 2',
        focus: 'Full Body B',
        estimated_minutes: 40,
        warmup_checklist: ['Walk'],
        exercises: [
          { exercise_id: 'goblet_squat', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 75, coach_note: 'Repeated across day' },
          { exercise_id: 'db_incline_press', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 75, coach_note: 'Repeated across day' },
        ],
      },
    ];

    const cleaned = enforceWeeklyVariety(rawDays, safe);
    // Intra-day duplicate on Day 1 replaced
    expect(new Set(cleaned[0].exercises.map((e) => e.exercise_id)).size).toBe(3);
    // Day 2 rotated away from Day 1's squat and horizontal push
    expect(cleaned[1].exercises[0].exercise_id).not.toBe('goblet_squat');
    expect(cleaned[1].exercises[1].exercise_id).not.toBe('db_incline_press');
  });

  it('expands Gemini compact base_days + week_progressions into a 4-week block', async () => {
    const safe = filterSafeExercises(DEFAULT_PROFILE);
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP' }],
      text: JSON.stringify({
        program_title: '4-Week AI Training Block',
        coach_summary: 'Tailored for your profile.',
        program_strategy: 'Gradual RPE build.',
        weekly_progression_tip: 'Log weekly feel.',
        base_days: [
          {
            day_id: 'd1',
            day_label: 'Day 1',
            focus: 'Full Body A',
            estimated_minutes: 40,
            warmup_checklist: ['2m walk'],
            exercises: [
              { exercise_id: 'goblet_squat', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 6.5, rest_seconds: 75, coach_note: 'Controlled' },
              { exercise_id: 'machine_chest_press', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 6.5, rest_seconds: 75, coach_note: 'Smooth' },
            ],
          },
          {
            day_id: 'd2',
            day_label: 'Day 2',
            focus: 'Full Body B',
            estimated_minutes: 40,
            warmup_checklist: ['2m bike'],
            exercises: [
              { exercise_id: 'goblet_squat', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 6.5, rest_seconds: 75, coach_note: 'Auto-rotated' },
              { exercise_id: 'lat_pulldown_neutral', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 6.5, rest_seconds: 75, coach_note: 'Elbows down' },
            ],
          },
        ],
        week_progressions: [
          { week_number: 1, week_label: 'W1', phase_focus: 'Ease in', progression_rule: 'RPE 6.5', rpe_delta: 0, set_delta: 0, rep_delta: 0 },
          { week_number: 2, week_label: 'W2', phase_focus: 'Build', progression_rule: '+1 rep', rpe_delta: 0.5, set_delta: 0, rep_delta: 1 },
          { week_number: 3, week_label: 'W3', phase_focus: 'Push', progression_rule: '+1 set', rpe_delta: 1.0, set_delta: 1, rep_delta: 0 },
          { week_number: 4, week_label: 'W4', phase_focus: 'Consolidate', progression_rule: 'Hold', rpe_delta: 1.0, set_delta: 0, rep_delta: 1 },
        ],
      }),
    });

    const plan = await generateAdaptivePlan(
      { ...DEFAULT_PROFILE, daysPerWeek: 2, programWeeks: 4 },
      safe,
      'test-key',
      'gemini-3.8-flash'
    );

    expect(plan.source).toBe('gemini');
    expect(plan.weeks).toHaveLength(4);
    // Day 2's repeated goblet_squat should have been rotated to another squat
    expect(plan.weeks[0].days[1].exercises[0].exercise_id).not.toBe('goblet_squat');
    // Week 3 should reflect +1 set and +1.0 RPE delta
    expect(plan.weeks[2].days[0].exercises[0].sets).toBe(4);
    expect(plan.weeks[2].days[0].exercises[0].target_rpe).toBe(7.5);
  });

  it('gives a clear error when Gemini truncates JSON with MAX_TOKENS', () => {
    expect(() =>
      parseGeminiJson({
        candidates: [{ finishReason: 'MAX_TOKENS' }],
        text: '{"program_title": "Cut off mid string',
      })
    ).toThrow(/token limit/i);
  });

  it('swapExercise never returns an exercise already present on the same day', async () => {
    const safe = filterSafeExercises(DEFAULT_PROFILE);
    const currentItem = {
      exercise_id: 'goblet_squat',
      sets: 3,
      rep_min: 8,
      rep_max: 10,
      target_rpe: 7,
      rest_seconds: 75,
    };
    const sameDayIds = ['goblet_squat', 'leg_press', 'barbell_back_squat'];

    // Local swap
    const localSwap = await swapExercise(
      currentItem,
      'Equipment is busy',
      DEFAULT_PROFILE,
      safe,
      '',
      'gemini-3.8-flash',
      sameDayIds,
      sameDayIds
    );
    expect(sameDayIds).not.toContain(localSwap.exercise_id);

    // Gemini swap returning an illegal duplicate gets overridden safely
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP' }],
      text: JSON.stringify({
        exercise_id: 'leg_press', // already on same day!
        sets: 3,
        rep_min: 8,
        rep_max: 10,
        target_rpe: 7,
        rest_seconds: 75,
        coach_note: 'Swap',
        swap_rationale: 'Alt',
      }),
    });
    const aiSwap = await swapExercise(
      currentItem,
      'Equipment is busy',
      DEFAULT_PROFILE,
      safe,
      'test-key',
      'gemini-3.8-flash',
      sameDayIds,
      sameDayIds
    );
    expect(sameDayIds).not.toContain(aiSwap.exercise_id);
  });

  it('adaptSingleDay removes hallucinated and duplicate exercise IDs', async () => {
    const safe = filterSafeExercises(DEFAULT_PROFILE);
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP' }],
      text: JSON.stringify({
        day_id: 'w1_d1',
        day_label: 'Express Day',
        focus: 'Quick',
        estimated_minutes: 20,
        warmup_checklist: ['Walk'],
        exercises: [
          { exercise_id: 'made_up_exercise', sets: 2, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 60, coach_note: 'Invalid' },
          { exercise_id: 'goblet_squat', sets: 2, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 60, coach_note: 'Valid' },
          { exercise_id: 'goblet_squat', sets: 2, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 60, coach_note: 'Dup' },
        ],
      }),
    });

    const adapted = await adaptSingleDay(
      { day_id: 'w1_d1', exercises: [] },
      'Only 20 minutes',
      DEFAULT_PROFILE,
      safe,
      'test-key',
      'gemini-3.8-flash'
    );
    const ids = adapted.exercises.map((e) => e.exercise_id);
    expect(ids).not.toContain('made_up_exercise');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
