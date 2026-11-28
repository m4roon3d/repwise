import React, { useMemo, useState } from 'react';
import { MiniBars } from './TrendChart';
import { computeTargets, trainingWeekdays } from '../services/nutrition';
import { dailySeries, todayKey } from '../services/food';
import { loadFoodLog, loadWater } from '../services/storage';

const short = (date) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const weekdayIdx = (date) => (new Date(`${date}T12:00:00`).getDay() + 6) % 7;

/** Calories, protein and water over the last 14 or 30 days, against the person's targets. */
export default function NutritionTrends({ profile, plan, onOpen }) {
  const [days, setDays] = useState(14);
  const targets = useMemo(() => computeTargets(profile, plan), [profile, plan]);
  const rows = useMemo(() => dailySeries(loadFoodLog(), loadWater(), days), [days]);
  // Today is still in progress, so averages use finished days only (today's bar still shows).
  const today = todayKey();
  const logged = rows.filter((r) => r.logged && r.date !== today);
  const trainDays = new Set(trainingWeekdays(targets.trainingDays));
  const kcalTarget = (r) => (trainDays.has(weekdayIdx(r.date)) ? targets.trainingDay.kcal : targets.restDay.kcal);
  const avg = (k) => (logged.length ? Math.round(logged.reduce((a, r) => a + r[k], 0) / logged.length) : 0);
  const onTarget = logged.filter((r) => Math.abs(r.kcal - kcalTarget(r)) <= kcalTarget(r) * 0.1).length;
  const proteinHit = logged.filter((r) => r.protein >= targets.protein * 0.9).length;
  const waterDays = rows.filter((r) => r.waterMl > 0);
  const avgWater = waterDays.length ? Math.round(waterDays.reduce((a, r) => a + r.waterMl, 0) / waterDays.length / 100) / 10 : 0;

  return (
    <section className="card" aria-label="Nutrition trends">
      <div className="card-head">
        <h2>Nutrition</h2>
        <div className="unit-toggle" role="group" aria-label="Range">
          {[14, 30].map((d) => (
            <button key={d} type="button" className={days === d ? 'unit-active' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      {!rows.some((r) => r.logged) ? (
        <p className="muted">
          No food logged in the last {days} days.{' '}
          {onOpen && (
            <button type="button" className="link-btn" onClick={onOpen}>
              Start logging →
            </button>
          )}
        </p>
      ) : (
        <>
          <div className="stat-grid diag-stats">
            <div className="stat-tile">
              <strong className="stat-value">{avg('kcal').toLocaleString()}</strong>
              <span className="stat-label">avg kcal · target {targets.kcal.toLocaleString()}</span>
            </div>
            <div className="stat-tile">
              <strong className="stat-value">{avg('protein')} g</strong>
              <span className="stat-label">avg protein · target {targets.protein} g</span>
            </div>
            <div className="stat-tile">
              <strong className="stat-value">{onTarget}/{logged.length}</strong>
              <span className="stat-label">days within 10% of calories</span>
            </div>
            <div className="stat-tile">
              <strong className="stat-value">{proteinHit}/{logged.length}</strong>
              <span className="stat-label">days protein hit</span>
            </div>
          </div>
          <MiniBars
            title="Calories per day"
            note={`dashed line: target ${targets.kcal.toLocaleString()}`}
            target={targets.kcal}
            bars={rows.map((r) => ({ value: r.kcal, date: r.date, highlight: r.logged && Math.abs(r.kcal - kcalTarget(r)) <= kcalTarget(r) * 0.1 }))}
            formatLabel={(b) => short(b.date)}
          />
          <MiniBars
            title="Protein per day (g)"
            note={`target ${targets.protein} g`}
            target={targets.protein}
            bars={rows.map((r) => ({ value: Math.round(r.protein), date: r.date, highlight: r.protein >= targets.protein * 0.9 }))}
            formatLabel={(b) => short(b.date)}
          />
          {waterDays.length > 0 && (
            <MiniBars
              title="Water per day (L)"
              note={`avg ${avgWater} L · target ${targets.waterL} L`}
              target={targets.waterL}
              bars={rows.map((r) => ({ value: Math.round(r.waterMl / 100) / 10, date: r.date, highlight: r.waterMl / 1000 >= targets.waterL }))}
              formatLabel={(b) => short(b.date)}
            />
          )}
          <p className="muted small">Darker bars are days on target. Averages count finished days with food logged, not today.</p>
        </>
      )}
    </section>
  );
}
