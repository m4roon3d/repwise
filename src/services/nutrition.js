// Nutrition targets that move with the training plan, the person's health and their latest blood report.
// Everything here is deterministic and local: the AI meal plan is asked to hit these numbers, never to set them.
import { analyzeLabs } from './labs';

export const DIET_TYPES = [
  { id: 'omnivore', label: 'Eats everything' },
  { id: 'pescatarian', label: 'Fish, no meat' },
  { id: 'eggetarian', label: 'Vegetarian + eggs' },
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
];
export const ALLERGENS = [
  { id: 'peanuts', label: 'Peanuts', words: ['peanut', 'groundnut'] },
  { id: 'tree_nuts', label: 'Tree nuts', words: ['almond', 'cashew', 'walnut', 'pistachio', 'hazelnut', 'pecan'] },
  { id: 'milk', label: 'Dairy', words: ['milk', 'paneer', 'cheese', 'yogurt', 'yoghurt', 'curd', 'whey', 'butter', 'ghee', 'cream'] },
  { id: 'eggs', label: 'Eggs', words: ['egg'] },
  { id: 'gluten', label: 'Gluten', words: ['wheat', 'roti', 'chapati', 'bread', 'pasta', 'barley', 'rye', 'semolina', 'rava', 'couscous', 'seitan'] },
  { id: 'soybeans', label: 'Soy', words: ['soy', 'tofu', 'tempeh', 'edamame'] },
  { id: 'fish', label: 'Fish', words: ['fish', 'salmon', 'tuna', 'sardine', 'mackerel', 'cod'] },
  { id: 'crustaceans', label: 'Shellfish', words: ['prawn', 'shrimp', 'crab', 'lobster'] },
  { id: 'sesame-seeds', label: 'Sesame', words: ['sesame', 'tahini'] },
];
const MEAT_WORDS = ['chicken', 'mutton', 'lamb', 'beef', 'pork', 'turkey', 'bacon', 'ham', 'sausage', 'goat', 'keema'];
const SEAFOOD_WORDS = ['fish', 'salmon', 'tuna', 'sardine', 'mackerel', 'cod', 'prawn', 'shrimp', 'crab'];
const EGG_WORDS = ['egg', 'omelette', 'omelet'];
const ANIMAL_WORDS = ['milk', 'paneer', 'cheese', 'yogurt', 'yoghurt', 'curd', 'whey', 'butter', 'ghee', 'honey', 'cream'];

const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

export const DEFAULT_DIET = { dietType: 'omnivore', allergies: [], mealsPerDay: 3, avoid: '', cuisines: '' };

export function sanitizeDiet(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    dietType: DIET_TYPES.some((d) => d.id === src.dietType) ? src.dietType : DEFAULT_DIET.dietType,
    allergies: Array.isArray(src.allergies) ? ALLERGENS.map((a) => a.id).filter((id) => src.allergies.includes(id)) : [],
    mealsPerDay: [3, 4, 5].includes(Number(src.mealsPerDay)) ? Number(src.mealsPerDay) : 3,
    avoid: str(src.avoid, 120),
    cuisines: str(src.cuisines, 80),
  };
}

const round = (n, to = 5) => Math.round(n / to) * to;
const ACTIVITY_BASE = { sedentary: 1.2, light: 1.3, active: 1.4, very_active: 1.5 };

/**
 * Daily targets.
 * @returns {{kcal, trainingDay:{kcal,carbs}, restDay:{kcal,carbs}, protein, fat, carbs, fibre, satFatMax, sugarMax, sodiumMax, waterL,
 *   bmr, tdee, goalLabel, notes:[{id,title,text}], trainingDays:number}}
 */
export function computeTargets(profile, plan) {
  const p = profile || {};
  const kg = Number(p.weightKg) || 70;
  const cm = Number(p.heightCm) || 170;
  const age = Number(p.age) || 30;
  const sexAdj = p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78;
  const bmr = 10 * kg + 6.25 * cm - 5 * age + sexAdj;

  const trainingDays = Math.max(0, Math.min(7, plan?.weeks?.[0]?.days?.length || Number(p.daysPerWeek) || 3));
  const minutes = Number(p.sessionMinutes) || 45;
  const base = ACTIVITY_BASE[p.preferences?.activity] || 1.3;
  // Training adds roughly 5 kcal per kg per hour of mixed strength work, spread over the week.
  const trainingKcalWeek = trainingDays * (minutes / 60) * kg * 5;
  const tdee = bmr * base + trainingKcalWeek / 7;

  const conditions = p.health?.conditions || [];
  const pregnancy = p.health?.pregnancy || 'none';
  const pregnant = pregnancy.startsWith('pregnant');
  const notes = [];
  const note = (id, title, text) => notes.push({ id, title, text });

  // ---- Calories by goal, with safety floors.
  let factor = 1;
  let goalLabel = 'Maintain weight, fuel training';
  if (p.goal === 'fat_loss_conditioning') {
    factor = 0.82;
    goalLabel = 'Steady fat loss, about 0.5 kg a week';
  } else if (p.goal === 'strength_hypertrophy') {
    factor = 1.08;
    goalLabel = 'Lean muscle gain, a small surplus';
  }
  if (pregnant || pregnancy === 'postpartum_early') {
    factor = 1;
    goalLabel = pregnant ? 'Support a healthy pregnancy' : 'Recovery after birth';
  }
  let kcal = tdee * factor;
  if (pregnancy === 'pregnant_t2') kcal += 340;
  if (pregnancy === 'pregnant_t3') kcal += 450;
  if (pregnancy === 'postpartum' && factor < 1) kcal = Math.max(kcal, tdee * 0.9);
  const floor = Math.max(bmr * 1.1, p.sex === 'male' ? 1500 : 1200);
  if (kcal < floor) kcal = floor;
  kcal = round(kcal, 10);

  // ---- Protein (g/kg), on an adjusted weight when BMI is high.
  const bmi = kg / (cm / 100) ** 2;
  const refKg = bmi > 30 ? 25 * (cm / 100) ** 2 : kg;
  let gPerKg = { strength_hypertrophy: 1.8, fat_loss_conditioning: 2.0, mobility_longevity: 1.2, rebuild_consistency: 1.4 }[p.goal] || 1.4;
  if (age >= 50) gPerKg = Math.max(gPerKg, 1.4);
  if (pregnant) gPerKg = Math.max(gPerKg, 1.2);

  // ---- The blood report.
  const results = p.labs?.markers?.length ? analyzeLabs(p.labs, p.sex).results : [];
  const flag = (id) => results.find((r) => r.id === id && (r.status === 'high' || r.status === 'low'))?.status;
  const lipids = flag('ldl') === 'high' || flag('total_cholesterol') === 'high';
  const lowHdl = flag('hdl') === 'low';
  const highTg = flag('triglycerides') === 'high';
  const sugar = conditions.includes('diabetes') || flag('hba1c') === 'high' || flag('fasting_glucose') === 'high';
  const kidney = flag('creatinine') === 'high';

  if (kidney) {
    gPerKg = Math.min(gPerKg, 0.8);
    note('kidney', 'Kidney marker is raised', 'Protein is kept moderate (0.8 g per kg) until your doctor says otherwise. Ask them before using protein powders.');
  }
  const protein = round(Math.min(refKg * Math.min(gPerKg, 2.2), 250), 5);

  // ---- Fat and carbs.
  const fatPct = sugar || highTg ? 0.3 : 0.27;
  const fat = round((kcal * fatPct) / 9, 5);
  let carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  if (sugar) carbs = Math.min(carbs, (kcal * 0.4) / 4);
  carbs = round(carbs, 5);

  // Training days get more carbs, rest days fewer, same weekly total.
  const rest = 7 - trainingDays;
  const shift = trainingDays && rest ? Math.round((carbs * 0.15) / 5) * 5 : 0;
  const trainCarbs = carbs + shift;
  const restCarbs = rest ? Math.max(0, round(carbs - (shift * trainingDays) / rest, 5)) : carbs;

  const fibre = Math.max(round((kcal / 1000) * 14, 1), lipids || sugar || highTg ? 30 : 25);
  const satFatMax = round((kcal * (lipids ? 0.07 : 0.1)) / 9, 1);
  const sugarMax = round((kcal * (highTg || sugar ? 0.05 : 0.1)) / 4, 1);
  const sodiumMax = conditions.includes('hypertension') ? 1500 : 2300;
  const waterL = Math.round(kg * 0.035 * 10 + (trainingDays ? 5 : 0)) / 10;

  // ---- What to focus on, from the same inputs.
  if (lipids) note('lipids', 'Cholesterol is high', `Saturated fat capped at ${satFatMax} g a day. Favour oats, beans, lentils, nuts and olive or mustard oil; fewer fried foods, butter, ghee and processed meat.`);
  if (lowHdl) note('hdl', 'HDL is low', 'Regular cardio, nuts, seeds and oily fish (or flax and walnuts) help raise HDL. Avoid trans fats in packaged snacks.');
  if (highTg) note('tg', 'Triglycerides are high', `Added sugar capped at ${sugarMax} g a day. Cut sugary drinks, sweets and refined flour; limit alcohol.`);
  if (sugar) note('sugar', 'Blood sugar needs care', 'Carbs are capped at 40% of calories and spread across meals, each with protein and fibre. Choose whole grains, dal and vegetables over white rice, bread and sweets.');
  if (flag('vitamin_d') === 'low') note('vitd', 'Vitamin D is low', 'Eggs, oily fish, fortified milk or plant milk, and 15–20 minutes of midday sun. Ask your doctor about a supplement.');
  if (flag('vitamin_b12') === 'low' || p.diet?.dietType === 'vegan') note('b12', p.diet?.dietType === 'vegan' ? 'Vitamin B12 on a vegan diet' : 'Vitamin B12 is low', 'Dairy, eggs, fish, or fortified foods; vegans usually need a B12 supplement. Ask your doctor.');
  if (flag('ferritin') === 'low' || flag('hemoglobin') === 'low') note('iron', 'Iron is low', 'Lentils, chickpeas, spinach, red meat or fish, with vitamin C (lemon, amla, citrus) at the same meal. Keep tea and coffee away from meals.');
  if (flag('crp') === 'high') note('crp', 'Inflammation is raised', 'Whole foods, vegetables of many colours, omega-3 (fish, flax, walnuts) and fewer ultra-processed snacks.');
  if (conditions.includes('hypertension')) note('bp', 'Blood pressure', 'Sodium kept under 1,500 mg. Go easy on pickles, papad, packaged snacks and added salt; potassium-rich vegetables and fruit help.');
  if (pregnant) note('preg', 'Pregnancy', 'No calorie deficit. Folate, iron, calcium and iodine matter; avoid raw fish, undercooked eggs and meat, unpasteurised cheese and alcohol. Follow your midwife or doctor.');
  if (p.goal === 'fat_loss_conditioning' && !pregnant) note('loss', 'Fat loss', `About ${round(tdee - kcal, 10)} kcal under maintenance. High protein keeps muscle while you lose fat.`);

  return {
    kcal,
    bmr: Math.round(bmr),
    tdee: round(tdee, 10),
    goalLabel,
    protein,
    fat,
    carbs,
    trainingDays,
    trainingDay: { kcal: round(protein * 4 + fat * 9 + trainCarbs * 4, 10), carbs: trainCarbs },
    restDay: { kcal: round(protein * 4 + fat * 9 + restCarbs * 4, 10), carbs: restCarbs },
    fibre,
    satFatMax,
    sugarMax,
    sodiumMax,
    waterL,
    notes,
  };
}

/** Which weekdays (0 = Mon) are training days, spread out: 3 → Mon Wed Fri. */
export function trainingWeekdays(n) {
  const map = { 0: [], 1: [2], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
  return map[Math.max(0, Math.min(7, n))];
}
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Words in a dish that clash with the person's diet type or allergies. */
export function dietClashes(text, diet) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const has = (w) => new RegExp(`\\b${w}`, 'i').test(t);
  const out = [];
  const type = diet?.dietType || 'omnivore';
  if (type !== 'omnivore' && MEAT_WORDS.some(has)) out.push('meat');
  if (['eggetarian', 'vegetarian', 'vegan'].includes(type) && SEAFOOD_WORDS.some(has)) out.push('fish');
  if (['vegetarian', 'vegan'].includes(type) && EGG_WORDS.some(has)) out.push('egg');
  if (type === 'vegan' && ANIMAL_WORDS.some((w) => has(w) && !has(`${w === 'milk' ? '(soy|oat|almond|coconut|plant) milk' : 'vegan ' + w}`))) out.push('animal products');
  for (const a of ALLERGENS) if ((diet?.allergies || []).includes(a.id) && a.words.some(has)) out.push(a.label);
  return [...new Set(out)];
}
