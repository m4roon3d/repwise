/**
 * 1) Gemini replies that are unusable get ONE retry; transport errors and token cut-offs do not.
 * 2) A swap can be applied to every week of the program, keeping each week's own progression.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', INTEGER: 'INTEGER', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));

import App from '../App';
import { DEFAULT_PROFILE, loadPlan } from '../services/storage';
import { filterSafeExercises } from '../services/catalogFilter';
import {
  adaptSingleDay,
  carryProgression,
  generateAdaptivePlan,
  runCoachIntakeTurn,
  swapExercise,
} from '../services/geminiCoach';

beforeEach(() => {
  mockGenerateContent.mockReset();
});

const reply = (obj, finishReason = 'STOP') => ({ candidates: [{ finishReason }], text: typeof obj === 'string' ? obj : JSON.stringify(obj) });
const profile = { ...DEFAULT_PROFILE, daysPerWeek: 3 };
const safe = filterSafeExercises(profile);
const item = (id, over = {}) => ({ exercise_id: id, sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 75, coach_note: 'n', ...over });
const goodPlan = () => ({
  program_title: 'T', coach_summary: 's', program_strategy: 'x', weekly_progression_tip: 'tip',
  base_days: [0, 1, 2].map((i) => ({ day_title: `D${i}`, focus: 'f', exercises: [item(safe[i * 3].id), item(safe[i * 3 + 1].id)] })),
  week_progressions: [],
});

describe('Gemini retry on unusable replies', () => {
  it('plan: retries once after malformed JSON and uses the second reply', async () => {
    mockGenerateContent.mockResolvedValueOnce(reply('not json {')).mockResolvedValueOnce(reply(goodPlan()));
    const plan = await generateAdaptivePlan(profile, safe, 'key', 'm');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(plan.source).toBe('gemini');
  });

  it('plan: retries once when every exercise id is hallucinated', async () => {
    const bad = goodPlan();
    bad.base_days.forEach((d) => d.exercises.forEach((e) => (e.exercise_id = 'nope')));
    mockGenerateContent.mockResolvedValueOnce(reply(bad)).mockResolvedValueOnce(reply(goodPlan()));
    await generateAdaptivePlan(profile, safe, 'key', 'm');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second bad reply (no endless loop) and surfaces the parse error', async () => {
    mockGenerateContent.mockResolvedValue(reply('still not json'));
    await expect(generateAdaptivePlan(profile, safe, 'key', 'm')).rejects.toThrow(/Could not parse/);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry network / quota errors', async () => {
    mockGenerateContent.mockImplementation(() => Promise.reject(new Error('429 quota')));
    let err;
    try {
      await generateAdaptivePlan(profile, safe, 'key', 'm');
    } catch (e) {
      err = e;
    }
    expect(err?.message).toMatch(/429/);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a token-limit cut-off', async () => {
    mockGenerateContent.mockResolvedValue({ candidates: [{ finishReason: 'MAX_TOKENS' }], text: '' });
    await expect(generateAdaptivePlan(profile, safe, 'key', 'm')).rejects.toThrow(/token limit/);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('intake: retries when the reply is not an object', async () => {
    mockGenerateContent.mockResolvedValueOnce(reply('[1,2]')).mockResolvedValueOnce(reply({ assistant_message: 'hi' }));
    const out = await runCoachIntakeTurn([{ role: 'user', text: 'hi' }], profile, 'key', 'm');
    expect(out.assistant_message).toBe('hi');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('swap: retries once after an empty reply', async () => {
    const cur = item(safe[0].id);
    mockGenerateContent.mockResolvedValueOnce(reply('')).mockResolvedValueOnce(reply(item(safe[5].id)));
    const out = await swapExercise(cur, 'fresh', profile, safe, 'key', 'm', [cur.exercise_id], [cur.exercise_id]);
    expect(out.exercise_id).toBe(safe[5].id);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('adapt: retries once when the first reply has no valid exercises, then fails with the friendly message', async () => {
    const day = { day_id: 'w1_d1', day_title: 'D', focus: 'f', exercises: [item(safe[0].id)] };
    const empty = { day_title: 'D', focus: 'f', exercises: [item('nope')] };
    mockGenerateContent.mockResolvedValue(reply(empty));
    await expect(adaptSingleDay(day, 'short on time', profile, safe, 'key', 'm')).rejects.toThrow(/no valid exercises/);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);

    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValueOnce(reply(empty)).mockResolvedValueOnce(reply({ ...empty, exercises: [item(safe[1].id)] }));
    const out = await adaptSingleDay(day, 'short on time', profile, safe, 'key', 'm');
    expect(out.exercises[0].exercise_id).toBe(safe[1].id);
  });
});

describe('carryProgression', () => {
  const rep = item('x', { sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7 });
  it('shifts the replacement by the same week-over-week deltas, within clamps', () => {
    const base = item('a', { sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7 });
    const wk3 = item('a', { sets: 4, rep_min: 9, rep_max: 11, target_rpe: 8 });
    const out = carryProgression({ ...rep, exercise_id: safe.find((e) => e.movement_pattern !== 'mobility').id }, base, wk3);
    expect(out).toMatchObject({ sets: 4, rep_min: 9, rep_max: 11, target_rpe: 8 });
  });
  it('leaves the replacement untouched with no baseline, and never exceeds sets 5 / RPE 9', () => {
    const r = { ...rep, exercise_id: safe.find((e) => e.movement_pattern !== 'mobility').id, sets: 5, target_rpe: 9 };
    expect(carryProgression(r, undefined, item('a'))).toEqual(r);
    const out = carryProgression(r, item('a'), item('a', { sets: 5, target_rpe: 9 }));
    expect(out.sets).toBe(5);
    expect(out.target_rpe).toBe(9);
  });
});

describe('Swap: apply to all weeks', () => {
  async function planOnScreen() {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Generate 4-Week Block/i }));
    await screen.findByText('Week 1');
    return user;
  }
  const slot = (plan, w) => plan.weeks[w].days[0].exercises[0].exercise_id;

  it('is on by default: every week that held the old exercise gets the new one, each keeping its own progression', async () => {
    const user = await planOnScreen();
    const before = loadPlan();
    const old = slot(before, 0);
    expect([1, 2, 3].every((w) => slot(before, w) === old)).toBe(true);

    await user.click(screen.getAllByRole('button', { name: /Swap/i })[0]);
    expect(screen.getByLabelText(/Apply to all weeks/i)).toBeChecked();
    await user.click(screen.getByRole('button', { name: /Want a fresh variation/i }));

    await waitFor(() => expect(slot(loadPlan(), 0)).not.toBe(old));
    const after = loadPlan();
    const fresh = slot(after, 0);
    for (const w of [1, 2, 3]) {
      expect(slot(after, w)).toBe(fresh);
      // progression untouched in shape: later weeks are never lighter than week 1
      expect(after.weeks[w].days[0].exercises[0].target_rpe).toBeGreaterThanOrEqual(after.weeks[0].days[0].exercises[0].target_rpe);
    }
    // other days are untouched
    expect(after.weeks[2].days[1].exercises.map((e) => e.exercise_id)).toEqual(before.weeks[2].days[1].exercises.map((e) => e.exercise_id));
  });

  it('unticking the box limits the swap to the week on screen', async () => {
    const user = await planOnScreen();
    const old = slot(loadPlan(), 0);
    await user.click(screen.getAllByRole('button', { name: /Swap/i })[0]);
    await user.click(screen.getByLabelText(/Apply to all weeks/i));
    await user.click(screen.getByRole('button', { name: /Want a fresh variation/i }));

    await waitFor(() => expect(slot(loadPlan(), 0)).not.toBe(old));
    const after = loadPlan();
    expect([1, 2, 3].every((w) => slot(after, w) === old)).toBe(true);
  });

  it('a week that was already swapped by hand keeps its choice', async () => {
    const user = await planOnScreen();
    // swap week 2 only
    await user.click(screen.getByRole('button', { name: 'Week 2' }));
    await user.click(screen.getAllByRole('button', { name: /Swap/i })[0]);
    await user.click(screen.getByLabelText(/Apply to all weeks/i));
    await user.click(screen.getByRole('button', { name: /Want a fresh variation/i }));
    await waitFor(() => expect(slot(loadPlan(), 1)).not.toBe(slot(loadPlan(), 0)));
    const manual = slot(loadPlan(), 1);

    // now swap week 1 for all weeks
    await user.click(screen.getByRole('button', { name: 'Week 1' }));
    const old = slot(loadPlan(), 0);
    await user.click(screen.getAllByRole('button', { name: /Swap/i })[0]);
    await user.click(screen.getByLabelText(/Apply to all weeks/i)); // the untick sticks, so tick it again
    await user.click(screen.getByRole('button', { name: /Equipment is busy/i }));
    await waitFor(() => expect(slot(loadPlan(), 0)).not.toBe(old));
    const after = loadPlan();
    expect(slot(after, 1)).toBe(manual);
    expect(slot(after, 2)).toBe(slot(after, 0));
  });
});
