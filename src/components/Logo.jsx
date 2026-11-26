import React, { useId } from 'react';

/** The Repwise mark: an "R" whose bowl is a weight plate, standing on a barbell. Same artwork as public/icon.svg. */
export default function Logo({ size = 40 }) {
  const uid = useId().replace(/:/g, '');
  const accent = `url(#ac${uid})`;
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="Repwise logo" className="brand-logo">
      <defs>
        <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0b1120" />
        </linearGradient>
        <linearGradient id={`ac${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="114" fill={`url(#bg${uid})`} />
      <path d="M188 110 V330" stroke="#fff" strokeWidth="44" strokeLinecap="round" />
      <circle cx="260" cy="182" r="68" fill="none" stroke={accent} strokeWidth="36" />
      <circle cx="260" cy="182" r="13" fill={accent} />
      <path d="M270 256 L332 330" stroke="#fff" strokeWidth="44" strokeLinecap="round" />
      <rect x="84" y="384" width="344" height="18" rx="9" fill="#fff" />
      <rect x="100" y="344" width="34" height="98" rx="12" fill={accent} />
      <rect x="378" y="344" width="34" height="98" rx="12" fill={accent} />
    </svg>
  );
}
