import React, { useId } from 'react';

/** The Repwise mark: an "R" with a rise chevron in the bowl. Same artwork as public/icon.svg. */
export default function Logo({ size = 40 }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="Repwise logo" className="brand-logo">
      <defs>
        <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#101a2e" />
          <stop offset="100%" stopColor="#070b13" />
        </linearGradient>
        <linearGradient id={`ac${uid}`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill={`url(#bg${uid})`} />
      <path
        d="M168 136 V380 M168 136 H216 A78 78 0 0 1 216 292 H168 M236 298 L336 380"
        fill="none"
        stroke={`url(#ac${uid})`}
        strokeWidth="46"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M212 228 L234 204 L256 228" fill="none" stroke="#e6fffb" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
