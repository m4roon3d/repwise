// Gemini call log for the Diagnostics screen: one entry per request (feature, model, tokens, time, outcome).
// Stored per device because the API key is per device. Never stores prompts, replies or the key.
const KEY = 'mf_gemini_usage_v1';
const MAX = 500;

export const FEATURE_LABELS = {
  test_connection: 'Test connection',
  intake: 'Coach chat (setup)',
  plan: 'Plan generation',
  swap: 'Exercise swap',
  adapt: 'Adapt a day',
  ask: 'Ask Your Coach',
  lab_read: 'Read blood report',
  lab_analysis: 'Blood report analysis',
  scan_read: 'Read body scan',
};

const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((e) => e && Number.isFinite(e.ts)) : [];
  } catch {
    return [];
  }
};
const write = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* storage full or blocked: diagnostics are best-effort */
  }
};

export function loadUsage() {
  return read();
}

export function clearUsage() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function recordCall(entry) {
  const list = read();
  list.push(entry);
  write(list);
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Turns an SDK response or error into a log entry. */
export function describeCall({ feature, model, started, response, error }) {
  const u = response?.usageMetadata || {};
  const msg = error ? String(error?.message || error).replace(/AIza[\w-]{10,}/g, '[key]').slice(0, 160) : '';
  return {
    ts: Date.now(),
    feature: FEATURE_LABELS[feature] ? feature : 'other',
    model: String(model || '').slice(0, 60),
    ms: Math.max(0, Math.round(Date.now() - started)),
    ok: !error,
    finish: response?.candidates?.[0]?.finishReason || (error ? 'ERROR' : ''),
    inTok: num(u.promptTokenCount),
    outTok: num(u.candidatesTokenCount),
    thinkTok: num(u.thoughtsTokenCount),
    totalTok: num(u.totalTokenCount) || num(u.promptTokenCount) + num(u.candidatesTokenCount) + num(u.thoughtsTokenCount),
    error: msg,
  };
}

/** Wraps an SDK client so every generateContent call is timed and logged under `feature`. */
export function instrument(client, feature) {
  return {
    ...client,
    models: {
      ...client.models,
      generateContent: async (request) => {
        const started = Date.now();
        try {
          const response = await client.models.generateContent(request);
          recordCall(describeCall({ feature, model: request?.model, started, response }));
          return response;
        } catch (error) {
          recordCall(describeCall({ feature, model: request?.model, started, error }));
          throw error;
        }
      },
    },
  };
}

const DAY = 86400000;

/** Totals for a window, plus a per-feature breakdown and a per-day series (oldest first). */
export function summarizeUsage(list, { days = 30, now = Date.now() } = {}) {
  const since = now - days * DAY;
  const inWindow = list.filter((e) => e.ts >= since);
  const sum = (arr, k) => arr.reduce((n, e) => n + num(e[k]), 0);
  const byFeature = Object.entries(
    inWindow.reduce((acc, e) => {
      const f = (acc[e.feature] ||= { calls: 0, errors: 0, inTok: 0, outTok: 0, thinkTok: 0, totalTok: 0, ms: 0 });
      f.calls += 1;
      f.errors += e.ok ? 0 : 1;
      for (const k of ['inTok', 'outTok', 'thinkTok', 'totalTok', 'ms']) f[k] += num(e[k]);
      return acc;
    }, {})
  )
    .map(([feature, v]) => ({ feature, label: FEATURE_LABELS[feature] || 'Other', ...v, avgMs: Math.round(v.ms / v.calls) }))
    .sort((a, b) => b.totalTok - a.totalTok);
  const perDay = Array.from({ length: Math.min(days, 14) }, (_, i) => {
    const start = new Date(now - (Math.min(days, 14) - 1 - i) * DAY);
    start.setHours(0, 0, 0, 0);
    const end = start.getTime() + DAY;
    const dayCalls = list.filter((e) => e.ts >= start.getTime() && e.ts < end);
    return { start: start.getTime(), calls: dayCalls.length, tokens: sum(dayCalls, 'totalTok') };
  });
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayCalls = list.filter((e) => e.ts >= today.getTime());
  return {
    calls: inWindow.length,
    errors: inWindow.filter((e) => !e.ok).length,
    inTok: sum(inWindow, 'inTok'),
    outTok: sum(inWindow, 'outTok'),
    thinkTok: sum(inWindow, 'thinkTok'),
    totalTok: sum(inWindow, 'totalTok'),
    avgMs: inWindow.length ? Math.round(sum(inWindow, 'ms') / inWindow.length) : 0,
    todayCalls: todayCalls.length,
    todayTok: sum(todayCalls, 'totalTok'),
    byFeature,
    perDay,
  };
}

/** Optional cost estimate from user-entered prices (per 1M tokens); thinking tokens bill as output. */
export function estimateCost(summary, rates) {
  const inRate = Number(rates?.input);
  const outRate = Number(rates?.output);
  if (!(inRate >= 0) || !(outRate >= 0) || (!inRate && !outRate)) return null;
  return (summary.inTok * inRate + (summary.outTok + summary.thinkTok) * outRate) / 1e6;
}
