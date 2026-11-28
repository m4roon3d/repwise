import React, { useCallback, useMemo, useState } from 'react';
import BarcodeScanner from './BarcodeScanner';
import DietFields from './DietFields';
import { computeTargets, trainingWeekdays, dietClashes, DIET_TYPES, sanitizeDiet } from '../services/nutrition';
import { NUTRIENTS, MEAL_SLOTS, todayKey, dayTotals, lookupBarcode, searchFoods, scaleNutrients, productWarnings, recentFoods, foodKey, templateFrom, entriesFrom, previousMeal } from '../services/food';
import { loadFoodLog, saveFoodLog, loadMealPlan, saveMealPlan, loadFoodLibrary, saveFoodLibrary, loadWater, saveWater } from '../services/storage';
import { generateMealPlan, estimateMealPhoto } from '../services/geminiCoach';
import { prepareImage } from '../services/images';

const LIMITS = new Set(['sugars', 'satFat', 'sodium']);
const weekdayIdx = (dateKey) => (new Date(`${dateKey}T12:00:00`).getDay() + 6) % 7;
const shiftDate = (dateKey, days) => todayKey(new Date(new Date(`${dateKey}T12:00:00`).getTime() + days * 86400000));
const prettyDate = (dateKey) => {
  if (dateKey === todayKey()) return 'Today';
  if (dateKey === shiftDate(todayKey(), -1)) return 'Yesterday';
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};
const defaultMeal = () => {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 18 ? 'snack' : 'dinner';
};
const fmt = (n, unit) => (n == null ? '—' : `${n.toLocaleString()}${unit === 'kcal' ? '' : ` ${unit}`}`);
const whole = (n, unit) => fmt(n == null || unit === 'L' ? n : Math.round(n), unit);

function Bar({ label, value, target, unit, limit }) {
  const pct = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const over = limit ? value > target : value > target * 1.1;
  return (
    <div className="nut-bar">
      <div className="nut-bar-head">
        <span>{label}</span>
        <span className={over ? 'nut-over' : ''}>
          <strong>{whole(value, unit)}</strong> {limit ? 'of max' : '/'} {whole(target, unit)}
          {unit === 'kcal' ? ' kcal' : ''}
        </span>
      </div>
      <div className="nut-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={value}>
        <span className={`nut-fill ${over ? 'nut-fill-over' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Pick an amount of a product and the meal, then add it to the log. */
function AmountPicker({ product, diet, onAdd, onCancel }) {
  const [grams, setGrams] = useState(product.servingG || 100);
  const [meal, setMeal] = useState(defaultMeal());
  const totals = scaleNutrients(product.per100, Number(grams) || 0);
  const warnings = productWarnings(product, diet);
  const quick = [...new Set([product.servingG, 50, 100, 200].filter(Boolean))];
  return (
    <div className="food-pick">
      <div className="food-pick-head">
        {product.image && <img src={product.image} alt="" width="56" height="56" />}
        <div>
          <h3>{product.name}</h3>
          <p className="muted small">
            {[product.brand, product.servingLabel && `serving ${product.servingLabel}`, product.nutriscore && `Nutri-Score ${product.nutriscore.toUpperCase()}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      {warnings.length > 0 && (
        <p className="food-warn" role="alert">⚠ {warnings.join(' · ')}</p>
      )}
      <div className="food-amount">
        <label htmlFor="food-grams">Amount (g or ml)</label>
        <input id="food-grams" type="number" inputMode="decimal" min="1" max="5000" value={grams} onChange={(e) => setGrams(e.target.value)} />
        <div className="chip-row">
          {quick.map((g) => (
            <button key={g} type="button" className={`chip ${Number(grams) === g ? 'chip-active' : ''}`} onClick={() => setGrams(g)}>
              {g === product.servingG ? `1 serving (${g} g)` : `${g} g`}
            </button>
          ))}
        </div>
      </div>
      <div className="food-amount">
        <label htmlFor="food-meal">Meal</label>
        <select id="food-meal" value={meal} onChange={(e) => setMeal(e.target.value)}>
          {MEAL_SLOTS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
      <dl className="food-facts">
        {NUTRIENTS.map((n) => (
          <div key={n.id}>
            <dt>{n.label}</dt>
            <dd>{fmt(totals[n.id], n.unit)}{n.unit === 'kcal' && totals.kcal != null ? ' kcal' : ''}</dd>
          </div>
        ))}
      </dl>
      <div className="btn-row">
        <button type="button" className="primary-btn" disabled={!(Number(grams) > 0)} onClick={() => onAdd({ grams: Number(grams), meal, totals })}>
          Add to {MEAL_SLOTS.find((m) => m.id === meal).label.toLowerCase()}
        </button>
        <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ManualFood({ onAdd, onCancel }) {
  const [f, setF] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '', meal: defaultMeal() });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ok = f.name.trim() && Number(f.kcal) > 0;
  return (
    <form
      className="food-manual"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onAdd(f);
      }}
    >
      <label className="field">
        <span>Food</span>
        <input type="text" maxLength={80} value={f.name} onChange={set('name')} placeholder="e.g. Home-made dal, 1 bowl" />
      </label>
      <div className="grid-4">
        {[['kcal', 'Calories'], ['protein', 'Protein g'], ['carbs', 'Carbs g'], ['fat', 'Fat g']].map(([k, l]) => (
          <label key={k} className="field">
            <span>{l}</span>
            <input type="number" inputMode="decimal" min="0" value={f[k]} onChange={set(k)} />
          </label>
        ))}
      </div>
      <label className="field">
        <span>Meal</span>
        <select value={f.meal} onChange={set('meal')}>
          {MEAL_SLOTS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </label>
      <div className="btn-row">
        <button type="submit" className="primary-btn" disabled={!ok}>Add</button>
        <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function FoodSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);
  const run = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResults(await searchFoods(q));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <form className="ai-ask" onSubmit={run}>
        <input type="search" value={q} maxLength={80} placeholder="e.g. greek yogurt, oats, Amul" aria-label="Search foods" onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="primary-btn" disabled={busy || q.trim().length < 2}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}
      {results && !results.length && <p className="muted small">Nothing found. Try another name, or add it by hand.</p>}
      {results?.length > 0 && (
        <ul className="food-results">
          {results.map((p, i) => (
            <li key={`${p.barcode}-${i}`}>
              <button type="button" onClick={() => onPick(p)}>
                <span className="food-res-name">{p.name}</span>
                <span className="muted small">{[p.brand, `${p.per100.kcal} kcal / 100 g`].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Snap a plate; Gemini estimates each food; you check the amounts before anything is logged. */
function PhotoLogger({ apiKey, model, onAdd, onCancel }) {
  const [photo, setPhoto] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [items, setItems] = useState([]);
  const [meal, setMeal] = useState(defaultMeal());

  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setResult(null);
    try {
      setPhoto(await prepareImage(file));
    } catch (err) {
      setError(err.message);
    }
  };
  const estimate = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await estimateMealPhoto({ photo, note, apiKey, model });
      setResult(r);
      setItems(r.items.map((it) => ({ ...it, base: { ...it } })));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  // Changing grams scales that item's nutrition from the AI's estimate.
  const setGrams = (i, g) =>
    setItems((list) =>
      list.map((it, j) => {
        if (j !== i) return it;
        const f = it.base.grams ? (Number(g) || 0) / it.base.grams : 1;
        const sc = (k) => Math.round(it.base[k] * f);
        return { ...it, grams: g, kcal: sc('kcal'), protein: sc('protein'), carbs: sc('carbs'), fat: sc('fat'), fibre: sc('fibre') };
      })
    );
  const total = items.reduce((a, it) => a + it.kcal, 0);

  if (!apiKey) {
    return (
      <div className="food-pick">
        <p className="muted small">Logging from a photo needs a Gemini API key. Add one with the key button at the top, or add the food by hand.</p>
        <button type="button" className="secondary-btn" onClick={onCancel}>Close</button>
      </div>
    );
  }
  return (
    <div className="food-pick" aria-label="Log from a photo">
      {!result && (
        <>
          <label className="secondary-btn photo-pick">
            {photo ? 'Choose a different photo' : 'Take or choose a photo'}
            <input type="file" accept="image/*" capture="environment" onChange={choose} hidden aria-label="Meal photo" />
          </label>
          {photo && <img className="food-photo" src={`data:${photo.mimeType};base64,${photo.data}`} alt="Your meal" />}
          <label className="field">
            <span>Anything the photo won't show? (optional)</span>
            <input type="text" maxLength={200} value={note} placeholder="e.g. 2 rotis with ghee, dal is moong" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="btn-row">
            <button type="button" className="primary-btn" disabled={!photo || busy} onClick={estimate}>{busy ? 'Looking at your plate…' : 'Estimate'}</button>
            <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      {result && (
        <>
          <h3>{result.mealName}</h3>
          <p className="muted small">
            Estimate, {result.confidence} confidence. Photos can be off by 20–30%, so check the amounts.{result.note ? ` ${result.note}` : ''}
          </p>
          <ul className="photo-items">
            {items.map((it, i) => (
              <li key={i}>
                <span className="photo-item-name">
                  {it.name}
                  <span className="muted small">{it.kcal} kcal · P {it.protein} · C {it.carbs} · F {it.fat}</span>
                </span>
                <input type="number" inputMode="numeric" min="0" aria-label={`${it.name} grams`} value={it.grams} onChange={(e) => setGrams(i, e.target.value)} />
                <span className="muted small">g</span>
                <button type="button" className="icon-btn" aria-label={`Leave out ${it.name}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>
              </li>
            ))}
          </ul>
          <label className="field">
            <span>Meal</span>
            <select value={meal} onChange={(e) => setMeal(e.target.value)}>
              {MEAL_SLOTS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
          <div className="btn-row">
            <button type="button" className="primary-btn" disabled={!items.length} onClick={() => onAdd(items, meal)}>
              Add {items.length} item{items.length === 1 ? '' : 's'} · {total} kcal
            </button>
            <button type="button" className="secondary-btn" onClick={() => setResult(null)}>Retake</button>
          </div>
        </>
      )}
    </div>
  );
}

function MealPlanCard({ profile, plan, apiKey, model, targets, onLogMeal }) {
  const [mealPlan, setMealPlan] = useState(() => loadMealPlan());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dayIdx, setDayIdx] = useState(() => (new Date().getDay() + 6) % 7);
  const diet = sanitizeDiet(profile.diet);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      setMealPlan(saveMealPlan(await generateMealPlan({ profile, plan, apiKey, model })));
    } catch (err) {
      setError(err?.message || 'Could not build the meal plan. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const day = mealPlan?.days[Math.min(dayIdx, mealPlan.days.length - 1)];
  const dayTarget = day?.training ? targets.trainingDay.kcal : targets.restDay.kcal;
  const stale = mealPlan && Math.abs(mealPlan.targetKcal - targets.kcal) > targets.kcal * 0.08;

  return (
    <section className="card" aria-label="Weekly meal plan">
      <div className="card-head">
        <div>
          <h2>Weekly meal plan</h2>
          <p className="muted small">
            {mealPlan
              ? `${DIET_TYPES.find((d) => d.id === diet.dietType)?.label} · ${new Date(mealPlan.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
              : 'Seven days of meals built around your targets, diet and training days.'}
          </p>
        </div>
      </div>
      {stale && <p className="notice-line small">Your targets have changed since this plan was made. Regenerate to match them.</p>}
      {!apiKey && !mealPlan && <p className="muted small">This needs a Gemini API key. Add one with the key button at the top; your targets above work without it.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {(apiKey || mealPlan) && (
        <div className="btn-row">
          <button type="button" className={mealPlan ? 'secondary-btn' : 'primary-btn'} disabled={busy || !apiKey} onClick={generate}>
            {busy ? 'Planning your week… (about 30 s)' : mealPlan ? 'Regenerate' : '✨ Build my meal plan'}
          </button>
        </div>
      )}

      {day && (
        <>
          <div className="chip-row chip-scroll meal-days" role="tablist" aria-label="Day">
            {mealPlan.days.map((d, i) => (
              <button
                key={d.day}
                type="button"
                role="tab"
                aria-selected={i === dayIdx}
                className={`chip ${i === dayIdx ? 'chip-active' : ''}`}
                onClick={() => setDayIdx(i)}
                ref={i === dayIdx ? (el) => el?.scrollIntoView?.({ block: 'nearest', inline: 'center' }) : undefined}
              >
                {d.day.slice(0, 3)}
                {d.training && <span className="train-dot" aria-label="training day" />}
              </button>
            ))}
          </div>
          <p className="muted small">
            {day.training ? 'Training day' : 'Rest day'} · {day.totals.kcal.toLocaleString()} kcal of {dayTarget.toLocaleString()} · {day.totals.protein} g protein of {targets.protein}
          </p>
          <ul className="meal-list">
            {day.meals.map((m, i) => {
              const clashes = dietClashes(`${m.name} ${m.items.join(' ')}`, diet);
              return (
                <li key={i} className="meal-item">
                  <div className="meal-item-head">
                    <span className="meal-slot">{m.slot}</span>
                    <span className="muted small">{m.kcal} kcal · P {m.protein} · C {m.carbs} · F {m.fat}</span>
                  </div>
                  <h3>{m.name}</h3>
                  <p className="muted small">{m.items.join(' · ')}</p>
                  {clashes.length > 0 && <p className="food-warn">⚠ Check this: it may contain {clashes.join(', ')}. Swap it or regenerate.</p>}
                  <button type="button" className="secondary-btn small-btn" onClick={() => onLogMeal(m)}>
                    I ate this
                  </button>
                </li>
              );
            })}
          </ul>
          {mealPlan.tips.length > 0 && (
            <details className="meal-more">
              <summary>Tips for this week</summary>
              <ul>{mealPlan.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </details>
          )}
          {mealPlan.shopping.length > 0 && (
            <details className="meal-more">
              <summary>Shopping list ({mealPlan.shopping.length})</summary>
              <ul className="shopping">{mealPlan.shopping.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export default function NutritionView({ profile, onProfileChange, plan, apiKey, model }) {
  const targets = useMemo(() => computeTargets(profile, plan), [profile, plan]);
  const diet = sanitizeDiet(profile.diet);
  const [log, setLog] = useState(() => loadFoodLog());
  const [date, setDate] = useState(todayKey());
  const [mode, setMode] = useState(null); // null | scan | search | manual
  const [product, setProduct] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [showDiet, setShowDiet] = useState(false);
  const [library, setLibrary] = useState(() => loadFoodLibrary());
  const [water, setWater] = useState(() => loadWater());

  const training = trainingWeekdays(targets.trainingDays).includes(weekdayIdx(date));
  const dayKcal = training ? targets.trainingDay.kcal : targets.restDay.kcal;
  const dayCarbs = training ? targets.trainingDay.carbs : targets.restDay.carbs;
  const totals = dayTotals(log, date);
  const entries = log.filter((e) => e.date === date);

  const add = (entry) => {
    setLog(saveFoodLog([...log, { ...entry, date, ts: Date.now() }]));
    setMode(null);
    setProduct(null);
    setMsg(`Added ${entry.name}.`);
  };
  const remove = (id) => setLog(saveFoodLog(log.filter((e) => e.id !== id)));
  const addMany = (templates, meal, message) => {
    setLog(saveFoodLog([...log, ...entriesFrom(templates, date, meal)]));
    setMode(null);
    setProduct(null);
    setMsg(message);
  };

  // Favourites and saved meals.
  const favKeys = new Set(library.favourites.map(foodKey));
  const toggleFav = (e) => {
    const k = foodKey(e);
    const favourites = favKeys.has(k) ? library.favourites.filter((f) => foodKey(f) !== k) : [templateFrom(e), ...library.favourites];
    setLibrary(saveFoodLibrary({ ...library, favourites }));
  };
  const saveMeal = (slot, items) => {
    const name = window.prompt('Name this meal', `My ${MEAL_SLOTS.find((m) => m.id === slot).label.toLowerCase()}`);
    if (!name?.trim()) return;
    setLibrary(saveFoodLibrary({ ...library, meals: [{ id: `m_${Date.now().toString(36)}`, name: name.trim(), meal: slot, items: items.map(templateFrom) }, ...library.meals] }));
    setMsg(`Saved "${name.trim()}". Add it again from Quick add.`);
  };
  const deleteMeal = (id) => setLibrary(saveFoodLibrary({ ...library, meals: library.meals.filter((m) => m.id !== id) }));
  const pickTemplate = (t) => {
    if (t.per100) setProduct({ name: t.name, brand: t.brand, barcode: t.barcode, per100: t.per100, servingG: t.grams, source: t.source === 'scan' ? 'scan' : 'search' });
    else addMany([t], defaultMeal(), `Added ${t.name}.`);
    if (t.per100) setMode('quick');
  };
  const recent = recentFoods(log, 8, favKeys);

  // Water.
  const waterMl = water[date] || 0;
  const addWater = (ml) => setWater(saveWater({ ...water, [date]: Math.max(0, waterMl + ml) }));

  const onDetected = useCallback(async (code) => {
    setMode('lookup');
    setBusy(true);
    setMsg('');
    try {
      const p = await lookupBarcode(code);
      if (p) setProduct({ ...p, source: 'scan' });
      else {
        setMsg(`Barcode ${code} isn't in the food database yet. Search by name or add it by hand.`);
        setMode('search');
      }
    } catch (err) {
      setMsg(err.message);
      setMode(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const bars = [
    ['kcal', 'Calories', dayKcal, 'kcal'],
    ['protein', 'Protein', targets.protein, 'g'],
    ['carbs', 'Carbs', dayCarbs, 'g'],
    ['fat', 'Fat', targets.fat, 'g'],
    ['fibre', 'Fibre', targets.fibre, 'g'],
  ];
  const limits = [
    ['sugars', 'Sugars', targets.sugarMax, 'g'],
    ['satFat', 'Saturated fat', targets.satFatMax, 'g'],
    ['sodium', 'Sodium', targets.sodiumMax, 'mg'],
  ];

  return (
    <div className="panel-stack nutrition-view">
      <section className="card" aria-label="Daily targets">
        <div className="card-head">
          <div>
            <h2>Your daily targets</h2>
            <p className="muted small">{targets.goalLabel}</p>
          </div>
          <button type="button" className="secondary-btn small-btn" aria-expanded={showDiet} onClick={() => setShowDiet(!showDiet)}>
            Diet settings
          </button>
        </div>
        <div className="target-hero">
          <div>
            <span className="target-big">{targets.trainingDay.kcal.toLocaleString()}</span>
            <span className="muted small">kcal on training days</span>
          </div>
          <div>
            <span className="target-big">{targets.restDay.kcal.toLocaleString()}</span>
            <span className="muted small">kcal on rest days</span>
          </div>
        </div>
        <div className="target-macros">
          <div><strong>{targets.protein} g</strong><span>Protein</span></div>
          <div><strong>{targets.trainingDay.carbs}/{targets.restDay.carbs} g</strong><span>Carbs (train/rest)</span></div>
          <div><strong>{targets.fat} g</strong><span>Fat</span></div>
          <div><strong>{targets.fibre} g+</strong><span>Fibre</span></div>
        </div>
        <p className="muted small">
          Limits: sugar under {targets.sugarMax} g · saturated fat under {targets.satFatMax} g · sodium under {targets.sodiumMax.toLocaleString()} mg · water about {targets.waterL} L.
        </p>
        <p className="muted small">
          From your weight, height, age, goal, {targets.trainingDays} training days a week{profile.labs ? ' and your latest blood report' : ''}. Maintenance is about {targets.tdee.toLocaleString()} kcal.
        </p>
        {targets.notes.length > 0 && (
          <ul className="nut-notes">
            {targets.notes.map((n) => (
              <li key={n.id}>
                <strong>{n.title}.</strong> {n.text}
              </li>
            ))}
          </ul>
        )}
        {showDiet && (
          <div className="diet-panel">
            <DietFields profile={profile} onChange={onProfileChange} idPrefix="n-diet" />
          </div>
        )}
        <p className="muted small">General guidance, not medical advice. With a medical condition, pregnancy or kidney problems, check with your doctor or a dietitian.</p>
      </section>

      <section className="card" aria-label="Food log">
        <div className="card-head">
          <div className="date-nav">
            <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => setDate(shiftDate(date, -1))}>‹</button>
            <h2>{prettyDate(date)}</h2>
            <button type="button" className="icon-btn" aria-label="Next day" disabled={date >= todayKey()} onClick={() => setDate(shiftDate(date, 1))}>›</button>
          </div>
          <span className="pill">{training ? 'Training day' : 'Rest day'}</span>
        </div>
        <div className="nut-bars">
          {bars.map(([id, label, target, unit]) => (
            <Bar key={id} label={label} value={totals[id]} target={target} unit={unit} />
          ))}
        </div>
        <details className="meal-more">
          <summary>Sugar, saturated fat and sodium</summary>
          <div className="nut-bars">
            {limits.map(([id, label, target, unit]) => (
              <Bar key={id} label={label} value={totals[id]} target={target} unit={unit} limit />
            ))}
          </div>
        </details>

        <div className="water-row">
          <Bar label="Water" value={Math.round(waterMl / 100) / 10} target={targets.waterL} unit="L" />
          <div className="btn-row">
            <button type="button" className="chip" onClick={() => addWater(250)}>+ Glass (250 ml)</button>
            <button type="button" className="chip" onClick={() => addWater(500)}>+ Bottle (500 ml)</button>
            <button type="button" className="chip" disabled={!waterMl} aria-label="Remove 250 ml" onClick={() => addWater(-250)}>− 250 ml</button>
          </div>
        </div>

        <div className="btn-row food-actions">
          <button type="button" className="primary-btn" onClick={() => { setMode('scan'); setProduct(null); setMsg(''); }}>
            Scan barcode
          </button>
          <button type="button" className="secondary-btn" onClick={() => { setMode('search'); setProduct(null); setMsg(''); }}>
            Search
          </button>
          <button type="button" className="secondary-btn" onClick={() => { setMode('photo'); setProduct(null); setMsg(''); }}>
            Photo
          </button>
          <button type="button" className="secondary-btn" onClick={() => { setMode('manual'); setProduct(null); setMsg(''); }}>
            Add by hand
          </button>
        </div>
        {(library.meals.length > 0 || library.favourites.length > 0 || recent.length > 0) && (
          <div className="quick-add">
            <span className="field-label">Quick add</span>
            <div className="chip-row chip-scroll" role="group" aria-label="Quick add">
              {library.meals.map((m) => (
                <button key={m.id} type="button" className="chip chip-meal" onClick={() => addMany(m.items, m.meal, `Added ${m.name}.`)}>
                  🍽 {m.name}
                </button>
              ))}
              {library.favourites.map((t) => (
                <button key={`f-${foodKey(t)}`} type="button" className="chip" onClick={() => pickTemplate(t)}>
                  ★ {t.name}
                </button>
              ))}
              {recent.map((t) => (
                <button key={`r-${foodKey(t)}`} type="button" className="chip" onClick={() => pickTemplate(t)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {msg && <p className="notice-line small" role="status">{msg}</p>}

        {mode === 'scan' && !product && <BarcodeScanner onDetected={onDetected} onClose={() => setMode(null)} />}
        {mode === 'lookup' && busy && <p className="muted small">Looking it up…</p>}
        {mode === 'search' && !product && <FoodSearch onPick={(p) => setProduct({ ...p, source: 'search' })} />}
        {mode === 'photo' && (
          <PhotoLogger
            apiKey={apiKey}
            model={model}
            onCancel={() => setMode(null)}
            onAdd={(items, meal) =>
              addMany(
                items.map((it) => ({ name: it.name, grams: Number(it.grams) || null, source: 'photo', totals: { kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat, fibre: it.fibre } })),
                meal,
                `Added ${items.length} item${items.length === 1 ? '' : 's'} from your photo.`
              )
            }
          />
        )}
        {mode === 'manual' && (
          <ManualFood
            onCancel={() => setMode(null)}
            onAdd={(f) => add({ name: f.name, meal: f.meal, source: 'manual', totals: { kcal: Number(f.kcal), protein: Number(f.protein) || 0, carbs: Number(f.carbs) || 0, fat: Number(f.fat) || 0 } })}
          />
        )}
        {product && (
          <AmountPicker
            key={`${product.name}-${product.barcode}`}
            product={product}
            diet={diet}
            onCancel={() => { setProduct(null); setMode(null); }}
            onAdd={({ grams, meal, totals: t }) => add({ name: product.name, brand: product.brand, barcode: product.barcode, source: product.source, grams, meal, per100: product.per100, totals: t })}
          />
        )}

        {MEAL_SLOTS.map((slot) => {
          const items = entries.filter((e) => e.meal === slot.id);
          const before = items.length ? [] : previousMeal(log, date, slot.id);
          if (!items.length && !before.length) return null;
          if (!items.length) {
            return (
              <div key={slot.id} className="copy-row">
                <span>
                  Same {slot.label.toLowerCase()} as the day before?
                  <span className="muted small"> {before.length} item{before.length === 1 ? '' : 's'} · {Math.round(before.reduce((a, e) => a + e.totals.kcal, 0))} kcal</span>
                </span>
                <button type="button" className="secondary-btn small-btn" aria-label={`Copy ${slot.label.toLowerCase()} from the day before`} onClick={() => addMany(before.map(templateFrom).filter(Boolean), slot.id, `Copied ${slot.label.toLowerCase()} from the day before.`)}>
                  Copy
                </button>
              </div>
            );
          }
          return (
            <div key={slot.id} className="food-slot">
              <div className="food-slot-head">
                <h3 className="marker-group-label">{slot.label} · {Math.round(items.reduce((a, e) => a + e.totals.kcal, 0))} kcal</h3>
                <button type="button" className="link-btn small" onClick={() => saveMeal(slot.id, items)}>Save as meal</button>
              </div>
              <ul className="food-entries">
                {items.map((e) => (
                  <li key={e.id}>
                    <button type="button" className={`icon-btn star ${favKeys.has(foodKey(e)) ? 'star-on' : ''}`} aria-pressed={favKeys.has(foodKey(e))} aria-label={`Favourite ${e.name}`} onClick={() => toggleFav(e)}>
                      {favKeys.has(foodKey(e)) ? '★' : '☆'}
                    </button>
                    <span className="food-entry-name">
                      {e.name}
                      <span className="muted small">{[e.brand, e.grams && `${e.grams} g`, `P ${e.totals.protein ?? '—'} · C ${e.totals.carbs ?? '—'} · F ${e.totals.fat ?? '—'}`].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="food-entry-kcal">{e.totals.kcal}</span>
                    <button type="button" className="icon-btn" aria-label={`Remove ${e.name}`} onClick={() => remove(e.id)}>×</button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {library.meals.length > 0 && (
          <details className="meal-more">
            <summary>Saved meals ({library.meals.length})</summary>
            <ul className="saved-meals">
              {library.meals.map((m) => (
                <li key={m.id}>
                  <span>{m.name} <span className="muted small">{m.items.length} items · {Math.round(m.items.reduce((a, t) => a + t.totals.kcal, 0))} kcal</span></span>
                  <button type="button" className="icon-btn" aria-label={`Delete saved meal ${m.name}`} onClick={() => deleteMeal(m.id)}>×</button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {!entries.length && !mode && <p className="muted small empty-line">Nothing logged {date === todayKey() ? 'yet today' : 'this day'}. Scan a pack, search, or tick a meal from your plan.</p>}
      </section>

      <MealPlanCard
        profile={profile}
        plan={plan}
        apiKey={apiKey}
        model={model}
        targets={targets}
        onLogMeal={(m) => add({ name: m.name, meal: /break/i.test(m.slot) ? 'breakfast' : /lunch/i.test(m.slot) ? 'lunch' : /dinner|supper/i.test(m.slot) ? 'dinner' : 'snack', source: 'plan', totals: { kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, fibre: m.fibre } })}
      />
    </div>
  );
}
