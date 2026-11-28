/** Nutrition: targets from profile/plan/labs, Open Food Facts lookups, the food log, the AI meal plan and the screens. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', INTEGER: 'INTEGER', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));

import NutritionView from '../components/NutritionView';
import { computeTargets, dietClashes, trainingWeekdays, sanitizeDiet } from '../services/nutrition';
import { productFromOff, lookupBarcode, scaleNutrients, productWarnings, sanitizeFoodLog, dayTotals, recentAverage, sanitizeMealPlan, todayKey } from '../services/food';
import { DEFAULT_PROFILE, sanitizeProfile, loadFoodLog, saveFoodLog, exportBackupJson, importBackupJson, createProfile, loadMealPlan } from '../services/storage';
import { generateMealPlan, summarizeNutrition } from '../services/geminiCoach';
import { loadUsage } from '../services/usage';

const base = (over = {}) => sanitizeProfile({ ...DEFAULT_PROFILE, sex: 'male', age: 30, weightKg: 80, heightCm: 180, daysPerWeek: 4, sessionMinutes: 45, ...over });
const labs = (markers) => ({ date: '2026-08-11', source: 'manual', markers });

const OFF_PRODUCT = {
  status: 1,
  product: {
    product_name: 'Greek Yogurt',
    brands: 'Epigamia, Other',
    serving_quantity: 90,
    serving_size: '90 g',
    nutriscore_grade: 'b',
    allergens_tags: ['en:milk'],
    ingredients_analysis_tags: ['en:non-vegan', 'en:vegetarian'],
    nutriments: { energy_100g: 418, proteins_100g: 9, carbohydrates_100g: 4, sugars_100g: 4, fat_100g: 5, 'saturated-fat_100g': 3.2, salt_100g: 0.1 },
  },
};
const okJson = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });

beforeEach(() => {
  mockGenerateContent.mockReset();
  vi.stubGlobal('confirm', () => true);
});
afterEach(() => vi.unstubAllGlobals());

describe('targets', () => {
  it('balance calories and macros and shift carbs between training and rest days', () => {
    const t = computeTargets(base(), null);
    expect(t.kcal).toBeGreaterThan(2300);
    expect(t.kcal).toBeLessThan(3000);
    expect(t.protein).toBe(Math.round((80 * 1.4) / 5) * 5);
    expect(t.trainingDays).toBe(4);
    expect(t.trainingDay.carbs).toBeGreaterThan(t.restDay.carbs);
    const weekly = t.trainingDay.carbs * 4 + t.restDay.carbs * 3;
    expect(Math.abs(weekly / 7 - t.carbs)).toBeLessThan(5);
    expect(t.sodiumMax).toBe(2300);
  });

  it('cut for fat loss but never below a safe floor; no deficit in pregnancy', () => {
    const keep = computeTargets(base(), null).kcal;
    expect(computeTargets(base({ goal: 'fat_loss_conditioning' }), null).kcal).toBeLessThan(keep);
    const tiny = computeTargets(base({ sex: 'female', weightKg: 42, heightCm: 150, age: 60, goal: 'fat_loss_conditioning', daysPerWeek: 2 }), null);
    expect(tiny.kcal).toBeGreaterThanOrEqual(1200);
    const preg = computeTargets(base({ sex: 'female', goal: 'fat_loss_conditioning', health: { pregnancy: 'pregnant_t3' } }), null);
    const notPreg = computeTargets(base({ sex: 'female' }), null);
    expect(preg.kcal).toBeGreaterThan(notPreg.kcal);
    expect(preg.notes.map((n) => n.id)).toContain('preg');
  });

  it('follow conditions and the blood report', () => {
    const t = computeTargets(
      base({
        health: { conditions: ['hypertension', 'diabetes'] },
        labs: labs([
          { name: 'LDL', value: 170, unit: 'mg/dL' },
          { name: 'Triglycerides', value: 220, unit: 'mg/dL' },
          { name: 'Vitamin D', value: 15, unit: 'ng/mL' },
        ]),
      }),
      null
    );
    expect(t.sodiumMax).toBe(1500);
    expect(t.carbs * 4).toBeLessThanOrEqual(t.kcal * 0.4 + 20);
    expect(t.satFatMax).toBeCloseTo((t.kcal * 0.07) / 9, 0);
    expect(t.sugarMax).toBeCloseTo((t.kcal * 0.05) / 4, 0);
    expect(t.fibre).toBeGreaterThanOrEqual(30);
    expect(t.notes.map((n) => n.id)).toEqual(expect.arrayContaining(['lipids', 'tg', 'sugar', 'vitd', 'bp']));
  });

  it('keep protein moderate when the kidney marker is raised', () => {
    const t = computeTargets(base({ goal: 'strength_hypertrophy', labs: labs([{ name: 'Creatinine', value: 2.1, unit: 'mg/dL' }]) }), null);
    expect(t.protein).toBeLessThanOrEqual(65);
    expect(t.notes[0].id).toBe('kidney');
  });

  it('spread training days through the week', () => {
    expect(trainingWeekdays(3)).toEqual([0, 2, 4]);
    expect(trainingWeekdays(0)).toEqual([]);
  });
});

describe('diet checks', () => {
  it('spot dishes that clash with the diet type or allergies', () => {
    expect(dietClashes('Chicken curry with rice', { dietType: 'vegetarian' })).toEqual(['meat']);
    expect(dietClashes('Masala omelette', { dietType: 'vegetarian' })).toEqual(['egg']);
    expect(dietClashes('Masala omelette', { dietType: 'eggetarian' })).toEqual([]);
    expect(dietClashes('Oats with oat milk', { dietType: 'vegan' })).toEqual([]);
    expect(dietClashes('Oats with milk and honey', { dietType: 'vegan' })).toEqual(['animal products']);
    expect(dietClashes('Peanut chikki', { dietType: 'omnivore', allergies: ['peanuts'] })).toEqual(['Peanuts']);
    expect(sanitizeDiet({ dietType: 'keto', allergies: ['peanuts', 'x'], mealsPerDay: 9 })).toMatchObject({ dietType: 'omnivore', allergies: ['peanuts'], mealsPerDay: 3 });
  });
});

describe('Open Food Facts', () => {
  it('reads a product, converting kJ to kcal and salt to sodium', () => {
    const p = productFromOff({ ...OFF_PRODUCT.product, code: '8901234567890' });
    expect(p).toMatchObject({ name: 'Greek Yogurt', brand: 'Epigamia', servingG: 90, nutriscore: 'b', vegan: false, vegetarian: true, allergens: ['milk'] });
    expect(p.per100).toMatchObject({ kcal: 100, protein: 9, sodium: 40, fibre: null });
    expect(scaleNutrients(p.per100, 90)).toMatchObject({ kcal: 90, protein: 8.1, fibre: null });
    expect(productWarnings(p, { dietType: 'vegan', allergies: ['milk'] })).toEqual(['Contains dairy', 'Not vegan']);
    expect(productFromOff({ product_name: 'Mystery', nutriments: {} })).toBeNull();
  });

  it('looks barcodes up and copes with unknown codes and failures', async () => {
    const fetchImpl = vi.fn((url) => okJson(url.includes('8901234567890') ? OFF_PRODUCT : { status: 0 }));
    expect((await lookupBarcode('8901234567890', fetchImpl)).name).toBe('Greek Yogurt');
    expect(fetchImpl.mock.calls[0][0]).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/8901234567890\.json/);
    expect(await lookupBarcode('0000000000000', fetchImpl)).toBeNull();
    await expect(lookupBarcode('12ab', fetchImpl)).rejects.toThrow(/barcode/);
    await expect(lookupBarcode('8901234567890', () => Promise.reject(new Error('offline')))).rejects.toThrow(/connection/);
  });
});

describe('food log', () => {
  it('cleans entries, totals a day and averages the week', () => {
    const today = todayKey();
    const log = sanitizeFoodLog([
      { id: 'a', date: today, name: 'Oats', meal: 'breakfast', totals: { kcal: 300, protein: 10, carbs: 50, fat: 6 } },
      { id: 'b', date: today, name: 'Dal', meal: 'lunch', totals: { kcal: 250, protein: 14, carbs: 30, fat: 5, fibre: 8 } },
      { id: 'c', date: today, name: 'No calories', totals: {} },
      { id: 'd', date: 'not-a-date', name: 'Bad', totals: { kcal: 10 } },
    ]);
    expect(log.map((e) => e.id)).toEqual(['a', 'b']);
    expect(dayTotals(log, today)).toMatchObject({ kcal: 550, protein: 24, fibre: 8 });
    expect(recentAverage(log, 7)).toMatchObject({ days: 1, kcal: 550 });
  });

  it('is per person and included in backups', () => {
    saveFoodLog([{ id: 'a', date: todayKey(), name: 'Oats', totals: { kcal: 300 } }]);
    const backup = exportBackupJson();
    createProfile('Partner');
    expect(loadFoodLog()).toEqual([]);
    importBackupJson(backup);
    expect(loadFoodLog()).toHaveLength(1);
  });
});

const mealDay = (day, training) => ({
  day,
  training,
  meals: [
    { slot: 'Breakfast', name: 'Veg poha with peanuts', items: ['Poha, 60 g', 'Peanuts, 15 g'], kcal: 500, protein: 20, carbs: 70, fat: 15, fibre: 6 },
    { slot: 'Lunch', name: 'Rajma rice', items: ['Rajma, 150 g', 'Rice, 150 g'], kcal: 900, protein: 45, carbs: 120, fat: 20, fibre: 14 },
    { slot: 'Dinner', name: 'Paneer tikka with roti', items: ['Paneer, 120 g', '2 roti'], kcal: 800, protein: 50, carbs: 70, fat: 30, fibre: 8 },
  ],
});
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const mealPlanReply = () => ({
  candidates: [{ finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 5000, totalTokenCount: 6500 },
  text: JSON.stringify({ days: WEEK.map((d, i) => mealDay(d, [0, 1, 3, 4].includes(i))), tips: ['Batch-cook rajma on Sunday.'], shopping: ['Rajma, 1 kg', 'Paneer, 500 g'] }),
});

describe('weekly meal plan', () => {
  it('asks Gemini to hit the app\'s targets and respect diet, allergies and training days', async () => {
    mockGenerateContent.mockResolvedValueOnce(mealPlanReply());
    const profile = base({ diet: { dietType: 'vegetarian', allergies: ['peanuts'], mealsPerDay: 3, avoid: 'mushrooms' } });
    const plan = await generateMealPlan({ profile, plan: null, apiKey: 'k', model: 'm' });
    expect(plan.days).toHaveLength(7);
    expect(plan.days[0].totals.kcal).toBe(2200);
    const prompt = mockGenerateContent.mock.calls[0][0].contents[0].parts[0].text;
    const t = computeTargets(profile, null);
    expect(prompt).toContain('Diet: Vegetarian');
    expect(prompt).toContain('ALLERGIES, never include: Peanuts');
    expect(prompt).toContain('mushrooms');
    expect(prompt).toContain('Training days: Monday, Tuesday, Thursday, Friday');
    expect(prompt).toContain(`${t.trainingDay.kcal} kcal, ${t.protein} g protein`);
    expect(loadUsage().at(-1)).toMatchObject({ feature: 'meal_plan', ok: true });
    await expect(generateMealPlan({ profile, apiKey: '' })).rejects.toThrow(/API key/);
  });

  it('cleans a stored plan', () => {
    expect(sanitizeMealPlan({ days: [] })).toBeNull();
    const p = sanitizeMealPlan({ days: [{ day: 'Monday', meals: [{ name: 'X', items: ['a'], kcal: '300', protein: 'lots' }] }] });
    expect(p.days[0].meals[0]).toMatchObject({ kcal: 300, protein: 0 });
  });
});

describe('coach context', () => {
  it('includes targets, diet and the week\'s intake', () => {
    const profile = base({ diet: { dietType: 'vegan' } });
    const s = summarizeNutrition(profile, null, [{ id: 'a', date: todayKey(), name: 'Tofu', totals: { kcal: 400, protein: 30 } }]);
    expect(s).toMatch(/Diet: Vegan/);
    expect(s).toMatch(/Targets: \d+ kcal training days/);
    expect(s).toMatch(/average of 1 day\(s\) this week: 400 kcal, 30 g protein/);
  });
});

describe('Nutrition screen', () => {
  function setup(over = {}, props = {}) {
    const onProfileChange = vi.fn();
    const user = userEvent.setup();
    render(<NutritionView profile={base(over)} onProfileChange={onProfileChange} plan={null} apiKey="k" model="m" {...props} />);
    return { user, onProfileChange };
  }

  it('shows the targets with the reasons from the blood report', () => {
    setup({ labs: labs([{ name: 'Vitamin D', value: 15, unit: 'ng/mL' }]) });
    expect(screen.getByRole('heading', { name: 'Your daily targets' })).toBeInTheDocument();
    expect(screen.getByText(/and your latest blood report/)).toBeInTheDocument();
    expect(screen.getByText('Vitamin D is low.')).toBeInTheDocument();
  });

  it('adds a food by hand and updates the day', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add by hand' }));
    await user.type(screen.getByPlaceholderText(/Home-made dal/), 'Dal bowl');
    await user.type(screen.getByRole('spinbutton', { name: 'Calories' }), '320');
    await user.type(screen.getByRole('spinbutton', { name: 'Protein g' }), '18');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Dal bowl')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Calories' })).toHaveAttribute('aria-valuenow', '320');
    expect(loadFoodLog()[0]).toMatchObject({ name: 'Dal bowl', source: 'manual' });
    await user.click(screen.getByRole('button', { name: 'Remove Dal bowl' }));
    expect(loadFoodLog()).toHaveLength(0);
  });

  it('looks up a barcode, warns about allergens and logs the amount', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson(OFF_PRODUCT)));
    const { user } = setup({ diet: { dietType: 'vegetarian', allergies: ['milk'] } });
    await user.click(screen.getByRole('button', { name: 'Scan barcode' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/camera/i); // no camera in tests: typing works
    await user.type(screen.getByLabelText('Barcode number'), '8901234567890');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByRole('heading', { name: 'Greek Yogurt' })).toBeInTheDocument();
    expect(screen.getByText(/Contains dairy/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /200 g/ }));
    await user.click(screen.getByRole('button', { name: /^Add to / }));
    expect(loadFoodLog()[0]).toMatchObject({ name: 'Greek Yogurt', barcode: '8901234567890', grams: 200, source: 'scan', totals: expect.objectContaining({ kcal: 200, protein: 18 }) });
  });

  it('builds the weekly plan and logs a meal from it', async () => {
    mockGenerateContent.mockResolvedValueOnce(mealPlanReply());
    const { user } = setup({ diet: { dietType: 'vegetarian', allergies: ['peanuts'] } });
    await user.click(screen.getByRole('button', { name: /Build my meal plan/ }));
    const card = await screen.findByRole('region', { name: 'Weekly meal plan' });
    await user.click(within(card).getByRole('tab', { name: /Mon/ }));
    expect(within(card).getByText('Veg poha with peanuts')).toBeInTheDocument();
    expect(within(card).getByText(/may contain Peanuts/)).toBeInTheDocument();
    expect(loadMealPlan().days).toHaveLength(7);
    await user.click(within(card).getAllByRole('button', { name: 'I ate this' })[1]);
    expect(loadFoodLog()[0]).toMatchObject({ name: 'Rajma rice', meal: 'lunch', source: 'plan' });
  });
});

describe('Health tab', () => {
  it('switches between blood reports and nutrition', async () => {
    const { default: App } = await import('../App');
    const { saveProfile, saveOnboarded } = await import('../services/storage');
    saveProfile(base());
    saveOnboarded(true);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Health' }));
    expect(screen.getByRole('tab', { name: 'Blood reports' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Nutrition' }));
    expect(screen.getByRole('heading', { name: 'Your daily targets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan barcode' })).toBeInTheDocument();
  });
});
