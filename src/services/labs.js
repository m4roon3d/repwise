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

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[()[\],:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Matches a printed test name to a known marker. Longest alias wins, so "LDL cholesterol" beats "cholesterol". */
export function matchMarker(name) {
  const n = norm(name);
  if (!n) return null;
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
  for (const e of labs?.markers || []) {
    const id = e.id || matchMarker(e.name);
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
      const id = typeof m.id === 'string' && MARKER_MAP[m.id] ? m.id : matchMarker(m.name);
      return {
        id: id || null,
        name: m.name.trim().slice(0, 80),
        value: Number(m.value),
        unit: typeof m.unit === 'string' ? m.unit.trim().slice(0, 20) : '',
      };
    });
  if (!markers.length) return null;
  const date = typeof raw.date === 'string' ? raw.date.slice(0, 20) : '';
  return { date, source: raw.source === 'manual' ? 'manual' : 'upload', markers };
}

export function describeLabsForPrompt(labs, sex) {
  if (!labs?.markers?.length) return 'Not provided';
  const { flagged, results } = analyzeLabs(labs, sex);
  const known = results.filter((r) => r.id);
  if (!flagged.length) return `${known.length} markers provided (${labs.date || 'undated'}), all within typical ranges`;
  return flagged
    .map((r) => `${r.name} ${r.value} ${r.unit} (${r.status}${r.band ? `, ${r.band}` : ''})`)
    .join('; ') + ` [report ${labs.date || 'undated'}]`;
}
