// Body-composition scans (InBody and similar BIA machines): definitions, validation, trends and insights.
// Values are stored in metric units; the UI converts for display.

// better: which direction is an improvement ('up' | 'down' | null when it depends on the goal)
export const BODY_METRICS = [
  { id: 'weightKg', label: 'Weight', unit: 'kg', min: 30, max: 250, dp: 1, better: null, mass: true },
  { id: 'smmKg', label: 'Skeletal muscle mass', short: 'Muscle', unit: 'kg', min: 8, max: 80, dp: 1, better: 'up', mass: true },
  { id: 'bfmKg', label: 'Body fat mass', short: 'Fat mass', unit: 'kg', min: 1, max: 150, dp: 1, better: 'down', mass: true },
  { id: 'pbf', label: 'Body fat %', short: 'Body fat', unit: '%', min: 2, max: 70, dp: 1, better: 'down' },
  { id: 'visceralFat', label: 'Visceral fat level', short: 'Visceral fat', unit: '', min: 1, max: 30, dp: 0, better: 'down' },
  { id: 'bmi', label: 'BMI', unit: '', min: 10, max: 70, dp: 1, better: null },
  { id: 'ffmKg', label: 'Fat-free mass', unit: 'kg', min: 20, max: 150, dp: 1, better: 'up', mass: true },
  { id: 'bmr', label: 'Basal metabolic rate', short: 'BMR', unit: 'kcal', min: 800, max: 4000, dp: 0, better: 'up' },
  { id: 'tbwL', label: 'Total body water', unit: 'L', min: 15, max: 90, dp: 1, better: null },
  { id: 'proteinKg', label: 'Protein', unit: 'kg', min: 3, max: 25, dp: 1, better: 'up', mass: true },
  { id: 'mineralsKg', label: 'Minerals', unit: 'kg', min: 1, max: 8, dp: 2, better: null, mass: true },
  { id: 'inbodyScore', label: 'InBody score', unit: '/100', min: 30, max: 120, dp: 0, better: 'up' },
  { id: 'whr', label: 'Waist-hip ratio', unit: '', min: 0.5, max: 1.5, dp: 2, better: 'down' },
  { id: 'leanRightArm', label: 'Lean mass: right arm', unit: 'kg', min: 0.5, max: 10, dp: 2, better: 'up', mass: true, segment: true },
  { id: 'leanLeftArm', label: 'Lean mass: left arm', unit: 'kg', min: 0.5, max: 10, dp: 2, better: 'up', mass: true, segment: true },
  { id: 'leanTrunk', label: 'Lean mass: trunk', unit: 'kg', min: 8, max: 60, dp: 1, better: 'up', mass: true, segment: true },
  { id: 'leanRightLeg', label: 'Lean mass: right leg', unit: 'kg', min: 2, max: 25, dp: 2, better: 'up', mass: true, segment: true },
  { id: 'leanLeftLeg', label: 'Lean mass: left leg', unit: 'kg', min: 2, max: 25, dp: 2, better: 'up', mass: true, segment: true },
];
export const METRIC_MAP = Object.fromEntries(BODY_METRICS.map((m) => [m.id, m]));
export const HEADLINE_METRICS = ['weightKg', 'smmKg', 'pbf', 'visceralFat'];
export const SCAN_INTERVAL_DAYS = 60;

const DAY = 86400000;
const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
export const today = () => new Date().toISOString().slice(0, 10);

/** Keeps only plausible numbers for known metrics; returns null when nothing usable remains. */
export function sanitizeScan(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const metrics = {};
  for (const m of BODY_METRICS) {
    const v = Number(raw.metrics?.[m.id]);
    if (raw.metrics?.[m.id] !== null && raw.metrics?.[m.id] !== '' && Number.isFinite(v) && v >= m.min && v <= m.max) metrics[m.id] = Number(v.toFixed(m.dp));
  }
  if (!Object.keys(metrics).length) return null;
  const date = isoDate(raw.date) || today();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : `scan_${date}_${Math.random().toString(36).slice(2, 7)}`,
    date,
    source: raw.source === 'upload' ? 'upload' : 'manual',
    device: typeof raw.device === 'string' ? raw.device.slice(0, 40) : '',
    metrics,
  };
}

/** Oldest first, one entry per id, capped. */
export function sanitizeScans(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .map(sanitizeScan)
    .filter((s) => s && !seen.has(s.id) && seen.add(s.id))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-60);
}

/** Converts what a report printed (maybe pounds) into stored metric values. */
export function normalizeExtracted(raw) {
  const lb = /lb/i.test(raw?.mass_unit || '');
  const metrics = {};
  for (const m of BODY_METRICS) {
    const v = raw?.[m.id];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    metrics[m.id] = m.mass && lb ? n * 0.45359237 : n;
  }
  return sanitizeScan({ date: raw?.test_date, source: 'upload', device: raw?.device || '', metrics });
}

export function series(scans, id) {
  return scans.filter((s) => s.metrics[id] != null).map((s) => ({ date: s.date, value: s.metrics[id] }));
}

export function delta(scans, id, fromIdx = -2) {
  const pts = series(scans, id);
  if (pts.length < 2) return null;
  const a = pts.at(fromIdx);
  const b = pts.at(-1);
  if (!a || a === b) return null;
  return { change: Number((b.value - a.value).toFixed(METRIC_MAP[id].dp + 1)), from: a, to: b, days: Math.round((Date.parse(b.date) - Date.parse(a.date)) / DAY) };
}

/** 'good' | 'bad' | 'flat' | null for a change in a metric. */
export function judge(id, change) {
  const m = METRIC_MAP[id];
  if (change == null || !m?.better) return null;
  const eps = m.dp === 0 ? 0.5 : m.unit === '%' ? 0.2 : 0.1;
  if (Math.abs(change) < eps) return 'flat';
  return (change > 0) === (m.better === 'up') ? 'good' : 'bad';
}

export function nextScanDue(scans, now = Date.now()) {
  const last = scans.at(-1);
  if (!last) return null;
  const due = Date.parse(last.date) + SCAN_INTERVAL_DAYS * DAY;
  return { date: new Date(due).toISOString().slice(0, 10), daysLeft: Math.ceil((due - now) / DAY) };
}

/** Plain-language observations. Returns [{ kind: 'good'|'watch'|'info', text }]. */
export function bodyInsights(scans, profile = {}) {
  const out = [];
  if (!scans.length) return out;
  const last = scans.at(-1).metrics;
  const d = (id) => delta(scans, id)?.change;
  const span = delta(scans, 'weightKg') || delta(scans, 'smmKg');
  const since = span ? `since ${fmtDate(span.from.date)}` : '';
  const smm = d('smmKg');
  const bfm = d('bfmKg');
  const w = d('weightKg');

  if (smm != null && bfm != null) {
    if (smm >= 0.2 && bfm <= -0.3) out.push({ kind: 'good', text: `Recomposition ${since}: +${smm.toFixed(1)} kg muscle and −${Math.abs(bfm).toFixed(1)} kg fat. This is the ideal direction.` });
    else if (smm >= 0.2) out.push({ kind: 'good', text: `You gained ${smm.toFixed(1)} kg of muscle ${since}.` });
    else if (bfm <= -0.3 && smm > -0.3) out.push({ kind: 'good', text: `You lost ${Math.abs(bfm).toFixed(1)} kg of fat ${since} while holding on to your muscle.` });
    if (w != null && w < -0.5 && smm <= -0.5) out.push({ kind: 'watch', text: `Some of the ${Math.abs(w).toFixed(1)} kg you lost was muscle (${smm.toFixed(1)} kg). Keep lifting heavy, eat protein at every meal, and avoid cutting calories too fast.` });
    if (bfm >= 1 && smm < 0.3) out.push({ kind: 'watch', text: `Fat mass is up ${bfm.toFixed(1)} kg ${since} without much muscle gain. A small calorie trim and a few extra walks would help.` });
  }

  const male = profile.sex === 'male';
  if (last.pbf != null) {
    const [lo, hi] = male ? [10, 20] : profile.sex === 'female' ? [18, 28] : [12, 25];
    if (last.pbf > hi) out.push({ kind: 'info', text: `Body fat is ${last.pbf}%, above the typical ${lo}–${hi}% range${profile.sex ? '' : ' (range assumes no sex given)'}. Strength work plus steady cardio is the right combination.` });
    else if (last.pbf >= lo) out.push({ kind: 'good', text: `Body fat (${last.pbf}%) is within the typical ${lo}–${hi}% range.` });
  }
  if (last.visceralFat != null) {
    if (last.visceralFat >= 10) out.push({ kind: 'watch', text: `Visceral fat level ${last.visceralFat} is above 10 (the fat around your organs). It responds well to regular exercise and less alcohol and sugar.` });
    else out.push({ kind: 'good', text: `Visceral fat level ${last.visceralFat} is in the healthy range (under 10).` });
  }

  const pairs = [['leanLeftArm', 'leanRightArm', 'arms'], ['leanLeftLeg', 'leanRightLeg', 'legs']];
  for (const [l, r, label] of pairs) {
    if (last[l] && last[r]) {
      const diff = Math.abs(last[l] - last[r]) / Math.max(last[l], last[r]);
      if (diff >= 0.06) {
        const weaker = last[l] < last[r] ? 'left' : 'right';
        out.push({ kind: 'info', text: `Your ${weaker} ${label.slice(0, -1)} has ${Math.round(diff * 100)}% less lean mass than the other. Single-arm and single-leg exercises will help even it out.` });
      }
    }
  }

  const smmTrend = series(scans, 'smmKg');
  if (smmTrend.length >= 2) {
    const first = smmTrend[0];
    const months = (Date.parse(smmTrend.at(-1).date) - Date.parse(first.date)) / (30.4 * DAY);
    if (months >= 1.5) {
      const rate = (smmTrend.at(-1).value - first.value) / months;
      out.push({ kind: 'info', text: `Muscle trend since your first scan: ${rate >= 0 ? '+' : ''}${rate.toFixed(2)} kg a month. For most people, 0.25–0.5 kg a month is a great pace.` });
    }
  }
  if (scans.length >= 2) out.push({ kind: 'info', text: 'Tip: scan at the same time of day, before training and after using the bathroom. Water and food can shift readings by 1 kg or more.' });
  return out;
}

export function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function describeBodyCompForPrompt(scans) {
  if (!scans?.length) return 'No body-composition scans';
  const last = scans.at(-1);
  const parts = HEADLINE_METRICS.concat(['bfmKg', 'bmr'])
    .filter((id) => last.metrics[id] != null)
    .map((id) => {
      const dd = delta(scans, id);
      const m = METRIC_MAP[id];
      return `${m.short || m.label} ${last.metrics[id]}${m.unit && m.unit !== '/100' ? ` ${m.unit}` : ''}${dd ? ` (${dd.change >= 0 ? '+' : ''}${dd.change} in ${dd.days}d)` : ''}`;
    });
  return `Latest scan ${last.date}: ${parts.join(', ')}`;
}
