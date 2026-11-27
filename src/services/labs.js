// Blood-report markers: reference ranges, unit conversion and plain-language meaning.
// This never diagnoses. It flags values outside common adult reference ranges, explains why that matters for
// training, and says when to talk to a doctor. Ranges vary by lab; the report's own range wins when present.

const M = (id, name, unit, aliases, extra) => ({ id, name, unit, aliases, ...extra });

// `convert` maps other units to the canonical one. `ranges(sex)` returns { low, high } in canonical units.
export const MARKERS = [
  M('hemoglobin', 'Haemoglobin', 'g/dL', ['hemoglobin', 'haemoglobin', 'hb', 'hgb'], {
    convert: { 'g/l': (v) => v / 10, 'mmol/l': (v) => v * 1.611 },
    ranges: (sex) => (sex === 'male' ? { low: 13.5, high: 17.5 } : { low: 12.0, high: 15.5 }),
    low: { text: 'Low haemoglobin (possible anaemia) reduces how much oxygen reaches your muscles, so training feels harder and recovery is slower.', rpeCap: 7, doctor: true },
  }),
  M('ferritin', 'Ferritin (iron stores)', 'ng/mL', ['ferritin', 's. ferritin', 'serum ferritin'], {
    convert: { 'ug/l': (v) => v, 'µg/l': (v) => v },
    ranges: () => ({ low: 30, high: 300 }),
    low: { text: 'Low iron stores are a common, fixable cause of tiredness and poor endurance.', rpeCap: 7.5, doctor: true },
    high: { text: 'High ferritin can reflect inflammation or other causes; worth discussing with your doctor.', doctor: true },
  }),
  M('hba1c', 'HbA1c', '%', ['hba1c', 'a1c', 'glycated haemoglobin', 'glycated hemoglobin', 'glycosylated haemoglobin', 'glycosylated hemoglobin'], {
    convert: { 'mmol/mol': (v) => v / 10.929 + 2.15 },
    ranges: () => ({ low: 4.0, high: 5.6 }),
    bands: [{ min: 6.5, label: 'diabetes range' }, { min: 5.7, label: 'prediabetes range' }],
    high: { text: 'Blood sugar is running high. Strength training is one of the best tools for improving it; check your sugar around workouts if you take diabetes medication.', doctor: true, note: 'glucose' },
  }),
  M('fasting_glucose', 'Fasting glucose', 'mg/dL', ['fasting glucose', 'fasting blood sugar', 'fbs', 'glucose fasting', 'fasting plasma glucose', 'fpg', 'glucose'], {
    convert: { 'mmol/l': (v) => v * 18 },
    ranges: () => ({ low: 70, high: 99 }),
    bands: [{ min: 126, label: 'diabetes range' }, { min: 100, label: 'prediabetes range' }],
    high: { text: 'Fasting sugar is above the normal range. Regular training helps; keep a snack handy if you use glucose-lowering medication.', doctor: true, note: 'glucose' },
    low: { text: 'Low fasting sugar: eat something an hour or two before training.', doctor: false },
  }),
  M('vitamin_d', 'Vitamin D (25-OH)', 'ng/mL', ['vitamin d', '25-oh vitamin d', '25 hydroxy vitamin d', 'vit d', 'vitamin d3', '25(oh)d', 'vitamin d total'], {
    convert: { 'nmol/l': (v) => v / 2.496 },
    ranges: () => ({ low: 30, high: 100 }),
    low: { text: 'Low vitamin D is very common and is linked to muscle weakness and bone health. Ask your doctor about supplementing.', doctor: false },
  }),
  M('vitamin_b12', 'Vitamin B12', 'pg/mL', ['vitamin b12', 'b12', 'cobalamin', 'vit b12'], {
    convert: { 'pmol/l': (v) => v * 1.355 },
    ranges: () => ({ low: 200, high: 900 }),
    low: { text: 'Low B12 can cause fatigue and tingling; worth correcting with your doctor.', doctor: true },
  }),
  M('tsh', 'TSH (thyroid)', 'mIU/L', ['tsh', 'thyroid stimulating hormone', 'ultrasensitive tsh', 'us-tsh'], {
    convert: { 'uiu/ml': (v) => v, 'µiu/ml': (v) => v, 'miu/l': (v) => v },
    ranges: () => ({ low: 0.4, high: 4.5 }),
    high: { text: 'A high TSH can mean an under-active thyroid, which often shows up as low energy and slow recovery.', doctor: true, rpeCap: 7.5 },
    low: { text: 'A low TSH can mean an over-active thyroid, which raises heart rate; keep intensity moderate until checked.', doctor: true, rpeCap: 7 },
  }),
  M('total_cholesterol', 'Total cholesterol', 'mg/dL', ['total cholesterol', 'cholesterol total', 'cholesterol', 's. cholesterol'], {
    convert: { 'mmol/l': (v) => v * 38.67 },
    ranges: () => ({ low: 0, high: 199 }),
    high: { text: 'Cholesterol is above the desirable range. Regular training plus some cardio helps.', doctor: false, note: 'cardio' },
  }),
  M('ldl', 'LDL cholesterol', 'mg/dL', ['ldl', 'ldl cholesterol', 'ldl-c', 'ldl direct'], {
    convert: { 'mmol/l': (v) => v * 38.67 },
    ranges: () => ({ low: 0, high: 129 }),
    high: { text: 'LDL ("bad" cholesterol) is high. Exercise helps, and your doctor may suggest more.', doctor: true, note: 'cardio' },
  }),
  M('hdl', 'HDL cholesterol', 'mg/dL', ['hdl', 'hdl cholesterol', 'hdl-c'], {
    convert: { 'mmol/l': (v) => v * 38.67 },
    ranges: (sex) => ({ low: sex === 'male' ? 40 : 50, high: 1000 }),
    low: { text: 'HDL ("good" cholesterol) is low. Regular aerobic work is one of the few things that raises it.', doctor: false, note: 'cardio' },
  }),
  M('triglycerides', 'Triglycerides', 'mg/dL', ['triglycerides', 'triglyceride', 'tg', 'trigs'], {
    convert: { 'mmol/l': (v) => v * 88.57 },
    ranges: () => ({ low: 0, high: 149 }),
    high: { text: 'Triglycerides are high. Training, fewer refined carbs and less alcohol usually bring them down.', doctor: false, note: 'cardio' },
  }),
  M('crp', 'CRP (inflammation)', 'mg/L', ['crp', 'c-reactive protein', 'hs-crp', 'hscrp', 'c reactive protein'], {
    convert: { 'mg/dl': (v) => v * 10 },
    ranges: () => ({ low: 0, high: 3 }),
    high: { text: 'Raised inflammation marker. If you are or were recently unwell, ease off until it settles.', doctor: true, rpeCap: 7 },
  }),
  M('creatinine', 'Creatinine (kidney)', 'mg/dL', ['creatinine', 's. creatinine', 'serum creatinine'], {
    convert: { 'umol/l': (v) => v / 88.4, 'µmol/l': (v) => v / 88.4 },
    ranges: (sex) => (sex === 'male' ? { low: 0.7, high: 1.3 } : { low: 0.5, high: 1.1 }),
    high: { text: 'Creatinine is above range. It can be raised by muscle mass or hard training, but it is a kidney marker, so check with your doctor.', doctor: true },
  }),
];

export const MARKER_MAP = Object.fromEntries(MARKERS.map((m) => [m.id, m]));

/** Body systems, in the order the Health tab shows them. */
export const MARKER_GROUPS = [
  { id: 'lipids', label: 'Cholesterol & blood fats', short: 'cholesterol', ids: ['total_cholesterol', 'ldl', 'hdl', 'triglycerides'] },
  { id: 'sugar', label: 'Blood sugar', short: 'blood sugar', ids: ['fasting_glucose', 'hba1c'] },
  { id: 'vitamins', label: 'Vitamins', short: 'vitamins', ids: ['vitamin_d', 'vitamin_b12'] },
  { id: 'blood', label: 'Iron & blood', short: 'iron', ids: ['hemoglobin', 'ferritin'] },
  { id: 'thyroid', label: 'Thyroid', short: 'thyroid', ids: ['tsh'] },
  { id: 'inflammation', label: 'Inflammation', short: 'inflammation', ids: ['crp'] },
  { id: 'kidney', label: 'Kidney', short: 'kidney', ids: ['creatinine'] },
];
const GROUP_OF = Object.fromEntries(MARKER_GROUPS.flatMap((g) => g.ids.map((id) => [id, g.id])));
export const groupOf = (id) => GROUP_OF[id] || 'other';

/** Results sorted into body-system groups: [{ id, label, short, items }], empty groups dropped. */
export function groupResults(results) {
  const groups = [...MARKER_GROUPS, { id: 'other', label: 'Other', short: 'other results', ids: [] }].map((g) => ({ ...g, items: [] }));
  for (const r of results) groups.find((g) => g.id === groupOf(r.id)).items.push(r);
  return groups.filter((g) => g.items.length);
}

/** Marker name without the bracketed hint: "Vitamin D (25-OH)" → "Vitamin D". */
export const shortName = (r) => String(r?.name || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();

/** One plain line, e.g. "Mostly cholesterol & blood fats, plus low vitamins and raised inflammation." */
export function flaggedHeadline(flagged) {
  const groups = groupResults(flagged).sort((a, b) => b.items.length - a.items.length);
  if (!groups.length) return '';
  const word = (g) => {
    const dirs = new Set(g.items.map((r) => r.status));
    const lead = dirs.size === 1 ? (dirs.has('high') ? 'raised ' : 'low ') : '';
    if (g.items.length === 1 && g.ids.length > 1) {
      const n = shortName(g.items[0]);
      return `${lead}${/^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n}`;
    }
    return `${lead}${g.short}`;
  };
  const [first, ...rest] = groups;
  if (!rest.length) return `${first.items.length > 1 ? 'All in' : 'Just'} ${first.label.toLowerCase()}.`.replace('Just ', 'One result: ');
  const tail = rest.map(word);
  const list = tail.length > 1 ? `${tail.slice(0, -1).join(', ')} and ${tail.at(-1)}` : tail[0];
  return `${first.items.length > 1 ? 'Mostly' : 'Mainly'} ${first.label.toLowerCase()}, plus ${list}.`;
}

/** Ratios and derived lipids ("Chol/HDL ratio", "Non-HDL", "VLDL") are not the marker they mention. */
export function isDerivedName(name) {
  const n = String(name || '').toLowerCase();
  return /\bratio\b/.test(n) || /non[\s-]*hdl/.test(n) || /\bvldl\b/.test(n) || /(chol|hdl|ldl|tg|trig)[a-z.]*\s*\/\s*(chol|hdl|ldl|tg|trig)/.test(n);
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[()[\],:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Matches a printed test name to a known marker. Longest alias wins, so "LDL cholesterol" beats "cholesterol". */
export function matchMarker(name) {
  const n = norm(name);
  if (!n || isDerivedName(name)) return null;
  let best = null;
  for (const m of MARKERS) {
    for (const a of m.aliases) {
      const alias = norm(a);
      const hit = n === alias || new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}|\\]/g, '\\$&')}(\\s|$)`).test(n);
      if (hit && (!best || alias.length > best.len)) best = { id: m.id, len: alias.length };
    }
  }
  // "glucose" alone in a PP / random context is not fasting glucose.
  if (best?.id === 'fasting_glucose' && /\b(pp|post ?prandial|random|rbs|ppbs)\b/.test(n)) return null;
  return best?.id || null;
}

/** Converts a value to the marker's canonical unit. Unknown units are assumed canonical. */
export function toCanonical(markerId, value, unit) {
  const m = MARKER_MAP[markerId];
  const v = Number(value);
  if (!m || !Number.isFinite(v)) return null;
  const u = norm(unit).replace(/\s/g, '');
  if (!u || u === norm(m.unit).replace(/\s/g, '')) return v;
  const fn = m.convert?.[u];
  return fn ? Number(fn(v).toFixed(2)) : v;
}

/** Status of one marker value: { status: 'low'|'normal'|'high', band?, text?, doctor?, rpeCap?, note? }. */
export function assessMarker(markerId, canonicalValue, sex) {
  const m = MARKER_MAP[markerId];
  if (!m || !Number.isFinite(canonicalValue)) return null;
  const { low, high } = m.ranges(sex);
  const band = (m.bands || []).find((b) => canonicalValue >= b.min)?.label;
  if (canonicalValue < low) return { status: 'low', ...(m.low || {}), range: { low, high } };
  if (canonicalValue > high) return { status: 'high', band, ...(m.high || {}), range: { low, high } };
  return { status: 'normal', range: { low, high } };
}

/**
 * Turns stored lab entries into training adjustments.
 * entries: [{ id?, name, value, unit }] as stored on the profile.
 */
export function analyzeLabs(labs, sex) {
  const results = [];
  const seen = new Set();
  for (const e of labs?.markers || []) {
    const id = isDerivedName(e.name) ? null : e.id || matchMarker(e.name);
    // A report can print the same test twice (summary + detail page): count it once.
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const canonical = id ? toCanonical(id, e.value, e.unit) : null;
    const a = id ? assessMarker(id, canonical, sex) : null;
    results.push({
      id,
      name: id ? MARKER_MAP[id].name : e.name,
      value: e.value,
      unit: e.unit || (id ? MARKER_MAP[id].unit : ''),
      canonical,
      canonicalUnit: id ? MARKER_MAP[id].unit : null,
      ...(a || { status: 'unknown' }),
    });
  }
  const flagged = results.filter((r) => r.status === 'low' || r.status === 'high');
  const caps = flagged.map((r) => r.rpeCap).filter(Boolean);
  return {
    results,
    flagged,
    rpeCap: caps.length ? Math.min(...caps) : null,
    doctor: flagged.some((r) => r.doctor),
    wantsCardio: flagged.some((r) => r.note === 'cardio'),
    glucose: flagged.some((r) => r.note === 'glucose'),
  };
}

const MAX_MARKERS = 60;

export function sanitizeLabs(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.markers)) return null;
  const markers = raw.markers
    .filter((m) => m && typeof m.name === 'string' && m.name.trim() && Number.isFinite(Number(m.value)))
    .slice(0, MAX_MARKERS)
    .map((m) => {
      const id = isDerivedName(m.name) ? null : typeof m.id === 'string' && MARKER_MAP[m.id] ? m.id : matchMarker(m.name);
      return {
        id: id || null,
        name: m.name.trim().slice(0, 80),
        value: Number(m.value),
        unit: typeof m.unit === 'string' ? m.unit.trim().slice(0, 20) : '',
      };
    });
  if (!markers.length) return null;
  const date = typeof raw.date === 'string' ? raw.date.slice(0, 20) : '';
  const out = { date, source: raw.source === 'manual' ? 'manual' : 'upload', markers };
  const ai = Array.isArray(raw.aiAdjustments) ? raw.aiAdjustments.filter((x) => typeof x === 'string').map((x) => x.slice(0, 220)).slice(0, 6) : [];
  if (ai.length) out.aiAdjustments = ai;
  return out;
}

export function describeLabsForPrompt(labs, sex) {
  if (!labs?.markers?.length) return 'Not provided';
  const { flagged, results } = analyzeLabs(labs, sex);
  const known = results.filter((r) => r.id);
  const ai = labs.aiAdjustments?.length ? ` | Blood-report analysis suggests: ${labs.aiAdjustments.join('; ')}` : '';
  if (!flagged.length) return `${known.length} markers provided (${labs.date || 'undated'}), all within typical ranges${ai}`;
  return (
    flagged.map((r) => `${r.name} ${r.value} ${r.unit} (${r.status}${r.band ? `, ${r.band}` : ''})`).join('; ') +
    ` [report ${labs.date || 'undated'}]${ai}`
  );
}

// ---- Practical tips (offline fallback; the AI analysis adds personalised ones) --------------------
export const MARKER_TIPS = {
  hemoglobin: { low: ['Eat iron-rich foods (lentils, chickpeas, spinach, red meat, eggs) with vitamin C (lemon, amla, citrus) to boost absorption.', 'Keep tea and coffee away from meals; they block iron absorption.', 'Ask your doctor to check iron, B12 and folate to find the cause.'] },
  ferritin: { low: ['Pair iron-rich meals with vitamin C and avoid tea or coffee within an hour of them.', 'Ask your doctor whether an iron supplement is right for you; do not self-dose.'] },
  hba1c: { high: ['Lift weights 2 to 4 times a week; muscle is the biggest user of blood sugar.', 'Walk 10 to 15 minutes after your largest meals.', 'Swap refined carbs and sugary drinks for whole grains, dal, vegetables and protein.'] },
  fasting_glucose: { high: ['A 10 to 15 minute walk after meals lowers blood sugar spikes.', 'Prioritise sleep; one short night raises next-day glucose.', 'Build meals around protein and fibre; limit sweets and refined flour.'], low: ['Eat a balanced snack 1 to 2 hours before training.'] },
  vitamin_d: { low: ['Get 15 to 20 minutes of midday sun on arms and legs a few times a week.', 'Eat eggs, oily fish or fortified foods.', 'Ask your doctor about a vitamin D supplement and dose.'] },
  vitamin_b12: { low: ['Include eggs, dairy, fish or fortified foods; vegetarians often need a supplement.', 'Ask your doctor about B12 supplements or injections.'] },
  tsh: { high: ['Ask your doctor about a full thyroid panel before reading too much into one value.', 'Judge sessions by effort, not the weight on the bar; energy may vary.'], low: ['Keep sessions moderate until your doctor has reviewed it.'] },
  total_cholesterol: { high: ['Add 150 minutes a week of brisk walking, cycling or swimming.', 'More fibre: oats, dal, fruit, vegetables; fewer fried and processed foods.'] },
  ldl: { high: ['Regular cardio plus strength training both help lower LDL.', 'Cut back on fried food, ghee-heavy and processed snacks; add nuts, oats and fibre.', 'Ask your doctor whether you need more than lifestyle changes.'] },
  hdl: { low: ['Aerobic exercise is one of the few things that raises HDL: aim for 30 minutes most days.', 'Stop smoking if you smoke; it lowers HDL.'] },
  triglycerides: { high: ['Cut sugary drinks, sweets and alcohol; they drive triglycerides up fast.', 'Daily brisk walks and regular training bring them down within weeks.'] },
  crp: { high: ['If you are unwell, rest and recover before training hard.', 'Sleep, a less processed diet and regular moderate exercise lower inflammation over time.'] },
  creatinine: { high: ['Drink enough water, especially around training.', 'Mention any protein powders or creatine you take to your doctor; they can raise this number.'] },
};

export function tipsFor(id, status) {
  return MARKER_TIPS[id]?.[status] || [];
}

// ---- Report history --------------------------------------------------------------------------
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const strList = (a, n, len) => (Array.isArray(a) ? a.map((x) => str(x, len)).filter(Boolean).slice(0, n) : []);

/** AI output is untrusted: keep only short strings in the expected shape. */
export function sanitizeAnalysis(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const overall = ['good', 'mixed', 'needs_attention'].includes(raw.overall) ? raw.overall : 'mixed';
  const markers = Array.isArray(raw.markers)
    ? raw.markers
        .filter((m) => m && typeof m.name === 'string')
        .slice(0, 30)
        .map((m) => ({ name: str(m.name, 80), meaning: str(m.meaning, 400), training: str(m.training, 300), tips: strList(m.tips, 4, 240) }))
    : [];
  const areas = ['nutrition', 'sleep', 'cardio', 'strength', 'lifestyle'];
  const rawTips = raw.lifestyle_tips ?? raw.lifestyleTips;
  const tips = Array.isArray(rawTips)
    ? rawTips.filter((t) => t && typeof t.tip === 'string').slice(0, 10).map((t) => ({ area: areas.includes(t.area) ? t.area : 'lifestyle', tip: str(t.tip, 260) }))
    : [];
  const summary = str(raw.summary, 900);
  if (!summary && !markers.length) return null;
  return {
    overall,
    summary,
    markers,
    lifestyleTips: tips,
    trainingAdjustments: strList(raw.training_adjustments ?? raw.trainingAdjustments, 6, 220),
    doctorQuestions: strList(raw.doctor_questions ?? raw.doctorQuestions, 6, 220),
    generatedAt: Number.isFinite(Number(raw.generatedAt)) ? Number(raw.generatedAt) : Date.now(),
  };
}

export function sanitizeReport(raw) {
  const labs = sanitizeLabs(raw);
  if (!labs) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : `lab_${labs.date || 'undated'}_${Math.random().toString(36).slice(2, 7)}`,
    ...labs,
    date: labs.date && /^\d{4}-\d{2}-\d{2}$/.test(labs.date) ? labs.date : new Date().toISOString().slice(0, 10),
    analysis: sanitizeAnalysis(raw.analysis),
  };
}

/** Oldest first, unique ids, capped. */
export function sanitizeReports(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .map(sanitizeReport)
    .filter((r) => r && !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-24);
}

/** The latest report in the shape the rest of the app reads from profile.labs (plus the AI's training advice). */
export function latestLabsForProfile(reports) {
  const r = reports.at(-1);
  if (!r) return null;
  return { date: r.date, source: r.source, markers: r.markers, aiAdjustments: r.analysis?.trainingAdjustments || [] };
}

/** Same marker in the previous report, for "since last time". */
export function previousValue(reports, reportIdx, markerId) {
  for (let i = reportIdx - 1; i >= 0; i--) {
    const hit = analyzeLabs(reports[i]).results.find((r) => r.id === markerId && r.canonical != null);
    if (hit) return { value: hit.canonical, date: reports[i].date };
  }
  return null;
}

export function markerSeries(reports, markerId, sex) {
  return reports
    .map((r) => ({ date: r.date, hit: analyzeLabs(r, sex).results.find((x) => x.id === markerId && x.canonical != null) }))
    .filter((x) => x.hit)
    .map((x) => ({ date: x.date, value: x.hit.canonical }));
}
