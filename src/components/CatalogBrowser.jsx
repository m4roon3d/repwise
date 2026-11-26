import React, { useEffect, useMemo, useState } from 'react';
import exercises from '../data/exercises.json';
import ExercisePhotos from './ExercisePhotos';
import { EQUIPMENT_TIER_LABELS } from '../services/catalogFilter';

export default function CatalogBrowser({ defaultTier }) {
  const [tierFilter, setTierFilter] = useState(defaultTier || 'all');

  useEffect(() => {
    if (defaultTier) setTierFilter(defaultTier);
  }, [defaultTier]);
  const [patternFilter, setPatternFilter] = useState('all');
  const [styleFilter, setStyleFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [openAnimId, setOpenAnimId] = useState(exercises[0]?.id || null);

  const patterns = useMemo(
    () => ['all', ...Array.from(new Set(exercises.map((e) => e.movement_pattern)))],
    []
  );

  const filtered = useMemo(() => {
    return exercises.filter((e) => {
      if (tierFilter !== 'all' && !e.equipment_tiers.includes(tierFilter)) return false;
      if (patternFilter !== 'all' && e.movement_pattern !== patternFilter) return false;
      if (styleFilter !== 'all' && !(e.modalities || ['gym']).includes(styleFilter)) return false;
      if (
        query.trim() &&
        !`${e.name} ${e.primary_muscles.join(' ')} ${e.equipment_label}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [tierFilter, patternFilter, styleFilter, query]);

  return (
    <div className="panel-stack library-view">
      <section className="card">
        <h2>Personal Exercise Library ({filtered.length} / {exercises.length})</h2>
        <p className="muted">
          Edit <code>src/data/exercises.json</code> anytime to add or customize your gym&apos;s exact machines.
        </p>

        <div className="grid-2" style={{ marginTop: '12px' }}>
          <input
            type="text"
            placeholder="Search exercise, muscle, or gear..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
            <option value="all">All Equipment Setups</option>
            {Object.entries(EQUIPMENT_TIER_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="segmented style-filter" role="group" aria-label="Filter by style" style={{ marginTop: '10px' }}>
          {[
            ['all', 'All'],
            ['gym', '🏋️ Gym'],
            ['calisthenics', '🤸 Body'],
            ['yoga', '🧘 Yoga'],
            ['cardio', '🏃 Cardio'],
          ].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={styleFilter === v} className={styleFilter === v ? 'seg-active' : ''} onClick={() => setStyleFilter(v)}>
              {l}
            </button>
          ))}
        </div>

        <div className="chip-row" style={{ marginTop: '10px' }}>
          {patterns.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip ${patternFilter === p ? 'chip-active' : ''}`}
              onClick={() => setPatternFilter(p)}
            >
              {p.replace('_', ' ')}
            </button>
          ))}
        </div>
      </section>

      {filtered.map((ex) => {
        const isOpen = openAnimId === ex.id;
        return (
          <article key={ex.id} className="card">
            <div className="card-head">
              <div>
                <span className="pattern-tag">{ex.movement_pattern.replace('_', ' ')}</span>
                <h3>{ex.name}</h3>
                <p className="muted">
                  {ex.equipment_label} · {ex.primary_muscles.join(', ')}
                </p>
              </div>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setOpenAnimId(isOpen ? null : ex.id)}
              >
                {isOpen ? 'Hide' : '▶ View Form'}
              </button>
            </div>

            {ex.joint_stress_flags.length > 0 && (
              <div className="muted" style={{ fontSize: '0.8rem', marginTop: '6px' }}>
                Joint caution tags: {ex.joint_stress_flags.join(', ')} (auto-filtered when flagged)
              </div>
            )}

            {isOpen && (
              <div style={{ marginTop: '12px' }}>
                <ExercisePhotos exerciseId={ex.id} compact />
                <ul className="cues-list">
                  {ex.cues.map((c, idx) => (
                    <li key={idx}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
