import React, { useEffect, useRef, useState } from 'react';
import { EXERCISE_MAP } from '../services/catalogFilter';

const base = (import.meta.env?.BASE_URL || './').replace(/\/?$/, '/');
export const photoUrl = (photoId, frame) => `${base}photos/${photoId}/${frame}.jpg`;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

/**
 * Real photos of the movement: start and finish positions, cross-faded in a loop so it reads as a slow rep.
 * Pauses when off-screen, when the tab is hidden, and under reduced motion. Tap a label to hold a position.
 */
export default function ExercisePhotos({ exerciseId, compact = false }) {
  const ex = EXERCISE_MAP[exerciseId];
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [visible, setVisible] = useState(true);
  const [failed, setFailed] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '100px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !visible) return undefined;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setFrame((f) => 1 - f);
    }, 1600);
    return () => clearInterval(id);
  }, [playing, visible]);

  if (!ex?.photo || failed) return null;

  return (
    <figure ref={ref} className={`ex-photos ${compact ? 'ex-photos-compact' : ''}`} aria-label={`${ex.name}: start and finish positions`}>
      <div className="ex-photos-stage">
        {[0, 1].map((f) => (
          <img
            key={f}
            src={photoUrl(ex.photo, f)}
            alt={f === 0 ? `${ex.name}, start position` : `${ex.name}, finish position`}
            loading="lazy"
            decoding="async"
            className={frame === f ? 'is-on' : ''}
            onError={() => setFailed(true)}
            draggable="false"
          />
        ))}
        <span className="ex-photos-label">{frame === 0 ? 'Start' : 'Finish'}</span>
      </div>
      <div className="ex-photos-controls">
        <button type="button" className="mini-btn" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <div className="segmented ex-photos-seg" role="group" aria-label="Show position">
          {['Start', 'Finish'].map((label, f) => (
            <button
              key={label}
              type="button"
              aria-pressed={frame === f}
              className={frame === f ? 'seg-active' : ''}
              onClick={() => {
                setPlaying(false);
                setFrame(f);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </figure>
  );
}
