import React from 'react';

const baseProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.85,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
};

export function CoachIcon({ size = 22 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M4 6h16" />
      <circle cx="9" cy="6" r="2.2" fill="var(--bg)" />
      <path d="M4 12h16" />
      <circle cx="15" cy="12" r="2.2" fill="var(--bg)" />
      <path d="M4 18h16" />
      <circle cx="11" cy="18" r="2.2" fill="var(--bg)" />
    </svg>
  );
}

export function WorkoutIcon({ size = 22 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M6.5 6.5v11" />
      <path d="M17.5 6.5v11" />
      <path d="M3.5 9v6" />
      <path d="M20.5 9v6" />
      <path d="M6.5 12h11" />
    </svg>
  );
}

export function ExercisesIcon({ size = 22 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </svg>
  );
}

export function KeyIcon({ size = 16 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12H20" />
      <path d="M17 12v3" />
      <path d="M20 12v2.2" />
    </svg>
  );
}

export function ChatIcon({ size = 18 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

export function OrbitIcon({ size = 14 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <ellipse cx="12" cy="12" rx="9" ry="4.5" />
      <path d="M16 4l2.5 2.5L16 9" />
      <path d="M8 20l-2.5-2.5L8 15" />
    </svg>
  );
}

export function PlayIcon({ size = 13 }) {
  return (
    <svg {...baseProps} width={size} height={size} fill="currentColor" stroke="none">
      <polygon points="6,4 20,12 6,20" />
    </svg>
  );
}

export function PauseIcon({ size = 13 }) {
  return (
    <svg {...baseProps} width={size} height={size} fill="currentColor" stroke="none">
      <rect x="5" y="4" width="4.5" height="16" rx="1" />
      <rect x="14.5" y="4" width="4.5" height="16" rx="1" />
    </svg>
  );
}

export function ProgressIcon({ size = 22 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M4 19h16" />
      <path d="M5 15l4.5-4.5 3.5 3L19 7" />
      <path d="M15 7h4v4" />
    </svg>
  );
}
