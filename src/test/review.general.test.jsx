/**
 * The app is a general-purpose training coach (not only for people coming back from a layoff).
 */
import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', INTEGER: 'INTEGER', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));

import App from '../App';
import { filterSafeExercises } from '../services/catalogFilter';
import { DEFAULT_PROFILE, loadProfile, sanitizeProfile, savePlan } from '../services/storage';
import { generateAdaptivePlan, parseIntakeKeywords, startingRpe } from '../services/geminiCoach';

beforeEach(() => mockGenerateContent.mockReset());

const root = `${process.cwd()}/`;
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'dist' || f === 'test') continue;
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

describe('no "comeback-only" framing left in the product', () => {
  it('user-facing source, prompts, manifest, title and README do not mention comeback / re-entry', () => {
    const files = [...walk(join(root, 'src')), ...['index.html', 'README.md', 'public/manifest.json'].map((f) => join(root, f))];
    const offenders = [];
    for (const f of files.filter((f) => /\.(jsx?|html|md|json|css)$/.test(f))) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // `comeback_strategy` is kept ONLY as a read alias so plans saved by older versions still load.
        if (/comeback|re-entry|ease back/i.test(line) && !/comeback_strategy/.test(line)) offenders.push(`${f.replace(root, '')}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('defaults are neutral for a new user', () => {
    expect(DEFAULT_PROFILE).toMatchObject({ weeksAway: 0, experience: 'beginner', goal: 'general_fitness', age: 30 });
  });
});

describe('experience level', () => {
  const week1Rpe = async (experience, extra = {}) => {
    const p = { ...DEFAULT_PROFILE, experience, ...extra };
    const plan = await generateAdaptivePlan(p, filterSafeExercises(p), '', 'm');
    return plan.weeks[0].days[0].exercises[0].target_rpe;
  };

  it('startingRpe scales with experience and eases for low energy / long layoff / poor sleep', () => {
    expect(startingRpe({ experience: 'beginner' })).toBe(6.5);
    expect(startingRpe({ experience: 'intermediate' })).toBe(7);
    expect(startingRpe({ experience: 'advanced' })).toBe(7.5);
    expect(startingRpe({ experience: 'advanced', weeksAway: 10 })).toBe(7);
    expect(startingRpe({ experience: 'intermediate', energyLevel: 'low' })).toBe(6.5);
    expect(startingRpe({ experience: 'beginner', sleepHours: 5 })).toBe(6);
    expect(startingRpe({})).toBe(7);
  });

  it('the local engine starts advanced lifters harder than beginners', async () => {
    const [b, i, a] = [await week1Rpe('beginner'), await week1Rpe('intermediate'), await week1Rpe('advanced')];
    expect(b).toBeLessThan(i);
    expect(i).toBeLessThan(a);
  });

  it('local plans are generic: neutral title / strategy / week labels', async () => {
    const plan = await generateAdaptivePlan(DEFAULT_PROFILE, filterSafeExercises(DEFAULT_PROFILE), '', 'm');
    expect(plan.program_title).toMatch(/Training Block/);
    expect(plan.program_strategy).toBeTruthy();
    expect(JSON.stringify(plan)).not.toMatch(/comeback|re-entry/i);
  });

  it('sanitizeProfile accepts valid experience / goal and repairs bad values', () => {
    expect(sanitizeProfile({ experience: 'advanced', goal: 'general_fitness' })).toMatchObject({ experience: 'advanced', goal: 'general_fitness' });
    expect(sanitizeProfile({ experience: 'god-mode' }).experience).toBe('beginner');
  });

  it('a profile saved by an older version gets the new fields', () => {
    localStorage.setItem('mf_profile_v1', JSON.stringify({ age: 48, weeksAway: 6, goal: 'rebuild_consistency' }));
    expect(loadProfile()).toMatchObject({ age: 48, weeksAway: 6, goal: 'rebuild_consistency', experience: 'beginner' });
  });

  it('keyless chat understands experience phrases', () => {
    expect(parseIntakeKeywords("I'm a complete beginner").experience).toBe('beginner');
    expect(parseIntakeKeywords('I am new to the gym').experience).toBe('beginner');
    expect(parseIntakeKeywords('been lifting for 10 years').experience).toBe('advanced');
    expect(parseIntakeKeywords('intermediate lifter').experience).toBe('intermediate');
    expect(parseIntakeKeywords('new to the gym')).not.toHaveProperty('protectLowerBack');
  });
});

describe('Gemini prompts and schema', () => {
  const reply = (extra = {}) => ({
    candidates: [{ finishReason: 'STOP' }],
    text: JSON.stringify({
      program_title: 't', coach_summary: 's', weekly_progression_tip: 'w',
      base_days: [{ day_id: 'd1', day_label: 'D1', focus: 'f', estimated_minutes: 40, warmup_checklist: ['a'],
        exercises: [{ exercise_id: 'goblet_squat', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 75, coach_note: 'n' }] }],
      week_progressions: [], ...extra,
    }),
  });
  const profile = { ...DEFAULT_PROFILE, experience: 'advanced', weeksAway: 0, daysPerWeek: 2, programWeeks: 2 };

  it('sends experience to the model and never frames the user as a comeback trainee', async () => {
    mockGenerateContent.mockResolvedValueOnce(reply({ program_strategy: 'Strat' }));
    await generateAdaptivePlan(profile, filterSafeExercises(profile), 'k', 'm');
    const { contents, config } = mockGenerateContent.mock.calls[0][0];
    expect(contents).toMatch(/Training Experience: advanced/);
    expect(contents).toMatch(/Weeks Since Last Trained: 0/);
    expect(contents).not.toMatch(/comeback/i);
    expect(config.systemInstruction).not.toMatch(/comeback/i);
    expect(config.responseSchema.required).toContain('program_strategy');
    expect(config.responseSchema.required).not.toContain('comeback_strategy');
  });

  it('maps program_strategy, still accepts a legacy comeback_strategy, and has a default', async () => {
    mockGenerateContent.mockResolvedValueOnce(reply({ program_strategy: 'New' }));
    expect((await generateAdaptivePlan(profile, filterSafeExercises(profile), 'k', 'm')).program_strategy).toBe('New');
    mockGenerateContent.mockResolvedValueOnce(reply({ comeback_strategy: 'Legacy' }));
    expect((await generateAdaptivePlan(profile, filterSafeExercises(profile), 'k', 'm')).program_strategy).toBe('Legacy');
    mockGenerateContent.mockResolvedValueOnce(reply());
    expect((await generateAdaptivePlan(profile, filterSafeExercises(profile), 'k', 'm')).program_strategy).toMatch(/Progressive overload/);
  });
});

describe('UI', () => {
  it('Coach tab has a Training Experience selector and the neutral labels', async () => {
    const user = userEvent.setup();
    render(<App />);
    const exp = screen.getByLabelText(/Training Experience/i);
    expect(exp).toHaveValue('beginner');
    await user.selectOptions(exp, 'advanced');
    expect(JSON.parse(localStorage.getItem('mf_profile_v1')).experience).toBe('advanced');
    expect(screen.getByLabelText(/Weeks Since Last Trained/i)).toHaveValue(0);
    expect(screen.getByRole('combobox', { name: /Primary Goal/i })).toHaveValue('general_fitness');
    expect(screen.getByRole('option', { name: /General Fitness/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/comeback/i);
  });

  it('AI chat can set experience (validated) and rejects unknown values', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP' }],
      text: JSON.stringify({ coach_reply: 'ok', ready_to_generate: true, profile_patch: { experience: 'advanced', goal: 'general_fitness' } }),
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Start Chat/i }));
    await user.type(screen.getByPlaceholderText(/Sleeping 6 hrs/i), 'hi');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));
    expect(await screen.findByText(/Experience \(advanced\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Training Experience/i)).toHaveValue('advanced');
  });

  it('a plan saved by an older version (comeback_strategy, comeback title) still renders', () => {
    savePlan({
      program_title: '4-Week Smart Comeback Block (3d/wk)', comeback_strategy: 'Legacy strategy text', coach_summary: 's',
      source: 'local', equipmentTier: 'commercial_gym', generatedAt: 'x',
      weeks: [{ week_number: 1, week_label: 'W1', phase_focus: 'p', progression_rule: 'r', days: [{ day_id: 'd', day_label: 'D', focus: 'f', estimated_minutes: 30, exercises: [] }] }],
    });
    render(<App />);
    expect(screen.getByText(/Legacy strategy text/)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------- lazy SDK loading */
import { GoogleGenAI } from '@google/genai';
import { adaptSingleDay, runCoachIntakeTurn, swapExercise, testGeminiConnection } from '../services/geminiCoach';

describe('Gemini SDK is loaded on demand', () => {
  it('no source file imports @google/genai statically except via dynamic import()', () => {
    const offenders = walk(join(root, 'src'))
      .filter((f) => /\.jsx?$/.test(f))
      .filter((f) => /^\s*import\s[^;]*from\s+['"]@google\/genai['"]/m.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('keyless flows (plan, swap, adapt, chat) never touch the SDK', async () => {
    GoogleGenAI.mockClear();
    const profile = { ...DEFAULT_PROFILE };
    const safe = filterSafeExercises(profile);
    const plan = await generateAdaptivePlan(profile, safe, '', 'm');
    const day = plan.weeks[0].days[0];
    await swapExercise(day.exercises[0], 'busy', profile, safe, '', 'm', [], []);
    await adaptSingleDay(day, 'Only 20 min', profile, safe, '', 'm');
    await runCoachIntakeTurn([{ role: 'user', text: 'hello' }], profile, '', 'm');
    expect(GoogleGenAI).not.toHaveBeenCalled();
  });

  it('keyed flows load it, pass the key through, and surface its errors', async () => {
    GoogleGenAI.mockClear();
    mockGenerateContent.mockResolvedValueOnce({ text: 'READY' });
    await expect(testGeminiConnection('my-key', 'gemini-x')).resolves.toBe('READY');
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'my-key' });
    mockGenerateContent.mockRejectedValueOnce(new Error('boom'));
    await expect(testGeminiConnection('my-key', 'gemini-x')).rejects.toThrow('boom');
  });
});
