import React from 'react';

// Original pictogram-style gym figures, drawn as thick rounded strokes. They sit behind the app as a very faint
// watermark (decorative only: aria-hidden, no pointer events), and change with the tab for some variety.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 13, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Head = ({ cx, cy }) => <circle cx={cx} cy={cy} r="12.5" fill="currentColor" />;

export const FIGURES = {
  runner: (
    <>
      <Head cx={121} cy={30} />
      <path {...S} d="M114 50 L98 100" />
      <path {...S} d="M112 56 L134 74 L150 58" />
      <path {...S} d="M112 56 L90 72 L78 94" />
      <path {...S} d="M98 100 L128 118 L122 156" />
      <path {...S} d="M98 100 L84 134 L52 142" />
      <path d="M40 176 H170" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
    </>
  ),
  crossTrainer: (
    <>
      {/* machine */}
      <path {...S} strokeWidth="7" d="M34 172 H170" />
      <circle cx="152" cy="148" r="19" fill="none" stroke="currentColor" strokeWidth="7" />
      <path {...S} strokeWidth="7" d="M152 148 L140 60 L126 52" />
      <path {...S} strokeWidth="6" d="M96 158 L152 148 M70 166 L152 148" />
      {/* person */}
      <Head cx={98} cy={30} />
      <path {...S} d="M98 50 L94 100" />
      <path {...S} d="M98 57 L118 80 L136 66" />
      <path {...S} d="M98 57 L114 86 L132 72" opacity="0.55" />
      <path {...S} d="M94 100 L110 128 L98 156" />
      <path {...S} d="M94 100 L84 132 L72 164" />
    </>
  ),
  deadlift: (
    <>
      <Head cx={100} cy={30} />
      <path {...S} d="M100 50 L100 106" />
      <path {...S} d="M100 58 L82 66 L78 112" />
      <path {...S} d="M100 58 L118 66 L122 112" />
      <path {...S} d="M100 106 L88 142 L86 176" />
      <path {...S} d="M100 106 L112 142 L114 176" />
      <path stroke="currentColor" strokeWidth="7" strokeLinecap="round" d="M34 114 H166" />
      <rect x="22" y="90" width="15" height="48" rx="5" fill="currentColor" />
      <rect x="163" y="90" width="15" height="48" rx="5" fill="currentColor" />
    </>
  ),
  press: (
    <>
      <Head cx={100} cy={50} />
      <path {...S} d="M100 72 L100 122" />
      <path {...S} d="M100 80 L74 70 L76 22" />
      <path {...S} d="M100 80 L126 70 L124 22" />
      <path {...S} strokeWidth="7" d="M40 20 H160" />
      <rect x="30" y="2" width="14" height="36" rx="5" fill="currentColor" />
      <rect x="156" y="2" width="14" height="36" rx="5" fill="currentColor" />
      <path {...S} d="M100 122 L86 148 L84 176" />
      <path {...S} d="M100 122 L114 148 L116 176" />
    </>
  ),
};

const PAIRS = {
  assess: ['press', 'runner'],
  routine: ['deadlift', 'crossTrainer'],
  ask: ['runner', 'press'],
  library: ['crossTrainer', 'deadlift'],
  progress: ['runner', 'deadlift'],
  health: ['runner', 'press'],
};

export function Figure({ name, className, style }) {
  return (
    <svg viewBox="0 0 200 190" className={className} style={style} aria-hidden="true" focusable="false">
      {FIGURES[name]}
    </svg>
  );
}

const base = (import.meta.env?.BASE_URL || './').replace(/\/?$/, '/');

/** A washed-out real gym scene behind the app, different on each tab. Decorative only. */
export default function Watermark({ tab }) {
  const scene = PAIRS[tab] ? tab : 'assess';
  return (
    <div className="bg-scene" aria-hidden="true">
      <div className="bg-scene-img" style={{ backgroundImage: `url(${base}bg/${scene}.jpg)` }} />
    </div>
  );
}
