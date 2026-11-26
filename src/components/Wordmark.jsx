import React from 'react';

/**
 * Header wordmark: the "R" of Repwise carries a weight plate in its bowl set at text size, and a slim
 * barbell underlines the word. No box, so it sits lightly beside the other header controls.
 */
export default function Wordmark() {
  return (
    <span className="wordmark" role="img" aria-label="Repwise logo">
      <span className="wordmark-word" aria-hidden="true">
        <svg className="wordmark-r" viewBox="0 0 74 100" focusable="false">
          <path d="M13 9 V91" stroke="currentColor" strokeWidth="18" />
          <path d="M13 9 H38 A25.5 25.5 0 0 1 38 60 H13" fill="none" stroke="currentColor" strokeWidth="18" strokeLinejoin="round" />
          <circle cx="40" cy="34.5" r="14.5" fill="var(--accent)" />
          <circle cx="40" cy="34.5" r="4.5" fill="#fff" />
          <path d="M36 62 L64 91" stroke="currentColor" strokeWidth="18" />
        </svg>
        <span className="wordmark-rest">epwise</span>
      </span>
      <svg className="wordmark-bar" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect x="10" y="6" width="180" height="2.6" rx="1.3" fill="currentColor" opacity="0.85" />
        <rect className="plate plate-l" x="2" y="1" width="7" height="12" rx="2.5" fill="var(--accent)" />
        <rect className="plate plate-r" x="191" y="1" width="7" height="12" rx="2.5" fill="var(--accent)" />
      </svg>
    </span>
  );
}
