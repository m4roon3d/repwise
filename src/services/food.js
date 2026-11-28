// Food log, Open Food Facts lookups (barcode and name), and the stored weekly meal plan.
// Open Food Facts is a free, open database: no key, called straight from the browser.

export const NUTRIENTS = [
  { id: 'kcal', label: 'Calories', unit: 'kcal' },
  { id: 'protein', label: 'Protein', unit: 'g' },
  { id: 'carbs', label: 'Carbs', unit: 'g' },
  { id: 'fat', label: 'Fat', unit: 'g' },
  { id: 'fibre', label: 'Fibre', unit: 'g' },
  { id: 'sugars', label: 'Sugars', unit: 'g' },
  { id: 'satFat', label: 'Saturated fat', unit: 'g' },
  { id: 'sodium', label: 'Sodium', unit: 'mg' },
];
export const MEAL_SLOTS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snacks' },
];
const OFF = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,generic_name,brands,nutriments,serving_size,serving_quantity,image_front_small_url,nutriscore_grade,nova_group,allergens_tags,ingredients_analysis_tags';
const MAX_ENTRIES = 3000;

const num = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const r1 = (n) => Math.round(n * 10) / 10;

export const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const isBarcode = (code) => /^\d{8,14}$/.test(String(code || '').trim());

/** Per-100 g values from an Open Food Facts product. Missing values stay null (unknown), never 0. */
export function per100FromOff(nutriments = {}) {
  let kcal = num(nutriments['energy-kcal_100g']);
  if (kcal == null && num(nutriments.energy_100g) != null) kcal = num(nutriments.energy_100g) / 4.184; // kJ
  let sodium = num(nutriments.sodium_100g);
  if (sodium == null && num(nutriments.salt_100g) != null) sodium = num(nutriments.salt_100g) / 2.5;
  return {
    kcal: kcal == null ? null : Math.round(kcal),
    protein: num(nutriments.proteins_100g),
    carbs: num(nutriments.carbohydrates_100g),
    fat: num(nutriments.fat_100g),
    fibre: num(nutriments.fiber_100g),
    sugars: num(nutriments.sugars_100g),
    satFat: num(nutriments['saturated-fat_100g']),
    sodium: sodium == null ? null : Math.round(sodium * 1000), // g → mg
  };
}

/** A clean product from an Open Food Facts record, or null when it has no usable name or calories. */
export function productFromOff(p) {
  if (!p || typeof p !== 'object') return null;
  const per100 = per100FromOff(p.nutriments);
  const name = str(p.product_name, 80) || str(p.generic_name, 80);
  if (!name || per100.kcal == null) return null;
  const tags = (a) => (Array.isArray(a) ? a.filter((t) => typeof t === 'string').map((t) => t.replace(/^en:/, '')) : []);
  const analysis = tags(p.ingredients_analysis_tags);
  return {
    barcode: isBarcode(p.code) ? String(p.code) : '',
    name,
    brand: str(String(p.brands || '').split(',')[0], 40),
    per100,
    servingG: num(p.serving_quantity) && num(p.serving_quantity) < 2000 ? num(p.serving_quantity) : null,
    servingLabel: str(p.serving_size, 30),
    image: typeof p.image_front_small_url === 'string' && p.image_front_small_url.startsWith('https://images.openfoodfacts.org/') ? p.image_front_small_url : '',
    nutriscore: /^[a-e]$/.test(p.nutriscore_grade || '') ? p.nutriscore_grade : '',
    nova: [1, 2, 3, 4].includes(Number(p.nova_group)) ? Number(p.nova_group) : null,
    allergens: tags(p.allergens_tags),
    vegan: analysis.includes('vegan') ? true : analysis.includes('non-vegan') ? false : null,
    vegetarian: analysis.includes('vegetarian') ? true : analysis.includes('non-vegetarian') ? false : null,
  };
}

async function getJson(url, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error("Couldn't reach the food database. Check your connection and try again.");
  }
  if (!res.ok && res.status !== 404) throw new Error(`The food database is busy (error ${res.status}). Try again in a moment.`);
  return res.json();
}

/** Looks a barcode up. Returns the product, or null when it isn't in the database. */
export async function lookupBarcode(code, fetchImpl) {
  const c = String(code || '').trim();
  if (!isBarcode(c)) throw new Error('That doesn\'t look like a barcode (8 to 14 digits).');
  const data = await getJson(`${OFF}/api/v2/product/${c}.json?fields=${FIELDS}`, fetchImpl);
  if (!data || data.status === 0 || !data.product) return null;
  return productFromOff({ ...data.product, code: c });
}

/** Searches products by name. */
export async function searchFoods(query, fetchImpl) {
  const q = str(query, 80);
  if (q.length < 2) return [];
  const data = await getJson(`${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=15&fields=${FIELDS}`, fetchImpl);
  return (Array.isArray(data?.products) ? data.products : []).map(productFromOff).filter(Boolean).slice(0, 12);
}

/** Totals for an amount of a product (grams). */
export function scaleNutrients(per100, grams) {
  const out = {};
  for (const n of NUTRIENTS) {
    const v = per100?.[n.id];
    out[n.id] = v == null ? null : n.id === 'kcal' || n.id === 'sodium' ? Math.round((v * grams) / 100) : r1((v * grams) / 100);
  }
  return out;
}

/** Product facts that clash with the person's diet or allergies. */
export function productWarnings(product, diet) {
  const out = [];
  const allergies = diet?.allergies || [];
  for (const a of allergies) if (product?.allergens?.includes(a)) out.push(`Contains ${a.replace(/[-_]/g, ' ').replace('milk', 'dairy')}`);
  const type = diet?.dietType;
  if (type === 'vegan' && product?.vegan === false) out.push('Not vegan');
  if (['vegetarian', 'eggetarian'].includes(type) && product?.vegetarian === false) out.push('Not vegetarian');
  return out;
}

// ---- Log -------------------------------------------------------------------------------------------

function sanitizeNutrients(raw) {
  const out = {};
  for (const n of NUTRIENTS) {
    const v = num(raw?.[n.id]);
    out[n.id] = v == null ? null : Math.min(v, n.id === 'sodium' ? 100000 : n.id === 'kcal' ? 20000 : 2000);
  }
  return out;
}

export function sanitizeFoodEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name, 80);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  if (!name || !date) return null;
  const totals = sanitizeNutrients(raw.totals);
  if (totals.kcal == null) return null;
  return {
    id: str(raw.id, 40) || `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date,
    ts: Number.isFinite(raw.ts) ? raw.ts : Date.now(),
    meal: MEAL_SLOTS.some((m) => m.id === raw.meal) ? raw.meal : 'snack',
    name,
    brand: str(raw.brand, 40),
    barcode: isBarcode(raw.barcode) ? String(raw.barcode) : '',
    source: ['scan', 'search', 'manual', 'plan', 'photo'].includes(raw.source) ? raw.source : 'manual',
    grams: num(raw.grams) && num(raw.grams) <= 5000 ? num(raw.grams) : null,
    per100: raw.per100 ? sanitizeNutrients(raw.per100) : null,
    totals,
  };
}

export function sanitizeFoodLog(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map(sanitizeFoodEntry)
    .filter((e) => e && !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => a.ts - b.ts)
    .slice(-MAX_ENTRIES);
}

export function dayTotals(log, date) {
  const out = Object.fromEntries(NUTRIENTS.map((n) => [n.id, 0]));
  for (const e of log) if (e.date === date) for (const n of NUTRIENTS) out[n.id] += e.totals[n.id] || 0;
  for (const n of NUTRIENTS) out[n.id] = n.id === 'kcal' || n.id === 'sodium' ? Math.round(out[n.id]) : r1(out[n.id]);
  return out;
}

/** Average daily intake over the last `days` days that have any entries (for the coach). */
export function recentAverage(log, days = 7, now = new Date()) {
  const keys = new Set();
  for (let i = 0; i < days; i++) keys.add(todayKey(new Date(now.getTime() - i * 86400000)));
  const logged = [...keys].filter((k) => log.some((e) => e.date === k));
  if (!logged.length) return null;
  const sum = Object.fromEntries(NUTRIENTS.map((n) => [n.id, 0]));
  for (const k of logged) {
    const t = dayTotals(log, k);
    for (const n of NUTRIENTS) sum[n.id] += t[n.id];
  }
  return { days: logged.length, ...Object.fromEntries(NUTRIENTS.map((n) => [n.id, Math.round(sum[n.id] / logged.length)])) };
}

// ---- Weekly meal plan --------------------------------------------------------------------------------

const intOr0 = (v) => Math.max(0, Math.min(10000, Math.round(Number(v) || 0)));

export function sanitizeMealPlan(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days)) return null;
  const days = raw.days.slice(0, 7).map((d, i) => {
    const meals = (Array.isArray(d?.meals) ? d.meals : []).slice(0, 6).map((m) => ({
      slot: str(m?.slot, 20) || 'Meal',
      name: str(m?.name, 80) || 'Meal',
      items: (Array.isArray(m?.items) ? m.items : []).map((x) => str(x, 80)).filter(Boolean).slice(0, 8),
      kcal: intOr0(m?.kcal),
      protein: intOr0(m?.protein),
      carbs: intOr0(m?.carbs),
      fat: intOr0(m?.fat),
      fibre: intOr0(m?.fibre),
    })).filter((m) => m.items.length || m.name !== 'Meal');
    const sum = (k) => meals.reduce((a, m) => a + m[k], 0);
    return {
      day: str(d?.day, 12) || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i],
      training: d?.training === true,
      meals,
      totals: { kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'), fibre: sum('fibre') },
    };
  }).filter((d) => d.meals.length);
  if (!days.length) return null;
  return {
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    model: str(raw.model, 40),
    targetKcal: intOr0(raw.targetKcal),
    days,
    tips: (Array.isArray(raw.tips) ? raw.tips : []).map((t) => str(t, 200)).filter(Boolean).slice(0, 6),
    shopping: (Array.isArray(raw.shopping) ? raw.shopping : []).map((t) => str(t, 60)).filter(Boolean).slice(0, 40),
  };
}

// ---- Faster logging: recent foods, favourites, saved meals -----------------------------------------

export const foodKey = (e) => `${String(e?.name || '').toLowerCase().trim()}|${String(e?.brand || '').toLowerCase().trim()}`;

/** The reusable part of a log entry (no id, date or time). */
export function templateFrom(e) {
  const clean = sanitizeFoodEntry({ ...e, id: 'tmp', date: '2000-01-01' });
  if (!clean) return null;
  const { name, brand, barcode, source, grams, per100, totals, meal } = clean;
  return { name, brand, barcode, source, grams, per100, totals, meal };
}

/** New log entries from templates, for a date and meal. */
export function entriesFrom(templates, date, meal) {
  const now = Date.now();
  return templates.map((t, i) => ({ ...t, id: `f_${now.toString(36)}_${i}${Math.random().toString(36).slice(2, 5)}`, date, ts: now + i, meal: meal || t.meal || 'snack' }));
}

/** Distinct foods logged most recently, newest first. */
export function recentFoods(log, n = 8, exclude = new Set()) {
  const seen = new Set(exclude);
  const out = [];
  for (let i = log.length - 1; i >= 0 && out.length < n; i--) {
    const k = foodKey(log[i]);
    if (seen.has(k)) continue;
    seen.add(k);
    const t = templateFrom(log[i]);
    if (t) out.push(t);
  }
  return out;
}

export function sanitizeFoodLibrary(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const favourites = (Array.isArray(src.favourites) ? src.favourites : [])
    .map(templateFrom)
    .filter((t) => t && !seen.has(foodKey(t)) && seen.add(foodKey(t)))
    .slice(0, 40);
  const meals = (Array.isArray(src.meals) ? src.meals : [])
    .map((m) => ({
      id: str(m?.id, 40) || `m_${Math.random().toString(36).slice(2, 9)}`,
      name: str(m?.name, 40),
      meal: MEAL_SLOTS.some((x) => x.id === m?.meal) ? m.meal : 'snack',
      items: (Array.isArray(m?.items) ? m.items : []).map(templateFrom).filter(Boolean).slice(0, 12),
    }))
    .filter((m) => m.name && m.items.length)
    .slice(0, 20);
  return { favourites, meals };
}

/** Entries from the day before for one meal, ready to copy. */
export function previousMeal(log, date, meal) {
  const prev = todayKey(new Date(new Date(`${date}T12:00:00`).getTime() - 86400000));
  return log.filter((e) => e.date === prev && e.meal === meal);
}

// ---- Water ---------------------------------------------------------------------------------------

export function sanitizeWater(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const days = Object.keys(src)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(Number(src[k])))
    .sort()
    .slice(-180);
  return Object.fromEntries(days.map((k) => [k, Math.max(0, Math.min(10000, Math.round(Number(src[k]))))]));
}

// ---- Trends ----------------------------------------------------------------------------------------

/** One row per day for the last `days` days, oldest first. */
export function dailySeries(log, water = {}, days = 14, now = new Date()) {
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = todayKey(new Date(now.getTime() - i * 86400000));
    const t = dayTotals(log, date);
    rows.push({ date, ...t, waterMl: water[date] || 0, logged: log.some((e) => e.date === date) });
  }
  return rows;
}
