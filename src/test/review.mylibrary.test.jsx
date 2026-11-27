/** My exercises: adding/editing/deleting in the app, AI suggestions, and how they reach the planner. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', INTEGER: 'INTEGER', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));

import CatalogBrowser from '../components/CatalogBrowser';
import { exercises, EXERCISE_MAP, BUILT_IN_IDS, sanitizeCustomExercise, setCustomExercises, slugFor } from '../services/catalog';
import { DEFAULT_PROFILE, sanitizeProfile, saveCustomExercises, loadCustomExercises, createProfile, switchProfile, exportBackupJson, importBackupJson, storageReport } from '../services/storage';
import { filterSafeExercises } from '../services/catalogFilter';
import { suggestExercises } from '../services/geminiCoach';
import { loadUsage } from '../services/usage';

const landmine = { id: 'my_landmine_press', name: 'Landmine Press', movement_pattern: 'vertical_push', primary_muscles: ['Shoulders'], equipment_tiers: ['commercial_gym'], equipment_label: 'Barbell', joint_stress_flags: ['wrist'], cues: ['Brace.'], modalities: ['gym'], dose: 'reps' };
const P = (over = {}) => sanitizeProfile({ ...DEFAULT_PROFILE, equipmentTier: 'commercial_gym', ...over });
const ids = (p) => new Set(filterSafeExercises(p).map((e) => e.id));

beforeEach(() => {
  mockGenerateContent.mockReset();
  vi.stubGlobal('confirm', () => true);
});
afterEach(() => setCustomExercises([]));

describe('catalogue registry', () => {
  it('only accepts well-formed custom exercises and fills safe defaults', () => {
    expect(sanitizeCustomExercise({ ...landmine, id: 'goblet_squat' })).toBeNull(); // can't shadow a built-in
    expect(sanitizeCustomExercise({ ...landmine, name: '' })).toBeNull();
    const ex = sanitizeCustomExercise({ id: 'my_x', name: 'X', movement_pattern: 'nonsense', modalities: ['dance'], joint_stress_flags: ['toe', 'knee'] });
    expect(ex).toMatchObject({ movement_pattern: 'core', modalities: ['gym'], joint_stress_flags: ['knee'], equipment_tiers: ['commercial_gym', 'apartment_gym', 'home_setup'], custom: true });
    expect(slugFor('Landmine Press', new Set(['my_landmine_press']))).toBe('my_landmine_press_2');
  });

  it('adds and removes custom exercises without touching the built-ins', () => {
    const n = exercises.length;
    setCustomExercises([landmine]);
    expect(exercises).toHaveLength(n + 1);
    expect(EXERCISE_MAP.my_landmine_press.name).toBe('Landmine Press');
    setCustomExercises([]);
    expect(exercises).toHaveLength(BUILT_IN_IDS.size);
    expect(EXERCISE_MAP.my_landmine_press).toBeUndefined();
  });
});

describe('storage and planning', () => {
  it('are saved per person and included in backups and the storage report', () => {
    saveCustomExercises([landmine]);
    expect(storageReport().areas.find((a) => a.key === 'CUSTOM_EXERCISES').bytes).toBeGreaterThan(0);
    const backup = exportBackupJson();
    createProfile('Partner');
    expect(loadCustomExercises()).toEqual([]);
    expect(EXERCISE_MAP.my_landmine_press).toBeUndefined();
    importBackupJson(backup);
    expect(loadCustomExercises().map((e) => e.id)).toEqual(['my_landmine_press']);
    switchProfile('default');
    expect(loadCustomExercises()).toHaveLength(1);
  });

  it('reach the planner, respect injuries, and can be skipped like any exercise', () => {
    saveCustomExercises([landmine]);
    expect(ids(P()).has('my_landmine_press')).toBe(true);
    expect(ids(P({ health: { injuries: { wrist: 'current' } } })).has('my_landmine_press')).toBe(false);
    expect(ids(P({ equipmentTier: 'home_setup' })).has('my_landmine_press')).toBe(false);
    const skipping = P({ preferences: { dislikes: ['my_landmine_press'] } });
    expect(skipping.preferences.dislikes).toEqual(['my_landmine_press']);
    expect(ids(skipping).has('my_landmine_press')).toBe(false);
  });
});

describe('AI suggestions', () => {
  it('returns new, sanitized drafts, skips ones already in the library, and logs usage', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 400, totalTokenCount: 1300 },
      text: JSON.stringify({
        exercises: [
          { name: 'Goblet Squat', movement_pattern: 'squat', primary_muscles: ['Quads'], equipment_label: 'DB', equipment_tiers: ['home_setup'], modalities: ['gym'], dose: 'reps', joint_stress_flags: [], cues: ['a'] },
          { name: 'Kettlebell Halo', movement_pattern: 'mobility', primary_muscles: ['Shoulders'], equipment_label: 'Kettlebell', equipment_tiers: ['home_setup', 'commercial_gym'], modalities: ['gym'], dose: 'reps', joint_stress_flags: ['shoulder'], cues: ['Circle slowly.', 'Ribs down.', 'Breathe.'], regression_id: 'not_real' },
        ],
      }),
    });
    const out = await suggestExercises({ request: 'kettlebell shoulders', profile: P(), apiKey: 'k', model: 'm' });
    expect(out.map((e) => e.name)).toEqual(['Kettlebell Halo']);
    expect(out[0]).toMatchObject({ id: 'my_kettlebell_halo', source: 'ai', joint_stress_flags: ['shoulder'] });
    expect(out[0].regression_id).toBeUndefined();
    expect(loadUsage().at(-1)).toMatchObject({ feature: 'exercise_ideas', ok: true });
  });

  it('needs a key and a request', async () => {
    await expect(suggestExercises({ request: 'x', apiKey: '' })).rejects.toThrow(/API key/);
    await expect(suggestExercises({ request: '  ', apiKey: 'k' })).rejects.toThrow(/Describe/);
  });
});

describe('library screen', () => {
  function setup(extra = {}) {
    const onProfileChange = vi.fn();
    const user = userEvent.setup();
    const utils = render(<CatalogBrowser defaultTier="commercial_gym" profile={P()} onProfileChange={onProfileChange} plan={null} apiKey="k" model="m" {...extra} />);
    return { user, onProfileChange, ...utils };
  }

  it('no longer tells people to edit a JSON file', () => {
    setup();
    expect(screen.queryByText(/exercises\.json/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add exercise/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add with AI/ })).toBeInTheDocument();
  });

  it('adds an exercise by hand, shows it under Mine, and saves it', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Add exercise/ }));
    const form = screen.getByRole('region', { name: 'Add an exercise' });
    await user.type(within(form).getByPlaceholderText(/Landmine Press/), 'Sled Push');
    await user.selectOptions(within(form).getAllByRole('combobox')[0], 'cardio');
    await user.click(within(form).getByRole('button', { name: 'Add to library' }));
    expect(screen.getByRole('status')).toHaveTextContent(/Added Sled Push/);
    await user.click(screen.getByRole('button', { name: /Mine/ }));
    expect(screen.getByRole('heading', { name: 'Sled Push' })).toBeInTheDocument();
    expect(loadCustomExercises()[0]).toMatchObject({ id: 'my_sled_push', movement_pattern: 'cardio', source: 'manual' });
  });

  it('rejects a name that already exists', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Add exercise/ }));
    const form = screen.getByRole('region', { name: 'Add an exercise' });
    await user.type(within(form).getByPlaceholderText(/Landmine Press/), 'goblet squat');
    await user.click(within(form).getByRole('button', { name: 'Add to library' }));
    expect(within(form).getByRole('alert')).toHaveTextContent(/already in the library/);
  });

  it('adds the AI suggestions you tick', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP' }],
      text: JSON.stringify({
        exercises: ['Kettlebell Halo', 'Bottoms-Up Press'].map((name) => ({ name, movement_pattern: 'vertical_push', primary_muscles: ['Shoulders'], equipment_label: 'Kettlebell', equipment_tiers: ['home_setup'], modalities: ['gym'], dose: 'reps', joint_stress_flags: [], cues: ['Go slow.'] })),
      }),
    });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Add with AI/ }));
    await user.click(screen.getByRole('button', { name: 'Kettlebell moves for shoulders' }));
    await user.click(await screen.findByRole('checkbox', { name: /Bottoms-Up Press/ }));
    await user.click(screen.getByRole('button', { name: 'Add 1 to library' }));
    expect(loadCustomExercises().map((e) => e.name)).toEqual(['Kettlebell Halo']);
  });

  it("can keep a built-in exercise out of plans, and won't delete one that's in the current plan", async () => {
    saveCustomExercises([landmine]);
    const plan = { weeks: [{ days: [{ exercises: [{ exercise_id: 'my_landmine_press' }] }] }] };
    const { user, onProfileChange } = setup({ plan });
    await user.type(screen.getByRole('searchbox', { name: 'Search exercises' }), 'goblet squat');
    await user.click(screen.getAllByRole('button', { name: 'View form' })[0]);
    await user.click(screen.getByRole('button', { name: "Don't use in my plans" }));
    expect(onProfileChange.mock.calls[0][0].preferences.dislikes).toContain('goblet_squat');

    await user.clear(screen.getByRole('searchbox', { name: 'Search exercises' }));
    await user.click(screen.getByRole('button', { name: /Mine/ }));
    await user.click(screen.getByRole('button', { name: 'Details' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('status')).toHaveTextContent(/in your current plan/);
    expect(loadCustomExercises()).toHaveLength(1);
  });
});
