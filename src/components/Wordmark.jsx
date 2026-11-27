import React from 'react';

/**
 * Header wordmark: "repwise" in Montserrat ExtraBold. The dot on the "i" is a weight plate, and a loaded
 * barbell (stacked plates and collars) underlines the word; its plates slide on when the app opens.
 */
export default function Wordmark() {
  return (
    <span className="wordmark" role="img" aria-label="Repwise logo">
      <span className="wordmark-word" aria-hidden="true">
        repw
        <span className="wordmark-i">
          ı<span className="wordmark-plate" />
        </span>
        se
      </span>
      <svg className="wordmark-bar" viewBox="0 0 240 26" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect x="18" y="10" width="204" height="6" rx="3" fill="currentColor" />
        <g className="plates plates-l">
          <rect x="30" y="6.5" width="5" height="13" rx="1.5" fill="currentColor" />
          <rect x="18" y="3.5" width="9" height="19" rx="2.5" fill="#059669" />
          <rect x="7" y="0" width="11" height="26" rx="3" fill="var(--brand)" />
          <rect x="1" y="9" width="6" height="8" rx="2" fill="currentColor" />
        </g>
        <g className="plates plates-r">
          <rect x="205" y="6.5" width="5" height="13" rx="1.5" fill="currentColor" />
          <rect x="213" y="3.5" width="9" height="19" rx="2.5" fill="#059669" />
          <rect x="222" y="0" width="11" height="26" rx="3" fill="var(--brand)" />
          <rect x="233" y="9" width="6" height="8" rx="2" fill="currentColor" />
        </g>
      </svg>
    </span>
  );
}
