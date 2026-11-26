import React, { useEffect, useMemo, useState } from 'react';
import { MiniBars } from './TrendChart';
import { FEATURE_LABELS, clearUsage, estimateCost, loadUsage, summarizeUsage } from '../services/usage';
import { clearArea, saveOnboarded, storageReport } from '../services/storage';

const PRICE_KEY = 'mf_price_per_million_v1';
const fmtNum = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`);
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const build = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : { id: 'dev', date: '' };
const confirmed = (msg) => typeof window === 'undefined' || !window.confirm || window.confirm(msg);

function loadPrices() {
  try {
    return JSON.parse(localStorage.getItem(PRICE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

/** Gemini usage, storage, app health and housekeeping in one place. */
export default function Diagnostics({ apiKey, model, profileName, onDataChanged, onClose }) {
  const [usage, setUsage] = useState(() => loadUsage());
  const [days, setDays] = useState(30);
  const [prices, setPrices] = useState(loadPrices);
  const [storage, setStorage] = useState(() => storageReport());
  const [env, setEnv] = useState({ online: typeof navigator === 'undefined' || navigator.onLine });
  const [msg, setMsg] = useState('');
  const summary = useMemo(() => summarizeUsage(usage, { days }), [usage, days]);
  const cost = estimateCost(summary, prices);
  const recent = [...usage].reverse().slice(0, 25);

  useEffect(() => {
    let alive = true;
    (async () => {
      const next = { online: navigator.onLine };
      try {
        if (navigator.storage?.estimate) next.estimate = await navigator.storage.estimate();
        if (navigator.storage?.persisted) next.persisted = await navigator.storage.persisted();
        const reg = await navigator.serviceWorker?.getRegistration?.();
        next.sw = reg ? (reg.active ? 'active' : 'installing') : 'not registered';
        next.caches = typeof caches !== 'undefined' ? await caches.keys() : [];
      } catch {
        /* diagnostics are best-effort */
      }
      if (alive) setEnv((e) => ({ ...e, ...next }));
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refresh = (text) => {
    setUsage(loadUsage());
    setStorage(storageReport());
    setMsg(text);
    onDataChanged?.();
  };

  const savePrices = (next) => {
    setPrices(next);
    try {
      localStorage.setItem(PRICE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const exportDiagnostics = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      build,
      userAgent: navigator.userAgent,
      model,
      apiKeySet: Boolean(apiKey),
      env: { online: env.online, sw: env.sw, persisted: env.persisted, caches: env.caches, quota: env.estimate?.quota, used: env.estimate?.usage },
      storage,
      usageSummary: summary,
      recentCalls: recent,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `repwise-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const clearCaches = async () => {
    if (!confirmed('Clear the offline cache? Photos will download again as you view them.')) return;
    try {
      for (const k of await caches.keys()) await caches.delete(k);
      setEnv((e) => ({ ...e, caches: [] }));
      setMsg('Offline cache cleared.');
    } catch {
      setMsg('Could not clear the cache in this browser.');
    }
  };

  const checkUpdate = async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (!reg) return setMsg('No service worker (this is normal in development).');
      await reg.update();
      setMsg(reg.waiting || reg.installing ? 'An update is downloading. Reopen the app to use it.' : 'You are on the latest version.');
    } catch {
      setMsg('Could not check for updates. Are you offline?');
    }
  };

  const keepData = async () => {
    try {
      const ok = await navigator.storage?.persist?.();
      setEnv((e) => ({ ...e, persisted: ok }));
      setMsg(ok ? 'Your data is now protected from automatic browser clean-up.' : 'The browser declined. Installing the app to your home screen usually allows it.');
    } catch {
      setMsg('This browser does not support persistent storage.');
    }
  };

  return (
    <div className="panel-stack diagnostics-view">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Usage & diagnostics</h2>
            <p className="muted">Gemini calls made from this device, storage, and app health. Prompts, replies and your key are never logged.</p>
          </div>
          {onClose && (
            <button type="button" className="secondary-btn" onClick={onClose}>
              Done
            </button>
          )}
        </div>
        {msg && <div className="status-banner status-success" role="status">{msg}</div>}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Gemini usage</h2>
          <div className="segmented diag-range" role="group" aria-label="Time range">
            {[
              [1, 'Today'],
              [7, '7 days'],
              [30, '30 days'],
            ].map(([d, l]) => (
              <button key={d} type="button" aria-pressed={days === d} className={days === d ? 'seg-active' : ''} onClick={() => setDays(d)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="stat-grid diag-stats">
          <div className="stat-tile">
            <span className="stat-label">Calls</span>
            <strong className="stat-value">{summary.calls}</strong>
            <span className="stat-change trend-flat">{summary.errors ? `${summary.errors} failed` : 'no failures'}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Tokens</span>
            <strong className="stat-value">{fmtNum(summary.totalTok)}</strong>
            <span className="stat-change trend-flat">
              {fmtNum(summary.inTok)} in · {fmtNum(summary.outTok)} out{summary.thinkTok ? ` · ${fmtNum(summary.thinkTok)} thinking` : ''}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Average response</span>
            <strong className="stat-value">{summary.calls ? fmtMs(summary.avgMs) : '—'}</strong>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Estimated cost</span>
            <strong className="stat-value">{cost == null ? '—' : `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`}</strong>
            <span className="stat-change trend-flat">{cost == null ? 'add prices below' : 'from your prices'}</span>
          </div>
        </div>

        <MiniBars
          title="Tokens per day"
          bars={summary.perDay.map((d, i) => ({ value: Math.round(d.tokens / 1000), start: d.start, highlight: i === summary.perDay.length - 1 }))}
          formatLabel={(b) => new Date(b.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).replace(' ', ' ')}
          note="thousands"
        />

        {summary.byFeature.length > 0 ? (
          <div className="table-wrap">
            <table className="diag-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Calls</th>
                  <th>Tokens</th>
                  <th>Avg time</th>
                </tr>
              </thead>
              <tbody>
                {summary.byFeature.map((f) => (
                  <tr key={f.feature}>
                    <td>
                      {f.label}
                      {f.errors ? <span className="diag-err"> · {f.errors} failed</span> : null}
                    </td>
                    <td>{f.calls}</td>
                    <td>{fmtNum(f.totalTok)}</td>
                    <td>{fmtMs(f.avgMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No Gemini calls in this period{apiKey ? '' : ' (no API key set, so everything runs on the built-in engine)'}.</p>
        )}

        <details className="diag-details">
          <summary>Cost estimate prices</summary>
          <p className="muted">Enter your Gemini model's price in US$ per 1 million tokens (see Google AI Studio pricing). Thinking tokens are billed as output.</p>
          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="price-in">Input, $ per 1M</label>
              <input id="price-in" type="number" step="any" min="0" value={prices.input ?? ''} onChange={(e) => savePrices({ ...prices, input: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="price-out">Output, $ per 1M</label>
              <input id="price-out" type="number" step="any" min="0" value={prices.output ?? ''} onChange={(e) => savePrices({ ...prices, output: e.target.value })} />
            </div>
          </div>
        </details>
      </section>

      <section className="card">
        <h2>Recent calls</h2>
        {recent.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="call-list">
            {recent.map((c, i) => (
              <li key={i} className={c.ok ? '' : 'call-failed'}>
                <div>
                  <strong>{FEATURE_LABELS[c.feature] || 'Other'}</strong>
                  <span className="muted"> · {new Date(c.ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <div className="muted call-meta">
                    {c.model} · {fmtMs(c.ms)}
                    {c.ok ? ` · ${fmtNum(c.totalTok)} tokens` : ''}
                    {c.finish && c.finish !== 'STOP' && c.ok ? ` · ${c.finish}` : ''}
                  </div>
                  {!c.ok && <div className="call-error">{c.error || 'Failed'}</div>}
                </div>
                <span className={`call-status ${c.ok ? 'trend-good' : 'trend-bad'}`}>{c.ok ? '✓' : '✕'}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="button-row">
          <button type="button" className="secondary-btn" onClick={exportDiagnostics}>
            Export diagnostics
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              if (confirmed('Clear the Gemini usage log?')) {
                clearUsage();
                refresh('Usage log cleared.');
              }
            }}
          >
            Clear usage log
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Storage</h2>
        <p className="muted">
          {profileName || 'This person'} uses {fmtBytes(storage.personBytes)}; all Repwise data on this device is {fmtBytes(storage.deviceBytes)}
          {env.estimate?.quota ? ` (browser allows about ${fmtBytes(env.estimate.quota)})` : ''}.
        </p>
        <ul className="storage-list">
          {storage.areas.map((a) => (
            <li key={a.key}>
              <span>{a.label}</span>
              <span className="muted">{fmtBytes(a.bytes)}</span>
              {a.key !== 'PROFILE' && a.bytes > 0 ? (
                <button
                  type="button"
                  className="mini-btn"
                  aria-label={`Clear ${a.label}`}
                  onClick={() => {
                    if (confirmed(`Delete all ${a.label.toLowerCase()} for ${profileName || 'this person'}? This cannot be undone. Export a backup first if unsure.`)) {
                      clearArea(a.key);
                      refresh(`${a.label} cleared.`);
                    }
                  }}
                >
                  Clear
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
        <div className="button-row">
          <button type="button" className="secondary-btn" onClick={keepData} disabled={env.persisted === true}>
            {env.persisted ? '✓ Data protected' : 'Protect my data'}
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              saveOnboarded(false);
              refresh('Guided setup will show next time you open the Coach tab.');
            }}
          >
            Re-run guided setup
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: '8px' }}>
          Browsers can clear website data after long inactivity. "Protect my data" asks the browser to keep it; regular backups from Settings are still the safest option.
        </p>
      </section>

      <section className="card">
        <h2>App</h2>
        <dl className="diag-dl">
          <dt>Version</dt>
          <dd>
            {build.id}
            {build.date ? ` · built ${new Date(build.date).toLocaleDateString()}` : ''}
          </dd>
          <dt>Connection</dt>
          <dd>{env.online ? 'Online' : 'Offline'}</dd>
          <dt>Offline support</dt>
          <dd>
            {env.sw || 'checking…'}
            {env.caches ? ` · ${env.caches.length} cache${env.caches.length === 1 ? '' : 's'}` : ''}
          </dd>
          <dt>AI model</dt>
          <dd>{apiKey ? model : 'Built-in engine (no API key)'}</dd>
          <dt>API key</dt>
          <dd>{apiKey ? `set · ends in ${apiKey.slice(-4)}` : 'not set'}</dd>
        </dl>
        <div className="button-row">
          <button type="button" className="secondary-btn" onClick={checkUpdate}>
            Check for update
          </button>
          <button type="button" className="secondary-btn" onClick={clearCaches}>
            Clear offline cache
          </button>
        </div>
      </section>
    </div>
  );
}
