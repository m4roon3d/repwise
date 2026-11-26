import React, { useEffect, useRef, useState } from 'react';
import { EXERCISE_MAP } from '../services/catalogFilter';

const base = (import.meta.env?.BASE_URL || './').replace(/\/?$/, '/');
export const photoUrl = (photoId, frame) => `${base}photos/${photoId}/${frame}.jpg`;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

/**
 * Real photos of the movement: start and finish positions. The finish photo eases in and out over the start photo
 * with a hold at each end, driven by a CSS animation (GPU-composited, no React re-renders) so it stays smooth.
 * Paused off-screen and under reduced motion; tap Start or Finish to hold a position.
 */
export default function ExercisePhotos({ exerciseId, compact = false }) {
  const ex = EXERCISE_MAP[exerciseId];
  const [hold, setHold] = useState(() => (reducedMotion() ? 0 : null)); // null = looping, 0 = start, 1 = finish
  const [visible, setVisible] = useState(true);
  const [failed, setFailed] = useState(false);
  const ref = useRef(null);
  const playing = hold === null;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '100px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!ex?.photo || failed) return null;
  const state = playing ? (visible ? 'is-looping' : 'is-looping is-paused') : hold === 1 ? 'is-finish' : 'is-start';

  return (
    <figure ref={ref} className={`ex-photos ${compact ? 'ex-photos-compact' : ''}`} aria-label={`${ex.name}: start and finish positions`}>
      <div className={`ex-photos-stage ${state}`}>
        <img src={photoUrl(ex.photo, 0)} alt={`${ex.name}, start position`} className={`ex-f0 ${hold === 1 ? '' : 'is-on'}`} loading="lazy" decoding="async" draggable="false" onError={() => setFailed(true)} />
        <img src={photoUrl(ex.photo, 1)} alt={`${ex.name}, finish position`} className={`ex-f1 ${hold === 1 ? 'is-on' : ''}`} loading="lazy" decoding="async" draggable="false" onError={() => setFailed(true)} />
        <span className="ex-photos-label ex-l0">Start</span>
        <span className="ex-photos-label ex-l1">Finish</span>
      </div>
      <div className="ex-photos-controls">
        <button type="button" className="mini-btn" onClick={() => setHold(playing ? 0 : null)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <div className="segmented ex-photos-seg" role="group" aria-label="Show position">
          {['Start', 'Finish'].map((label, f) => (
            <button key={label} type="button" aria-pressed={hold === f} className={hold === f ? 'seg-active' : ''} onClick={() => setHold(f)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </figure>
  );
}
