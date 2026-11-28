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
    expect(screen.getByRole('button', { name: 'Remove Dal bowl' })).toBeInTheDocument();
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

// ---- Meal tracker: faster logging, water, photos, trends ------------------------------------------
import { recentFoods, sanitizeFoodLibrary, previousMeal, sanitizeWater, dailySeries } from '../services/food';
import { estimateMealPhoto } from '../services/geminiCoach';
import { saveFoodLibrary, loadFoodLibrary, loadWater } from '../services/storage';
import NutritionTrends from '../components/NutritionTrends';

const dayKey = (offset) => todayKey(new Date(Date.now() + offset * 86400000));
const entry = (id, name, date, meal = 'breakfast', kcal = 300, protein = 20, extra = {}) => ({ id, name, date, meal, ts: Number(id.replace(/\D/g, '')) || 1, totals: { kcal, protein, carbs: 30, fat: 10 }, ...extra });

describe('faster logging helpers', () => {
  it('lists recent foods once each, skipping favourites', () => {
    const log = sanitizeFoodLog([entry('e1', 'Oats', dayKey(-1)), entry('e2', 'Banana', dayKey(-1)), entry('e3', 'Oats', dayKey(0))]);
    expect(recentFoods(log).map((t) => t.name)).toEqual(['Oats', 'Banana']);
    expect(recentFoods(log, 8, new Set(['oats|'])).map((t) => t.name)).toEqual(['Banana']);
  });

  it('finds the previous day\'s meal and keeps water and the library tidy', () => {
    const log = sanitizeFoodLog([entry('e1', 'Oats', dayKey(-1)), entry('e2', 'Rice', dayKey(-1), 'lunch')]);
    expect(previousMeal(log, dayKey(0), 'breakfast').map((e) => e.name)).toEqual(['Oats']);
    expect(sanitizeWater({ [dayKey(0)]: 750.4, bad: 3, '2026-01-01': -5 })).toEqual({ '2026-01-01': 0, [dayKey(0)]: 750 });
    const lib = sanitizeFoodLibrary({ favourites: [entry('a', 'Oats', dayKey(0)), entry('b', 'Oats', dayKey(0))], meals: [{ name: 'Usual breakfast', meal: 'breakfast', items: [entry('c', 'Oats', dayKey(0))] }, { name: '', items: [] }] });
    expect(lib.favourites).toHaveLength(1);
    expect(lib.meals).toHaveLength(1);
    const series = dailySeries(log, { [dayKey(-1)]: 1500 }, 3);
    expect(series.map((r) => [r.kcal, r.waterMl, r.logged])).toEqual([[0, 0, false], [600, 1500, true], [0, 0, false]]);
  });
});

describe('photo logging', () => {
  const photo = { mimeType: 'image/jpeg', data: 'abc' };
  it('turns a plate photo into checked items and logs usage', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP' }],
      text: JSON.stringify({ is_food: true, meal_name: 'Dal rice', confidence: 'medium', note: 'Ghee amount is a guess.', items: [{ name: 'Dal', grams: 200, kcal: 230.6, protein: 14, carbs: 30, fat: 6, fibre: 8 }, { name: 'Rice', grams: 150, kcal: 195, protein: 4, carbs: 43, fat: 0, fibre: 1 }, { name: '', grams: 1, kcal: 1, protein: 0, carbs: 0, fat: 0, fibre: 0 }] }),
    });
    const r = await estimateMealPhoto({ photo, note: '2 katoris of moong dal', apiKey: 'k', model: 'm' });
    expect(r).toMatchObject({ mealName: 'Dal rice', confidence: 'medium' });
    expect(r.items).toEqual([expect.objectContaining({ name: 'Dal', kcal: 231 }), expect.objectContaining({ name: 'Rice' })]);
    const parts = mockGenerateContent.mock.calls[0][0].contents[0].parts;
    expect(parts[0].inlineData).toEqual(photo);
    expect(parts[1].text).toContain('2 katoris of moong dal');
    expect(loadUsage().at(-1)).toMatchObject({ feature: 'food_photo', ok: true });
  });

  it('rejects photos that aren\'t food and needs a key', async () => {
    mockGenerateContent.mockResolvedValueOnce({ candidates: [{ finishReason: 'STOP' }], text: JSON.stringify({ is_food: false, meal_name: '', confidence: 'low', note: '', items: [] }) });
    await expect(estimateMealPhoto({ photo, apiKey: 'k', model: 'm' })).rejects.toThrow(/doesn't look like food/);
    await expect(estimateMealPhoto({ photo, apiKey: '' })).rejects.toThrow(/API key/);
  });
});

describe('meal tracker screen', () => {
  function setup(props = {}) {
    const user = userEvent.setup();
    render(<NutritionView profile={base()} onProfileChange={vi.fn()} plan={null} apiKey="k" model="m" {...props} />);
    return { user };
  }

  it('copies yesterday\'s breakfast, stars a food and re-adds it from quick add', async () => {
    saveFoodLog([entry('e1', 'Masala oats', dayKey(-1), 'breakfast', 350, 12)]);
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Copy breakfast from the day before' }));
    expect(loadFoodLog().filter((e) => e.date === dayKey(0))).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Favourite Masala oats' }));
    expect(loadFoodLibrary().favourites[0].name).toBe('Masala oats');
    const quick = screen.getByRole('group', { name: 'Quick add' });
    await user.click(within(quick).getByRole('button', { name: '★ Masala oats' }));
    expect(loadFoodLog().filter((e) => e.date === dayKey(0))).toHaveLength(2);
  });

  it('saves a meal and adds the whole meal in one tap', async () => {
    saveFoodLog([entry('e1', 'Poha', dayKey(0)), entry('e2', 'Chai', dayKey(0), 'breakfast', 90, 3)]);
    vi.stubGlobal('prompt', () => 'Weekday breakfast');
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Save as meal' }));
    expect(loadFoodLibrary().meals[0]).toMatchObject({ name: 'Weekday breakfast', meal: 'breakfast' });
    await user.click(within(screen.getByRole('group', { name: 'Quick add' })).getByRole('button', { name: '🍽 Weekday breakfast' }));
    expect(loadFoodLog().filter((e) => e.meal === 'breakfast')).toHaveLength(4);
  });

  it('tracks water', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '+ Glass (250 ml)' }));
    await user.click(screen.getByRole('button', { name: '+ Bottle (500 ml)' }));
    await user.click(screen.getByRole('button', { name: 'Remove 250 ml' }));
    expect(loadWater()[todayKey()]).toBe(500);
    expect(screen.getByRole('progressbar', { name: 'Water' })).toHaveAttribute('aria-valuenow', '0.5');
  });

  it('logs items estimated from a photo after you adjust them', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP' }],
      text: JSON.stringify({ is_food: true, meal_name: 'Dal rice', confidence: 'medium', note: '', items: [{ name: 'Dal', grams: 200, kcal: 240, protein: 14, carbs: 30, fat: 6, fibre: 8 }, { name: 'Pickle', grams: 15, kcal: 40, protein: 0, carbs: 2, fat: 4, fibre: 0 }] }),
    });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Photo' }));
    await user.upload(screen.getByLabelText('Meal photo'), new File(['x'], 'plate.jpg', { type: 'image/jpeg' }));
    await user.click(await screen.findByRole('button', { name: 'Estimate' }));
    const grams = await screen.findByLabelText('Dal grams');
    await user.clear(grams);
    await user.type(grams, '100');
    await user.click(screen.getByRole('button', { name: 'Leave out Pickle' }));
    await user.click(screen.getByRole('button', { name: /^Add 1 item · 120 kcal/ }));
    expect(loadFoodLog()[0]).toMatchObject({ name: 'Dal', grams: 100, source: 'photo', totals: expect.objectContaining({ kcal: 120, protein: 7 }) });
  });
});

describe('nutrition trends', () => {
  it('averages logged days against targets', () => {
    const t = computeTargets(base(), null);
    saveFoodLog([entry('e1', 'A', dayKey(-1), 'lunch', t.kcal, t.protein), entry('e2', 'B', dayKey(-2), 'lunch', 1000, 40), entry('e3', 'Today so far', dayKey(0), 'breakfast', 200, 5)]);
    render(<NutritionTrends profile={base()} plan={null} />);
    const card = screen.getByRole('region', { name: 'Nutrition trends' });
    expect(within(card).getByText(Math.round((t.kcal + 1000) / 2).toLocaleString())).toBeInTheDocument();
    expect(within(card).getByText('days protein hit')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: /^Calories per day/ })).toBeInTheDocument();
  });

  it('nudges to start logging when there is nothing yet', async () => {
    const onOpen = vi.fn();
    render(<NutritionTrends profile={base()} plan={null} onOpen={onOpen} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Start logging/ }));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('scrolling', () => {
  it('never scrolls the page when the Nutrition screen redraws', async () => {
    const { saveMealPlan } = await import('../services/storage');
    saveMealPlan(JSON.parse(mealPlanReply().text));
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const props = { onProfileChange: vi.fn(), plan: null, apiKey: 'k', model: 'm' };
    const { rerender } = render(<NutritionView profile={base()} {...props} />);
    for (let i = 0; i < 3; i++) rerender(<NutritionView profile={base()} {...props} />); // e.g. the top bar changing on scroll
    expect(screen.getByRole('tablist', { name: 'Day' })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    delete Element.prototype.scrollIntoView;
  });
});
